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
  referenceDeSurcharge,
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
  // ⚠️ `referenceDeSurcharge` ET NON `referenceDeProgression` : la charge la
  // plus lourde réellement tenue, et ce que l'élève a fait à cette charge.
  // L'autre fonction refuse une séance à charge variable, ce qui est juste
  // pour tracer un point de courbe et faux pour calculer une progression.
  // Voir son en-tête dans lib/reference-progression.ts.
  const lue = referenceDeSurcharge(series);
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

/* ═══════════════════════════════════════════════════════════════════════
 * NIVEAU 1 — COMPARAISON IMMÉDIATE À LA PERFORMANCE HISTORIQUE
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ⚠️ DEUX NIVEAUX DISTINCTS, ET C'EST TOUT L'OBJET DE CETTE SECTION.
 *
 *   1. CE NIVEAU-CI — « comment cette série se compare-t-elle à la
 *      référence, et faut-il changer de charge à la suivante ? »
 *   2. `indicateursDExercice` plus bas — « que faut-il prescrire la
 *      prochaine fois ? »
 *
 * ────────────────────────────────────────────────────────────────────────
 * ⚠️ CE NIVEAU NE DÉPEND DE RIEN : NI DU RÉGLAGE, NI DU MOTEUR, NI DU GROUPE
 * ────────────────────────────────────────────────────────────────────────
 * Règle posée le 23/09/2026, et c'est une CORRECTION explicite d'une version
 * antérieure de ce module :
 *
 *   • pas de `progressionActive` — un coach qui n'a pas activé la surcharge
 *     automatique doit quand même voir que son élève a mis 2 kg de plus ;
 *   • pas d'appel à `recommanderProchaineCible` — les indicateurs immédiats
 *     ne doivent PAS dépendre du moteur de surcharge automatique ;
 *   • pas de groupe musculaire, d'où son ABSENCE dans `ContexteComparaison`.
 *     Un exercice sans tarif de progression (cardio, full-body) garde tous
 *     ses indicateurs immédiats. Cette absence est structurelle : la
 *     fonction ne peut pas consulter une donnée qu'elle ne reçoit pas.
 *
 * La seule entrée est donc la FOURCHETTE PRESCRITE, lue par `lirePlageReps`.
 * Une version précédente demandait son verdict au moteur ; la conséquence
 * était qu'un exercice non tarifé n'avait plus ni ✓/✕ ni flèche. C'est
 * exactement ce que cette version corrige.
 *
 * ⚠️ DIVERGENCE ASSUMÉE AVEC LE MOTEUR, À LA BORNE HAUTE. Le moteur monte la
 * charge dès que la borne haute est ATTEINTE (reps >= max) ; la flèche de
 * conseil, elle, n'apparaît qu'au-dessus de la fourchette (reps > max) —
 * règle posée : « 14 reps → ↑ », et 8 à 13 est la fourchette visée, donc
 * 13 reps n'est pas un débordement. Les deux niveaux répondent à deux
 * questions différentes et n'ont pas à coïncider.
 *
 * ⚠️ AUCUNE DÉCISION DE CHARGE ICI POUR AUTANT : ce niveau ne calcule jamais
 * un kilogramme à prescrire. Il dit « plus haut », « plus bas », « tenu »,
 * « pas tenu ». Le combien reste la propriété exclusive de
 * lib/progression-automatique.ts.
 */

/** Le sens d'un écart de charge entre la saisie et la référence. */
export type SensEcartCharge = "hausse" | "baisse" | "identique";

/** Le verdict ✓/✕ — n'a de sens que lorsque la charge MONTE. */
export type TenueDeLaCharge = "tenue" | "insuffisante";

