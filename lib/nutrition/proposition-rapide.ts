import {
  AUCUNE_SELECTION,
  RIEN,
  optionCalculable,
  optionExploitable,
  type SelectionDeChoix,
} from "@/lib/nutrition/meal-choice-selection";
import type { MealChoiceSolution } from "@/lib/nutrition/meal-choice-solver";
import type { ChoiceOption, MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";
import type { RepasDeLaPeriode } from "@/lib/nutrition/repas-de-la-periode";

/**
 * COURSES C1.1 — LE MODE RAPIDE : UNE PROPOSITION, PAS UNE DÉCISION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MOTEUR NE CHOISIT QUE PARMI CE QUE LE COACH A AUTORISÉ
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ IL N'A ACCÈS À RIEN D'AUTRE QUE `occurrence.options`. Sa signature ne
 * reçoit ni catalogue, ni client Supabase, ni `food_lists` : il lui est
 * matériellement impossible d'inventer un aliment, d'en chercher un hors
 * snapshot, ou de fabriquer une identité en comparant des noms. Une préférence
 * ou un favori qui ne figure pas dans une occurrence est simplement ignoré
 * POUR CETTE OCCURRENCE.
 *
 * ⚠️ IL NE CALCULE AUCUNE QUANTITÉ. Il rend une `SelectionDeChoix` — des
 * `optionId`, rien de plus. Les grammes viennent ensuite de `calculDuRepas`
 * et du solveur de N1.5, seuls et uniques. Un second calcul ici produirait un
 * deuxième résultat pour la même question.
 *
 * ⚠️ IL EST DÉTERMINISTE. Aucun `Math.random`, aucune date, aucun état : deux
 * appels avec les mêmes entrées rendent le même résultat. Une proposition
 * aléatoire serait impossible à reproduire quand l'élève dit « ça m'a mis
 * n'importe quoi ».
 *
 * ⚠️ IL NE RÉORDONNE PAS LE SNAPSHOT. Le repli parcourt `occurrence.options`
 * dans l'ordre exact du coach et prend la PREMIÈRE utilisable.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/** La clé d'une identité, telle que `cleFavori` la produit déjà : `aliment:UUID`. */
export function cleIdentite(option: { readonly type: "aliment" | "produit"; readonly id: string }): string {
  return `${option.type}:${option.id}`;
}

/** D'où vient le choix proposé pour une occurrence. Sert à l'expliquer à l'écran. */
export type OrigineDuChoix = "preference" | "favori" | "snapshot";

export interface ChoixPropose {
  readonly slotId: string;
  readonly optionId: string;
  readonly origine: OrigineDuChoix;
}

/**
 * Le choix proposé pour UNE occurrence, ou `null` si aucune option n'est
 * utilisable.
 *
 * Priorité, dans cet ordre et sans exception :
 *   1. une PRÉFÉRENCE explicite de l'élève, si cette identité est autorisée ici
 *   2. un FAVORI existant, si cette identité est autorisée ici
 *   3. la PREMIÈRE option utilisable, dans l'ordre du coach
 *
 * ⚠️ « UTILISABLE » = `optionExploitable` **ET** `optionCalculable`. Une option
 * sans données nutritionnelles ne peut pas entrer dans le solveur : la
 * proposer produirait un repas non calculable, donc non validable. Elle est
 * écartée à TOUS les niveaux — y compris quand c'est un favori.
 *
 * ⚠️ UN FAVORI NE DEVIENT JAMAIS OBLIGATOIRE. Il ne fait que remonter dans
 * l'ordre de préférence ; l'élève peut changer le choix, et une occurrence où
 * aucun favori n'apparaît reste parfaitement composable.
 */
export function choisirPourOccurrence(
  occurrence: MealChoiceSlot,
  preferences: ReadonlySet<string>,
  favoris: ReadonlySet<string>,
): ChoixPropose | null {
  // ⚠️ « UTILISABLE » = CHOISISSABLE **ET** CALCULABLE. `optionExploitable` dit
  // qu'on peut la présenter (elle a un identifiant et un nom) ;
  // `optionCalculable` dit que le solveur peut en faire quelque chose (macros
  // présentes, unité cohérente, minimum ≤ plafond). Proposer une option
  // seulement exploitable produirait un repas que `calculDuRepas` rendrait
  // « non-calculable » — donc invalidable, et l'élève ne saurait pas pourquoi.
  const utilisables = occurrence.options.filter(
    (o): o is ChoiceOption & { optionId: string } =>
      typeof o.optionId === "string" && optionExploitable(o) && optionCalculable(o),
  );
  if (utilisables.length === 0) return null;

  const parPriorite: readonly (readonly [OrigineDuChoix, ReadonlySet<string>])[] = [
    ["preference", preferences],
    ["favori", favoris],
  ];
  for (const [origine, ensemble] of parPriorite) {
    // ⚠️ ON PARCOURT LES OPTIONS DU COACH, pas l'ensemble de l'élève : à deux
    // préférences autorisées dans la même occurrence, c'est l'ORDRE DU COACH
    // qui départage, jamais l'ordre dans lequel l'élève a coché.
    const trouvee = utilisables.find((o) => ensemble.has(cleIdentite(o)));
    if (trouvee) return { slotId: occurrence.id, optionId: trouvee.optionId, origine };
  }
  return { slotId: occurrence.id, optionId: utilisables[0].optionId, origine: "snapshot" };
}

/** La sélection proposée pour UN repas. Vide si aucune occurrence n'est utilisable. */
export function proposerSelection(
  occurrences: readonly MealChoiceSlot[],
  preferences: ReadonlySet<string>,
  favoris: ReadonlySet<string>,
): SelectionDeChoix {
  const selection: Record<string, string> = {};
  for (const occurrence of occurrences) {
    const choix = choisirPourOccurrence(occurrence, preferences, favoris);
    if (choix !== null) {
      selection[choix.slotId] = choix.optionId;
      continue;
    }
    // ⚠️ N1.7 — « RIEN » N'EST JAMAIS PRÉFÉRÉ À UN ALIMENT, il n'arrive QUE
    // là où aucun aliment n'est possible. La proposition rapide propose un
    // aliment ; ce repli ne s'ouvre que sur une occurrence FACULTATIVE dont
    // pas une seule option n'est utilisable — le cas qui, avant ce lot,
    // laissait le repas définitivement incomposable, sans que l'élève puisse
    // rien y faire. Répondre « rien » là où le coach a dit que c'était permis
    // est la seule sortie honnête.
    if (occurrence.peutEtreIgnoree) selection[occurrence.id] = RIEN;
  }
  return Object.keys(selection).length === 0 ? AUCUNE_SELECTION : selection;
}

export interface RepasPropose {
  readonly cle: string;
  readonly selection: SelectionDeChoix;
  /** `true` si TOUTES les occurrences du repas ont reçu un choix. */
  readonly complet: boolean;
  readonly origines: readonly OrigineDuChoix[];
  /**
   * CORRECTIF D-3 — `true` quand ce repas porte une composition devenue
   * INVALIDE (le coach a retiré une option). Il figure alors dans la
   * proposition pour être COMPTÉ et OUVRABLE, mais sans aucun choix : le
   * remplir d'office serait une substitution silencieuse.
   */
  readonly aRecomposer: boolean;
}

/**
 * La semaine proposée : une sélection par repas de la période.
 *
 * ⚠️ LES REPAS DÉJÀ PRÊTS NE SONT PAS TOUCHÉS. Une proposition ne réécrit pas
 * un repas que l'élève a déjà composé lui-même — ce serait effacer son travail
 * pour lui proposer autre chose. « Prêt » veut dire prêt ET ENCORE VALIDE.
 *
 * ⚠️ LES REPAS DÉJÀ CONSOMMÉS NON PLUS. La base les refuserait de toute façon
 * (verrou C0.1 `REPAS_DEJA_CONSOMME`) ; les écarter ici évite d'annoncer une
 * proposition que la validation rejettera.
 *
 * ⚠️ CORRECTIF D-3 — UN REPAS « À RECOMPOSER » N'EST PLUS SAUTÉ EN SILENCE.
 * Il entre dans la proposition avec `aRecomposer: true`, `complet: false` et
 * AUCUN choix : l'écran peut le compter et l'élève peut l'ouvrir, sans qu'une
 * option de remplacement lui soit imposée. `pret` seul ne décide plus de rien.
 */
export function proposerSemaine(
  repas: readonly RepasDeLaPeriode[],
  preferences: ReadonlySet<string>,
  favoris: ReadonlySet<string>,
): ReadonlyMap<string, RepasPropose> {
  const proposition = new Map<string, RepasPropose>();
  for (const r of repas) {
    if (r.consomme) continue;
    if (r.pret) continue;
    if (r.aRecomposer) {
      // ⚠️ AUCUNE SUBSTITUTION. On enregistre le fait, pas un remplaçant.
      proposition.set(r.cle, {
        cle: r.cle,
        selection: AUCUNE_SELECTION,
        complet: false,
        origines: [],
        aRecomposer: true,
      });
      continue;
    }
    const origines: OrigineDuChoix[] = [];
    const selection: Record<string, string> = {};
    for (const occurrence of r.occurrences) {
      const choix = choisirPourOccurrence(occurrence, preferences, favoris);
      if (choix === null) continue;
      selection[choix.slotId] = choix.optionId;
      origines.push(choix.origine);
    }
    proposition.set(r.cle, {
      cle: r.cle,
      selection: Object.keys(selection).length === 0 ? AUCUNE_SELECTION : selection,
      complet: r.occurrences.length > 0 && origines.length === r.occurrences.length,
      origines,
      aRecomposer: false,
    });
  }
  return proposition;
}

/**
 * La charge utile de validation d'un repas, à partir de la solution du
 * SOLVEUR EXISTANT.
 *
 * ⚠️ `displayQuantity`, JAMAIS `quantity`. L'entier affiché à l'élève est
 * celui qui part en base : l'écran dit 163 g, la base doit dire 163. La valeur
 * flottante interne du solveur ne sort jamais.
 *
 * ⚠️ AUCUN CALCUL ICI. Cette fonction ne fait que recopier des champs de
 * `MealChoiceSolution` — la solution vient de `calculDuRepas`, qui appelle le
 * solveur de N1.5. Il n'existe pas de second solveur.
 *
 * ⚠️ SECONDE ÉCRITURE ASSUMÉE, ET SIGNALÉE. `StudentMealChoices` construit la
 * même charge utile en ligne, et `courses-c0-validation` lit ce code littéral
 * dans ce fichier-là : l'unifier obligerait à réécrire un test hors périmètre.
 * L'unification est portée au reste à faire pour C2, avec `resoudreIdentites`.
 */
export function itemsAValider(
  solution: Pick<MealChoiceSolution, "items">,
): readonly { readonly slotId: string; readonly optionId: string; readonly quantity: number; readonly unit: "g" | "ml" }[] {
  return solution.items.map((item) => ({
    slotId: item.slotId,
    optionId: item.optionId,
    quantity: item.displayQuantity,
    unit: item.unit,
  }));
}

/* ══════════════════════════════════════════════════════════════════════════
   LES PRÉFÉRENCES RAPIDES — UNE PETITE SÉLECTION, PAS UN CATALOGUE
   ══════════════════════════════════════════════════════════════════════════ */

export interface OptionProposable {
  /** `aliment:UUID` / `produit:UUID`. */
  readonly cle: string;
  readonly type: "aliment" | "produit";
  readonly id: string;
  readonly displayName: string;
  /** Dans combien d'occurrences de la période cette option est proposée. */
  readonly recurrence: number;
  /** `true` si l'élève l'a déjà en favori (signal AUTOMATIQUE, pas une case à cocher). */
  readonly favori: boolean;
}

/** Le plafond par défaut : au-delà, ce n'est plus une question courte. */
export const MAX_OPTIONS_RAPIDES = 12;

/**
 * Les quelques aliments à proposer à l'élève, extraits des SEULES options
 * réellement présentes dans la période.
 *
 * ⚠️ AUCUNE CATÉGORIE. Le modèle n'en porte aucune de fiable — voir l'audit du
 * livrable C1.1 : `food_catalog` n'a ni tag ni groupe, `food_catalog.source_ref`
 * ne stocke que le code Ciqual sans sa table de groupes, et le contrat Open
 * Food Facts (`OFF_FIELDS`) ne demande pas `categories_tags`. Les déduire d'un
 * nom (« contient poulet ⇒ viande ») serait une heuristique fausse au premier
 * « bouillon de poulet ». On n'affiche donc AUCUNE section inventée.
 *
 * ⚠️ TRI DÉTERMINISTE, EN TROIS CLÉS : favoris d'abord (le signal existant, sans
 * rien demander à l'élève), puis récurrence décroissante (ce qui revient le
 * plus dans la semaine est ce qui compte le plus), puis nom — et la clé
 * d'identité départage, pour que deux homonymes gardent un ordre stable.
 */
export function optionsProposables(
  repas: readonly RepasDeLaPeriode[],
  favoris: ReadonlySet<string>,
  max: number = MAX_OPTIONS_RAPIDES,
): readonly OptionProposable[] {
  const parCle = new Map<string, { type: "aliment" | "produit"; id: string; displayName: string; recurrence: number }>();
  for (const r of repas) {
    for (const occurrence of r.occurrences) {
      for (const option of occurrence.options) {
        // Même filtre que la proposition : on ne met pas en avant un aliment
        // qu'on ne saura pas proposer ensuite.
        if (!optionExploitable(option) || !optionCalculable(option)) continue;
        const cle = cleIdentite(option);
        const existante = parCle.get(cle);
        if (existante) {
          existante.recurrence += 1;
          if (existante.displayName === "" && typeof option.displayName === "string") {
            existante.displayName = option.displayName;
          }
          continue;
        }
        parCle.set(cle, {
          type: option.type,
          id: option.id,
          displayName: typeof option.displayName === "string" ? option.displayName : "",
          recurrence: 1,
        });
      }
    }
  }

  return [...parCle.entries()]
    .map(([cle, v]): OptionProposable => ({ cle, ...v, favori: favoris.has(cle) }))
    .sort((a, b) => {
      if (a.favori !== b.favori) return a.favori ? -1 : 1;
      if (a.recurrence !== b.recurrence) return b.recurrence - a.recurrence;
      const parNom = a.displayName.localeCompare(b.displayName, "fr");
      return parNom !== 0 ? parNom : a.cle.localeCompare(b.cle);
    })
    .slice(0, Math.max(0, max));
}
