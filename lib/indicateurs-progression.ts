/**
 * INDICATEURS DE PROGRESSION — la couche d'AFFICHAGE du moteur du lot A.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE MODULE NE CALCULE AUCUNE RÈGLE MÉTIER
 * ════════════════════════════════════════════════════════════════════════
 * Toute décision de charge vient de `recommanderProchaineCible`
 * (lib/progression-automatique.ts), toute lecture de référence vient de
 * `referenceDeProgression` (lib/reference-progression.ts), toute identité
 * d'occurrence vient de lib/occurrence-programmee.ts. Ce module se contente
 * de TRADUIRE leur sortie en ce que l'interface doit montrer : une flèche,
 * un écart, un libellé.
 *
 * ⚠️ AUCUNE LOGIQUE PARALLÈLE. Si un jour la règle « borne haute atteinte »
 * change, elle ne doit changer QUE dans lib/progression-automatique.ts. Un
 * `if (reps >= max)` écrit ici serait un second moteur, c'est-à-dire deux
 * vérités qui divergeraient au premier ajustement.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'ÉCART DE RÉPÉTITIONS N'EST PAS PLAFONNÉ
 * ────────────────────────────────────────────────────────────────────────
 * Règle posée : +1 rend +1, +3 rend +3, +10 rend +10 ; -1 rend -1, -5 rend
 * -5. Un plafond à ±3 mentirait à l'élève qui vient de faire dix
 * répétitions de plus — et masquerait précisément l'information qui doit
 * déclencher une montée de charge.
 */
import {
  recommanderProchaineCible,
  type MotifSansRecommandation,
  type Recommandation,
} from "@/lib/progression-automatique";
import {
  findPreviousPerformance,
  type PreviousExercisePerf,
  type PreviousPerformanceIndex,
} from "@/lib/previous-performance";
import { occurrencePrecedente, type OccurrenceProgrammee } from "@/lib/occurrence-programmee";
import {
  lirePlageReps,
  referenceDeProgression,
  type MotifPlageRefusee,
  type PlageReps,
  type SerieRealisee,
} from "@/lib/reference-progression";
import { getEffectiveLoadKg, parseLoad } from "@/lib/training-metrics";
import type { MuscleGroup } from "@/types";

/* ─── Unité de charge : ce que l'élève a écrit ─── */

/**
 * COMMENT LA CHARGE DOIT ÊTRE PRÉSENTÉE À L'HUMAIN.
 *
 * ⚠️ LE MOTEUR RAISONNE EN CHARGE EFFECTIVE, L'ÉCRAN PARLE LA LANGUE DE LA
 * SAISIE. « 24 kg / haltère » vaut 48 kg pour tout calcul interne
 * (`getEffectiveLoadKg` double les charges par haltère, convention héritée du
 * tonnage) — c'est ce 48 qui est comparé d'une semaine à l'autre, et c'est
 * bien ainsi : les deux occurrences passent par la même lecture. Mais
 * afficher « 48 kg » à un coach qui a écrit « 24 kg / haltère » lui présente
 * un nombre qu'il n'a jamais saisi et qui ne correspond à aucun haltère de sa
 * salle.
 *
 * Cette unité ne change AUCUN calcul. Elle ne sert qu'au dernier mètre :
 * remettre le nombre dans l'unité d'origine juste avant de l'écrire.
 */
export type UniteCharge = "totale" | "par-haltere";

/** L'unité d'une charge saisie, lue par le même analyseur que le moteur. */
export function uniteDeCharge(loadUsed: string | null | undefined): UniteCharge {
  return parseLoad(loadUsed ?? "").loadType === "kg_per_dumbbell" ? "par-haltere" : "totale";
}

/**
 * L'unité d'une SÉRIE de séries — celle de la première charge chiffrable.
 *
 * La référence exige déjà une charge CONSTANTE sur les séries chiffrables
 * (`chargeDeReference`), donc toutes portent la même unité ; lire la première
 * suffit. Aucune série chiffrable : « totale », qui ne transforme rien.
 */
export function uniteDeLaReference(series: readonly SerieRealisee[]): UniteCharge {
  for (const serie of series) {
    const analyse = parseLoad(serie.loadUsed ?? "");
    if (getEffectiveLoadKg(analyse) !== null) {
      return analyse.loadType === "kg_per_dumbbell" ? "par-haltere" : "totale";
    }
  }
  return "totale";
}

/* ─── Passerelle historique → séries ─── */