export interface ComparaisonImmediate {
  readonly sens: SensEcartCharge;
  /**
   * Écart de charge EFFECTIF, signé, en kg. `0` quand les charges sont
   * égales, et TOUJOURS renseigné dès que la charge a bougé : une charge
   * modifiée affiche son écart factuel, hausse comme baisse. À afficher via
   * `formaterEcartChargeKg`, qui le remet dans l'unité de saisie.
   */
  readonly ecartChargeKg: number;
  /**
   * Écart de répétitions — RENSEIGNÉ UNIQUEMENT À CHARGE ÉGALE.
   *
   * ⚠️ `null` DÈS QUE LA CHARGE A BOUGÉ, et ce n'est pas une omission.
   * Comparer les 10 répétitions faites à 47 kg aux 13 faites à 45 kg
   * afficherait « −3 » alors que l'élève a progressé. C'est exactement le
   * faux négatif que cette règle interdit. Même raison à la baisse : « +4 »
   * sur une charge allégée de 5 kg n'est pas une progression.
   *
   * `null` aussi quand l'écart est NUL, règle inchangée depuis le lot B : un
   * badge « 0 » n'apprend rien. C'est `ecartReps` — la primitive déjà
   * validée — qui est appelée, et non une seconde soustraction.
   */
  readonly ecartReps: number | null;
  /**
   * ✓ ou ✕ — RENSEIGNÉ UNIQUEMENT QUAND LA CHARGE MONTE.
   *
   * Règle posée, fourchette 8–13 : charge supérieure → ✓ si les répétitions
   * atteignent la borne BASSE (reps >= 8), ✕ sinon. À charge égale l'écart de
   * répétitions dit déjà tout ; à la baisse, rien n'est concluant et aucun
   * verdict n'est rendu — seul l'écart factuel s'affiche.
   */
  readonly tenue: TenueDeLaCharge | null;
}

/**
 * TOUT CE QU'IL FAUT POUR COMPARER — et rien de plus.
 *
 * ⚠️ AUCUN GROUPE MUSCULAIRE, AUCUN RÉGLAGE. Voir l'en-tête de section : cette
 * absence est ce qui garantit que les indicateurs immédiats restent
 * disponibles sur un exercice sans tarif de progression automatique.
 *
 * `reference` peut être `null` — semaine 1, occurrence N-1 non réalisée : il
 * n'y a alors aucun écart à afficher, mais le CONSEIL de série suivante reste
 * calculable, puisqu'il ne regarde que la prescription.
 */
export interface ContexteComparaison {
  readonly reference: { readonly chargeKg: number; readonly reps: number } | null;
  readonly plage: PlageReps;
  /** Unité de SAISIE, pour l'affichage seul. Jamais un calcul. */
  readonly unite: UniteCharge;
}

/**
 * Le contexte de comparaison d'un exercice, ou `null` s'il n'y a rien à
 * comparer.
 *
 * Le seul refus possible est une PLAGE PRESCRITE inexploitable : sans
 * fourchette lisible, ni ✓/✕ ni conseil n'ont de sens.
 */
export function contexteDeComparaison(entree: {
  readonly repsPrescrites: string | null | undefined;
  readonly reference: { readonly chargeKg: number; readonly reps: number; readonly unite?: UniteCharge } | null;
}): ContexteComparaison | null {
  const plage = lirePlageReps(entree.repsPrescrites);
  if (!plage.ok) return null;
  return {
    reference: entree.reference ? { chargeKg: entree.reference.chargeKg, reps: entree.reference.reps } : null,
    plage: plage.plage,
    unite: entree.reference?.unite ?? "totale",
  };
}

/** Les répétitions saisies, ou `null` si le champ n'est pas un entier lisible. */
function repsLues(repsSaisies: string | null | undefined): number | null {
  const brut = (repsSaisies ?? "").trim();
  if (brut === "" || !/^\d+$/.test(brut)) return null;
  return Number(brut);
}

/**
 * Compare UNE série saisie à la référence.
 *
 * `null` quand il n'y a rien à comparer : pas de référence, ou charge ou
 * répétitions absentes ou illisibles. Jamais un verdict sur une saisie
 * incomplète — et en particulier JAMAIS d'écart de répétitions quand la
 * charge n'est pas saisie : une charge inconnue n'est pas une charge égale.
 */
export function comparerALaReference(
  contexte: ContexteComparaison,
  serie: { readonly chargeSaisie: string | null | undefined; readonly repsSaisies: string | null | undefined },
): ComparaisonImmediate | null {
  const reference = contexte.reference;
  if (!reference) return null;

  const chargeKg = getEffectiveLoadKg(parseLoad(serie.chargeSaisie ?? ""));
  if (chargeKg === null || chargeKg <= 0) return null;

  const reps = repsLues(serie.repsSaisies);
  if (reps === null) return null;

  const ecartChargeKg = Math.round((chargeKg - reference.chargeKg) * 100) / 100;
  const sens: SensEcartCharge = ecartChargeKg > 0 ? "hausse" : ecartChargeKg < 0 ? "baisse" : "identique";

  return {
    sens,
    ecartChargeKg,
    // À CHARGE ÉGALE SEULEMENT, et via la primitive du lot B.
    ecartReps: sens === "identique" ? ecartReps(String(reps), reference.reps) : null,
    // À LA HAUSSE SEULEMENT, jugé sur la borne BASSE prescrite.
    tenue: sens === "hausse" ? (reps >= contexte.plage.min ? "tenue" : "insuffisante") : null,
  };
}

