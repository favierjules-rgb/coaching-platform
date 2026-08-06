import { BASIS_POINTS_TOTAL } from "@/lib/nutrition/basis-points";
import {
  MACRO_KEYS,
  readSlotBasisPoints,
  withSlotBasisPoints,
  type MacroKey,
  type MealSlotAllocation,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import type { MacroSplitBasisPoints } from "@/lib/nutrition/macro-targets";

/**
 * CURSEURS SOLIDAIRES — bibliothèque PURE.
 *
 * PROBLÈME RÉSOLU. Les trois parts protéines / glucides / lipides d'une
 * journée doivent totaliser EXACTEMENT 100 %. Tant que les trois curseurs
 * étaient indépendants, atteindre ce total était un travail manuel : on
 * bougeait un curseur, on lisait « Réparti : 97 % », on corrigeait un autre,
 * on dépassait, on recommençait. C'est la première cause de la complexité
 * ressentie du constructeur.
 *
 * SOLUTION. Bouger un curseur redistribue immédiatement le reste sur les
 * autres, PROPORTIONNELLEMENT à leur valeur du moment. Le total ne quitte
 * jamais 10 000 points de base : il n'y a plus rien à corriger à la main.
 *
 * GARANTIES, toutes vérifiées par `test:nutrition-plan-v2-builder` :
 *   - la somme rendue vaut EXACTEMENT `BASIS_POINTS_TOTAL`, dans tous les
 *     cas, y compris quand toutes les valeurs de départ sont nulles ;
 *   - toutes les valeurs sont des ENTIERS de points de base — aucun
 *     flottant ne circule, aucun arrondi cumulatif ;
 *   - la fonction est DÉTERMINISTE : à entrée égale, sortie égale, l'ordre
 *     du tableau tranchant toutes les égalités ;
 *   - elle est PURE : ni le tableau reçu ni ses éléments ne sont mutés ;
 *   - une entrée FIGÉE (verrouillée) est préservée au point de base près.
 *
 * CE QU'ELLE NE FAIT PAS. Elle ne connaît ni les calories, ni les grammes,
 * ni 4, 4 et 9 : elle ne manipule que des parts. La conversion en grammes
 * reste l'affaire de `computeDailyMacroTargets`.
 */

/** Une part participant à la répartition solidaire. */
export interface RebalanceEntry {
  /** Identifiant stable — clé de macro ou clé de créneau. */
  readonly key: string;
  readonly bp: number;
  /**
   * `false` = valeur figée : ni le curseur déplacé ni la redistribution ne
   * peuvent la changer. Un créneau verrouillé, typiquement.
   */
  readonly adjustable: boolean;
}

/**
 * Répartit `BASIS_POINTS_TOTAL` entre les entrées après le déplacement d'un
 * curseur.
 *
 * ÉCRÊTAGE ASSUMÉ, et seulement ici. `parsePercentInput` REFUSE une valeur
 * hors bornes parce qu'une saisie au clavier est une intention explicite
 * qu'il ne faut pas déformer. Un curseur, lui, ne peut physiquement pas
 * demander plus que ce qui reste disponible : la demande est donc ramenée
 * dans [0, total − figés], sans message d'erreur. Les deux comportements
 * sont volontairement différents.
 *
 * Si aucune autre entrée n'est ajustable, le curseur déplacé absorbe tout le
 * disponible — sans quoi la somme cesserait de valoir 10 000.
 */
export function rebalanceToTotal(
  entries: readonly RebalanceEntry[],
  changedKey: string,
  requestedBp: number,
): readonly { readonly key: string; readonly bp: number }[] {
  const modifiée = entries.find((e) => e.key === changedKey);
  if (!modifiée || !modifiée.adjustable) {
    // Rien à faire : on rend une copie des valeurs reçues, sans les toucher.
    return entries.map((e) => ({ key: e.key, bp: e.bp }));
  }

  const figées = entries.filter((e) => e.key !== changedKey && !e.adjustable);
  const autres = entries.filter((e) => e.key !== changedKey && e.adjustable);

  const totalFigé = figées.reduce((somme, e) => somme + e.bp, 0);
  const disponible = Math.max(0, BASIS_POINTS_TOTAL - totalFigé);

  const demandée = Number.isFinite(requestedBp) ? Math.round(requestedBp) : 0;
  const valeur = autres.length === 0 ? disponible : Math.min(Math.max(demandée, 0), disponible);
  const reste = disponible - valeur;

  const parts = répartir(
    autres.map((e) => e.bp),
    reste,
  );

  const parClé = new Map<string, number>([[changedKey, valeur]]);
  autres.forEach((e, index) => parClé.set(e.key, parts[index]));

  return entries.map((e) => ({ key: e.key, bp: parClé.get(e.key) ?? e.bp }));
}

/**
 * Répartit `reste` sur `valeurs` proportionnellement à leur poids actuel.
 *
 * Poids tous nuls (état initial, ou tout remis à zéro) : parts ÉGALES —
 * même règle que `distributeRemainingEqually`, pour que les deux outils ne
 * se contredisent jamais.
 *
 * L'attribution des unités restantes suit la plus grande partie
 * fractionnaire (méthode du plus fort reste), l'index du tableau tranchant
 * les égalités. Deux critères stables ⇒ résultat indépendant de
 * l'implémentation de `sort`.
 */
function répartir(valeurs: readonly number[], reste: number): number[] {
  const n = valeurs.length;
  if (n === 0) return [];
  if (reste <= 0) return valeurs.map(() => 0);

  const somme = valeurs.reduce((total, v) => total + Math.max(0, v), 0);

  if (somme <= 0) {
    const quotient = Math.floor(reste / n);
    const unités = reste - quotient * n;
    return valeurs.map((_, index) => quotient + (index < unités ? 1 : 0));
  }

  const exactes = valeurs.map((v) => (reste * Math.max(0, v)) / somme);
  const planchers = exactes.map((v) => Math.floor(v));
  let restantes = reste - planchers.reduce((total, v) => total + v, 0);

  const ordre = exactes
    .map((v, index) => ({ index, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const sortie = planchers.slice();
  for (const { index } of ordre) {
    if (restantes <= 0) break;
    sortie[index] += 1;
    restantes -= 1;
  }
  return sortie;
}

/**
 * Les trois macros d'une journée, après déplacement d'un curseur.
 *
 * Les trois sont toujours ajustables : il n'existe pas de verrou à l'échelle
 * de la journée — le verrou est une notion de créneau.
 */
export function rebalanceDailyMacros(
  split: MacroSplitBasisPoints,
  changed: MacroKey,
  requestedBp: number,
): MacroSplitBasisPoints {
  const entrées: RebalanceEntry[] = MACRO_KEYS.map((macro) => ({
    key: macro,
    bp: lireMacro(split, macro),
    adjustable: true,
  }));
  const résultat = rebalanceToTotal(entrées, changed, requestedBp);
  const parClé = new Map(résultat.map((r) => [r.key, r.bp]));
  return {
    proteinBp: parClé.get("protein") ?? split.proteinBp,
    carbBp: parClé.get("carb") ?? split.carbBp,
    fatBp: parClé.get("fat") ?? split.fatBp,
  };
}

function lireMacro(split: MacroSplitBasisPoints, macro: MacroKey): number {
  if (macro === "protein") return split.proteinBp;
  if (macro === "carb") return split.carbBp;
  return split.fatBp;
}

/**
 * LES SIX CRÉNEAUX d'UNE macro, après déplacement d'un curseur.
 *
 * Même algorithme que les macros de la journée — `rebalanceToTotal`, appelé
 * ici aussi, sans une ligne recopiée. Trois différences tiennent au domaine,
 * et elles se règlent toutes en composant le tableau d'entrées :
 *
 *   - seuls les créneaux ACTIFS participent : la cible de 10 000 points de
 *     base porte sur eux, exactement comme `describeMacroBalance` la mesure.
 *     Un créneau désactivé garde sa valeur (zéro après normalisation) et
 *     n'entre pas dans la répartition ;
 *   - un créneau VERROUILLÉ est figé : il est préservé au point de base près,
 *     et le curseur déplacé est écrêté à `10 000 − somme des verrouillés` ;
 *   - si tous les autres créneaux actifs sont verrouillés, le curseur déplacé
 *     absorbe tout le disponible — la somme ne peut pas cesser de valoir
 *     10 000 pour cause de verrous.
 *
 * Un créneau désactivé, verrouillé, ou absent du tableau ne peut pas être
 * déplacé : la fonction rend alors une copie inchangée.
 *
 * Fonction pure : ni le tableau reçu ni ses éléments ne sont mutés.
 */
export function rebalanceSlotMacro(
  allocations: readonly MealSlotAllocation[],
  macro: MacroKey,
  slot: MealSlotKey,
  requestedBp: number,
  options: { readonly lockedSlots?: readonly MealSlotKey[] } = {},
): MealSlotAllocation[] {
  const verrouillés = new Set(options.lockedSlots ?? []);

  const entrées: RebalanceEntry[] = allocations
    .filter((a) => a.enabled)
    .map((a) => ({
      key: a.slot,
      bp: readSlotBasisPoints(a, macro),
      adjustable: !verrouillés.has(a.slot),
    }));

  const résultat = rebalanceToTotal(entrées, slot, requestedBp);
  const parCréneau = new Map(résultat.map((e) => [e.key, e.bp]));

  return allocations.map((a) => {
    const valeur = a.enabled ? parCréneau.get(a.slot) : undefined;
    return valeur === undefined ? { ...a } : withSlotBasisPoints({ ...a }, macro, valeur);
  });
}