/**
 * Les séries d'une performance passée, ORDONNÉES PAR NUMÉRO DE SÉRIE.
 *
 * `PreviousExercisePerf.sets` est un `Record<number, …>` : l'ordre des clés
 * d'un objet JavaScript est celui de l'insertion, pas celui des numéros de
 * série. La moyenne ne s'en soucierait pas, mais `chargeDeReference` retient
 * la PREMIÈRE charge chiffrable comme charge de l'exercice — un ordre
 * d'insertion inhabituel changerait donc la référence. On trie.
 *
 * `null` rend un tableau vide : « aucune série » est un état normal, refusé
 * plus loin avec son motif.
 */
export function seriesRealiseesDe(perf: PreviousExercisePerf | null | undefined): SerieRealisee[] {
  if (!perf) return [];
  return Object.keys(perf.sets)
    .map(Number)
    .filter((numero) => Number.isFinite(numero))
    .sort((a, b) => a - b)
    .map((numero) => ({ loadUsed: perf.sets[numero].loadUsed, repsDone: perf.sets[numero].repsDone }));
}

/**
 * LA RÉFÉRENCE DE PROGRESSION D'UN EXERCICE : même exercice, même jour, une
 * semaine plus tôt.
 *
 * ⚠️ AUCUN REPLI CHRONOLOGIQUE, JAMAIS. Si l'occurrence N-1 n'a pas été
 * réalisée, la réponse est `null`. Sur un programme lundi/mercredi/vendredi,
 * un repli rendrait le lundi de la semaine en cours — plus récent, mais ce
 * n'est pas le repère : c'est exactement le défaut que ce chantier corrige.
 * Le `null` fait disparaître les indicateurs ; il ne fait pas apparaître une
 * recommandation calculée sur la mauvaise séance.
 *
 * `null` couvre indistinctement : semaine 1 (pas de semaine 0), occurrence
 * N-1 non réalisée, charge non chiffrable, charge variable d'une série à
 * l'autre, aucune série chiffrable. Chacun de ces cas est un refus nommé en
 * amont ; ici ils veulent tous dire « aucun indicateur ».
 */
export function referenceDeLOccurrencePrecedente(
  index: PreviousPerformanceIndex,
  exercise: { name: string; libraryExerciseId?: string | null },
  occurrenceCourante: OccurrenceProgrammee | null,
): { readonly chargeKg: number; readonly reps: number; readonly unite: UniteCharge } | null {
  if (!occurrenceCourante) return null;
  const precedente = occurrencePrecedente(occurrenceCourante);
  if (!precedente) return null;
  const perf = findPreviousPerformance(index, exercise, precedente);
  if (!perf) return null;
  const series = seriesRealiseesDe(perf);
  const lue = referenceDeProgression(series);
  if (!lue.ok) return null;
  // L'unité voyage AVEC la référence : c'est la seule façon de savoir, au
  // moment d'afficher, dans quelle langue l'élève a écrit sa charge.
  return { chargeKg: lue.reference.chargeKg, reps: lue.reference.reps, unite: uniteDeLaReference(series) };
}

/* ─── Formatage ─── */

/**
 * Une charge en kilogrammes, telle qu'elle s'affiche : au plus UNE décimale,
 * et aucune décimale inutile.
 *
 * `15` rend « 15 kg », `14.5` rend « 14,5 kg », `11.5` rend « 11,5 kg ».
 *
 * ⚠️ CE N'EST PAS `formatKg` de lib/weight-chart.ts, qui force une décimale
 * (« 15,0 kg ») parce qu'une courbe de poids corporel a besoin d'une largeur
 * de libellé stable. Ici c'est l'inverse : « 15,0 kg » sur une barre se lit
 * comme une fausse précision.
 */
export function formaterChargeKg(kg: number): string {
  if (!Number.isFinite(kg)) return "—";
  const arrondi = Math.round(kg * 10) / 10;
  const texte = Number.isInteger(arrondi) ? String(arrondi) : arrondi.toFixed(1).replace(".", ",");
  return `${texte} kg`;
}

/**
 * La charge TELLE QU'ELLE DOIT S'AFFICHER, à partir de la charge effective.
 *
 * `par-haltere` divise par deux — l'exacte réciproque de `getEffectiveLoadKg`
 * — et rend l'unité, pour qu'aucun nombre affiché ne soit ambigu :
 * `formaterChargeUtilisateur(48, "par-haltere")` rend « 24 kg / haltère ».
 *
 * ⚠️ AUCUNE AUTRE TRANSFORMATION. On ne fait pas semblant que la charge tombe
 * sur un haltère existant : si le calcul interne produit 50,5 kg effectifs,
 * l'affichage rend « 25,25 kg / haltère », qui n'existe dans aucune salle.
 * C'est volontairement visible — masquer ce nombre en l'arrondissant
 * reviendrait à inventer une règle d'incrément par haltère que personne n'a
 * posée. Voir le point signalé au propriétaire du projet.
 */