/** Le conseil porté sur la série SUIVANTE, d'après la série qu'on vient de faire. */
export type ConseilSerieSuivante = "monter" | "baisser";

/**
 * Faut-il changer la charge à la série suivante ?
 *
 * Règle posée, fourchette 8–13 : au-dessus de la fourchette (14) → `monter` ;
 * en dessous (7) → `baisser` ; DANS la fourchette, bornes comprises (8 à 13)
 * → `null`, il n'y a rien à conseiller.
 *
 * ⚠️ NI HISTORIQUE, NI RÉGLAGE, NI GROUPE, NI MOTEUR. Ce conseil s'affiche dès
 * la première séance, sans aucune référence passée, et sur un exercice sans
 * tarif de progression automatique. Il ne dit pas de combien : seulement dans
 * quel sens.
 */
export function conseilSerieSuivante(
  contexte: ContexteComparaison,
  repsSaisies: string | null | undefined,
): ConseilSerieSuivante | null {
  const reps = repsLues(repsSaisies);
  if (reps === null) return null;
  if (reps > contexte.plage.max) return "monter";
  if (reps < contexte.plage.min) return "baisser";
  return null;
}

/** L'écart de charge tel qu'il s'affiche : `+2 kg`, `-2,5 kg`, `+1 kg / haltère`. */
export function formaterEcartChargeKg(ecartChargeKg: number, unite: UniteCharge): string {
  if (!Number.isFinite(ecartChargeKg)) return "—";
  const signe = ecartChargeKg > 0 ? "+" : "-";
  return `${signe}${formaterChargeUtilisateur(Math.abs(ecartChargeKg), unite)}`;
}

/** Le badge d'écart de charge, verdict compris : `+2 kg ✓`, `-2,5 kg`. */
export function texteEcartCharge(comparaison: ComparaisonImmediate, unite: UniteCharge): string {
  const valeur = formaterEcartChargeKg(comparaison.ecartChargeKg, unite);
  if (comparaison.tenue === "tenue") return `${valeur} ✓`;
  if (comparaison.tenue === "insuffisante") return `${valeur} ✕`;
  return valeur;
}

/** Le libellé lu pour l'écart de charge d'une série. */
export function libelleEcartCharge(comparaison: ComparaisonImmediate, unite: UniteCharge, numeroSerie: number): string {
  const valeur = formaterChargeUtilisateur(Math.abs(comparaison.ecartChargeKg), unite);
  const sens = comparaison.sens === "hausse" ? "de plus" : "de moins";
  const base = `Série ${numeroSerie} : ${valeur} ${sens} que la référence`;
  if (comparaison.tenue === "tenue") return `${base}, charge tenue`;
  if (comparaison.tenue === "insuffisante") return `${base}, répétitions sous la borne basse prescrite`;
  return base;
}

/**
 * Le libellé lu pour la flèche de conseil.
 *
 * ⚠️ IL NOMME LA CELLULE ET LA SÉRIE. La flèche est portée par la cellule
 * CHARGE de la série SUIVANTE : sans lecteur d'écran, la position le dit ;
 * avec, c'est ce libellé qui le dit.
 */
export function libelleConseilSerieSuivante(conseil: ConseilSerieSuivante, numeroSerie: number): string {
  return conseil === "monter"
    ? `Série ${numeroSerie} : augmenter la charge, fourchette dépassée à la série précédente`
    : `Série ${numeroSerie} : réduire la charge, fourchette non atteinte à la série précédente`;
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
  /**
   * Le SENS de la recommandation, `null` si la charge est maintenue.
   *
   * ⚠️ CE N'EST PLUS UN PICTOGRAMME DE CELLULE. Depuis le lot 2, la cellule
   * CHARGE porte la comparaison immédiate (à gauche) et le conseil de série
   * suivante (à droite) ; la recommandation, elle, est passée DANS le champ —
   * placeholder « Reco 47 kg » — et ce sens alimente le libellé accessible
   * qui l'accompagne (`libelleCharge`). Deux flèches identiques dans la même
   * cellule ne voulaient plus rien dire.
   */
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