export function formaterChargeUtilisateur(kgEffectifs: number, unite: UniteCharge): string {
  if (unite === "par-haltere") {
    if (!Number.isFinite(kgEffectifs)) return "—";
    const parHaltere = Math.round((kgEffectifs / 2) * 100) / 100;
    const texte = Number.isInteger(parHaltere) ? String(parHaltere) : String(parHaltere).replace(".", ",");
    return `${texte} kg / haltère`;
  }
  return formaterChargeKg(kgEffectifs);
}

/* ─── Changement d'espace : total ↔ par haltère ─── */

/**
 * De la charge EFFECTIVE vers l'espace dans lequel la progression se calcule.
 *
 * Pour un exercice aux haltères, c'est la charge PAR HALTÈRE : l'incrément du
 * groupe s'y applique directement, et le résultat tombe sur une charge qui
 * existe réellement (26 kg, 26,5 kg), au lieu des 25,25 kg par haltère que
 * produisait un incrément appliqué à la paire.
 *
 * ⚠️ CE N'EST PAS UN CHANGEMENT DE LA RÈGLE D'INCRÉMENT. Les paliers par
 * groupe musculaire sont inchangés (+2,5 / +2 / +1) ; seule la charge à
 * laquelle on les applique change. Idem pour la baisse sous la borne basse et
 * pour le plancher : ils agissent désormais dans le même espace, donc
 * −1 kg PAR HALTÈRE et un plancher de 0,5 kg PAR HALTÈRE — conséquence
 * directe et assumée de la règle, à confirmer si elle ne convient pas.
 */
export function versEspaceDeProgression(kgEffectifs: number, unite: UniteCharge): number {
  return unite === "par-haltere" ? kgEffectifs / 2 : kgEffectifs;
}

/**
 * Retour vers la charge EFFECTIVE, réciproque exacte de la précédente.
 *
 * C'est la seule forme que le reste du système manipule : comparaison
 * d'occurrences, détection de stagnation, tonnage. `getEffectiveLoadKg` fait
 * la même conversion depuis le texte saisi ; celle-ci la refait depuis un
 * nombre déjà calculé.
 */
export function versChargeEffective(kgDansEspaceDeProgression: number, unite: UniteCharge): number {
  const effectif = unite === "par-haltere" ? kgDansEspaceDeProgression * 2 : kgDansEspaceDeProgression;
  return Math.round(effectif * 100) / 100;
}

/** L'écart de répétitions, signe compris : `+10`, `-5`. Jamais « 0 ». */
export function formaterEcartReps(ecart: number): string {
  return ecart > 0 ? `+${ecart}` : String(ecart);
}

/* ─── Écart de répétitions ─── */

/**
 * L'écart RÉEL entre les répétitions saisies et la référence.
 *
 * `null` quand il n'y a rien à comparer : champ vide, saisie illisible, ou
 * écart nul (aucun indicateur ne s'affiche pour « pareil qu'avant » — un
 * badge « 0 » n'apprend rien et encombre la cellule).
 *
 * ⚠️ AUCUN PLAFONNEMENT. La soustraction est rendue telle quelle.
 */
export function ecartReps(repsSaisies: string | null | undefined, repsReference: number): number | null {
  const brut = (repsSaisies ?? "").trim();
  if (brut === "" || !/^\d+$/.test(brut)) return null;
  const ecart = Number(brut) - repsReference;
  return ecart === 0 ? null : ecart;
}

/* ─── Indicateurs d'un exercice ─── */

/** Sens de la flèche de charge, ou `null` quand la charge ne bouge pas. */
export type SensCharge = "hausse" | "baisse";

/** Pourquoi aucun indicateur ne s'affiche — tous les motifs sont nommés. */
export type MotifSansIndicateur = MotifSansRecommandation | MotifPlageRefusee;

export interface Indicateurs {
  /** La référence retenue — l'occurrence N-1 du même jour. */
  readonly reference: { readonly chargeKg: number; readonly reps: number };
  /** La recommandation du moteur du lot A, telle quelle. */
  readonly recommandation: Recommandation;
  /** ↑ / ↓ dans la cellule CHARGE, `null` si la charge est inchangée. */
  readonly sensCharge: SensCharge | null;
  /** La plage prescrite effectivement lue — utile au libellé accessible. */
  readonly plage: PlageReps;
  /** L'unité dans laquelle l'élève a saisi sa charge — pour l'AFFICHAGE seul. */
  readonly unite: UniteCharge;
}

export type IndicateursLus =
  | { readonly ok: true; readonly indicateurs: Indicateurs }
  | { readonly ok: false; readonly motif: MotifSansIndicateur };

export interface EntreeIndicateurs {
  /** Réglage ON/OFF de l'exercice — GLOBAL au programme (lot C). */
  readonly progressionActive: boolean;
  readonly groupe: MuscleGroup;
  /** Le champ `reps` prescrit, BRUT : « 8-13 ». Lu par le parseur strict. */
  readonly repsPrescrites: string | null | undefined;
  /** La référence de l'occurrence N-1, ou `null` si elle n'existe pas. */
  readonly reference: { readonly chargeKg: number; readonly reps: number } | null;
  /**
   * L'unité de saisie de la référence. Absente : « totale », qui n'applique
   * aucune transformation — le comportement d'avant cette règle.
   */
  readonly unite?: UniteCharge;
}

/**
 * Les indicateurs d'un exercice, ou un refus nommé.
 *
 * L'ordre des gardes suit celui du moteur : le OFF court-circuite tout, pour
 * qu'un exercice désactivé ne laisse aucune trace de calcul à l'écran.
 */
export function indicateursDExercice(entree: EntreeIndicateurs): IndicateursLus {
  if (!entree.progressionActive) return { ok: false, motif: "progression-desactivee" };

  const plage = lirePlageReps(entree.repsPrescrites);
  if (!plage.ok) return { ok: false, motif: plage.motif };

  const unite: UniteCharge = entree.unite ?? "totale";
  const reference = entree.reference;

  // ⚠️ LE CALCUL DE PROGRESSION SE FAIT DANS L'ESPACE DE L'HALTÈRE.
  // Règle posée le 23/09/2026 : pour un exercice aux haltères, l'incrément du
  // groupe s'applique PAR HALTÈRE, pas à la charge de la paire. On entre donc
  // dans le moteur avec la charge par haltère (24), il rend la charge par
  // haltère suivante (26 pour les pectoraux, 26,5 pour le dos), et on ne
  // reconvertit en charge totale qu'à la sortie — là où le reste du système
  // (comparaison d'occurrences, stagnation, tonnage) l'attend.
  //
  // Sans ce changement d'espace, +2,5 kg appliqué à 48 kg effectifs rendait
  // 50,5 kg, soit 25,25 kg par haltère : une charge qui n'existe sur aucun
  // rack. C'est exactement ce que cette règle corrige.
  const chargeProgression = reference ? versEspaceDeProgression(reference.chargeKg, unite) : null;

  const lue = recommanderProchaineCible({
    progressionActive: entree.progressionActive,
    groupe: entree.groupe,
    plage: plage.plage,
    reference: reference && chargeProgression !== null ? { chargeKg: chargeProgression, reps: reference.reps } : null,
  });
  if (!lue.ok) return { ok: false, motif: lue.motif };

  // Non atteignable : `recommanderProchaineCible` refuse déjà une référence
  // absente avec `aucune-reference`. La garde existe pour que le type porté
  // par `Indicateurs` soit vrai sans affirmation non nulle.
  if (!reference) return { ok: false, motif: "aucune-reference" };

  // Retour à la charge TOTALE : `Recommandation.chargeKg` garde partout la
  // même signification que `reference.chargeKg`, la charge effective. Seul
  // l'affichage repasse ensuite par `formaterChargeUtilisateur`.
  const recommandation: Recommandation = {
    ...lue.recommandation,
    chargeKg: versChargeEffective(lue.recommandation.chargeKg, unite),
  };
  const sensCharge: SensCharge | null = !recommandation.chargeModifiee
    ? null
    : recommandation.chargeKg > reference.chargeKg
      ? "hausse"
      : "baisse";

  return {
    ok: true,
    indicateurs: { reference, recommandation, sensCharge, plage: plage.plage, unite },
  };
}

/* ─── Libellés accessibles ─── */

/**
 * Le libellé lu par un lecteur d'écran pour la flèche de charge.
 *
 * ⚠️ IL DIT LA VALEUR, PAS LA COULEUR. « flèche verte » n'apprend rien à
 * qui n'a pas accès à la couleur ; « charge recommandée : 52 kg, en hausse »
 * dit la même chose que le pictogramme.
 */
export function libelleCharge(indicateurs: Indicateurs): string {
  const cible = formaterChargeUtilisateur(indicateurs.recommandation.chargeKg, indicateurs.unite);
  if (indicateurs.sensCharge === "hausse") return `Charge recommandée en hausse : ${cible}`;
  if (indicateurs.sensCharge === "baisse") return `Charge recommandée en baisse : ${cible}`;
  return `Charge recommandée maintenue : ${cible}`;
}

/** Le libellé lu pour l'écart de répétitions d'une série. */
export function libelleEcartReps(ecart: number, numeroSerie: number): string {
  const sens = ecart > 0 ? "de plus" : "de moins";
  const valeur = Math.abs(ecart);
  const unite = valeur === 1 ? "répétition" : "répétitions";
  return `Série ${numeroSerie} : ${valeur} ${unite} ${sens} que la référence`;
}
