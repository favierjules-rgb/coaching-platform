/**
 * COURBE DE PERFORMANCE PAR EXERCICE, ET DÉTECTION DE STAGNATION.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TOUT EST INDEXÉ PAR OCCURRENCE PROGRAMMÉE, JAMAIS PAR DATE
 * ════════════════════════════════════════════════════════════════════════
 * Une série temporelle « charge par date » mélangerait le lundi, le mercredi
 * et le vendredi d'un même programme — trois exercices identiques faits à
 * trois niveaux d'effort différents. Ici, chaque point porte son occurrence
 * `(semaine, jour)`, et la stagnation se compare À JOUR CONSTANT.
 *
 * ⚠️ AUCUNE SEMAINE N'EST INVENTÉE. Si la semaine 3 n'a pas été réalisée, il
 * n'y a pas de point pour la semaine 3 : ni zéro, ni interpolation, ni report
 * de la semaine 2. La durée d'une stagnation se compte donc en occurrences
 * RÉELLEMENT disponibles.
 */
import {
  formaterChargeUtilisateur,
  seriesRealiseesDe,
  uniteDeLaReference,
  type UniteCharge,
} from "@/lib/indicateurs-progression";
import { normaliserJour, occurrenceDuRetour, type OccurrenceProgrammee } from "@/lib/occurrence-programmee";
import { isCardioResultEntryName } from "@/lib/cardio-feedback";
import { normalizeExerciseName } from "@/lib/previous-performance";
import { referenceDeProgression } from "@/lib/reference-progression";
import { isPrescribedSnapshot } from "@/lib/workout-history";
import type { AdminStudentFeedback } from "@/types";

/* ═══════════════════════════════════════════════════════════════════════
 * 1. LES EXERCICES DISPONIBLES
 * ═══════════════════════════════════════════════════════════════════════ */

/** Un exercice sélectionnable, tel que l'historique de l'élève le contient. */
export interface ExerciceDisponible {
  /** Clé stable : identifiant de banque si connu, sinon nom normalisé. */
  readonly cle: string;
  /** Le nom à afficher — celui de l'occurrence la plus récente. */
  readonly nom: string;
  /** Nombre de séances où il apparaît, pour trier du plus travaillé au moins. */
  readonly occurrences: number;
}

function cleDExercice(nomNormalise: string, libraryId: string | null): string {
  return libraryId ? `banque:${libraryId}` : `nom:${nomNormalise}`;
}

/**
 * Les retours d'entraînement RETENUS : ceux de l'élève, terminés, non
 * futurs. Même filtrage que l'index des performances passées, pour qu'un
 * exercice visible dans « Dernières perfs » soit visible ici aussi.
 */
function retoursRetenus(feedbacks: readonly AdminStudentFeedback[], studentId: string): AdminStudentFeedback[] {
  return feedbacks.filter(
    (f) => f.studentId === studentId && f.type === "entrainement" && f.completed === true && f.exerciseEntries.length > 0,
  );
}

/** Nom normalisé → identifiant de banque, lu dans la photographie du prescrit. */
function banqueParNom(feedback: AdminStudentFeedback): Map<string, string> {
  const table = new Map<string, string>();
  if (!isPrescribedSnapshot(feedback.prescribedSnapshot)) return table;
  for (const bloc of feedback.prescribedSnapshot.blocks) {
    for (const exercice of bloc.exercises) {
      if (exercice.exerciseLibraryId) table.set(normalizeExerciseName(exercice.name), exercice.exerciseLibraryId);
    }
  }
  return table;
}

/**
 * Tous les exercices de musculation de l'historique d'un élève, du plus
 * travaillé au moins travaillé. Le cardio est exclu : ses « séries » ne
 * portent pas de charge et n'ont pas de progression de charge à tracer.
 */
export function exercicesDeLHistorique(
  feedbacks: readonly AdminStudentFeedback[],
  studentId: string,
): ExerciceDisponible[] {
  const table = new Map<string, { nom: string; occurrences: number; recence: string }>();
  for (const feedback of retoursRetenus(feedbacks, studentId)) {
    const banque = banqueParNom(feedback);
    const date = feedback.performedAt ?? feedback.date ?? "";
    const vusDansCeRetour = new Set<string>();
    for (const entree of feedback.exerciseEntries) {
      if (isCardioResultEntryName(entree.exerciseName)) continue;
      const nomNormalise = normalizeExerciseName(entree.exerciseName);
      if (nomNormalise === "") continue;
      const cle = cleDExercice(nomNormalise, banque.get(nomNormalise) ?? null);
      const connu = table.get(cle);
      const premiereFoisDansCeRetour = !vusDansCeRetour.has(cle);
      vusDansCeRetour.add(cle);
      if (!connu) {
        table.set(cle, { nom: entree.exerciseName, occurrences: 1, recence: date });
        continue;
      }
      table.set(cle, {
        // Le nom affiché est celui du retour le PLUS RÉCENT : un exercice
        // renommé se présente sous son nom actuel.
        nom: date > connu.recence ? entree.exerciseName : connu.nom,
        occurrences: connu.occurrences + (premiereFoisDansCeRetour ? 1 : 0),
        recence: date > connu.recence ? date : connu.recence,
      });
    }
  }
  return [...table.entries()]
    .map(([cle, v]) => ({ cle, nom: v.nom, occurrences: v.occurrences }))
    .sort((a, b) => b.occurrences - a.occurrences || a.nom.localeCompare(b.nom, "fr"));
}

/* ═══════════════════════════════════════════════════════════════════════
 * 2. LA SÉRIE D'UN EXERCICE
 * ═══════════════════════════════════════════════════════════════════════ */

export interface PointPerformance {
  readonly occurrence: OccurrenceProgrammee;
  /** Date de réalisation, pour l'axe et le libellé. */
  readonly performedAt: string | null;
  /**
   * Charge EFFECTIVE, en kg — celle qui est comparée d'une occurrence à
   * l'autre. « 24 kg / haltère » vaut 48 ici.
   *
   * ⚠️ NE JAMAIS L'AFFICHER TELLE QUELLE. Passer par
   * `formaterChargeUtilisateur(chargeKg, unite)`, qui la remet dans l'unité de
   * saisie : un coach qui a écrit « 24 kg / haltère » doit lire « 24 kg /
   * haltère », pas « 48 kg ».
   */
  readonly chargeKg: number;
  /** L'unité de saisie de cette performance — pour l'affichage seul. */
  readonly unite: UniteCharge;
  /** Moyenne ARRONDIE des répétitions réalisées (règle du lot A). */
  readonly reps: number;
}

/**
 * La série d'un exercice, triée du plus ancien au plus récent.
 *
 * Un point n'existe QUE si l'occurrence est identifiable et la performance
 * chiffrable : charge constante sur les séries, au moins une série lisible.
 * Les autres retours sont écartés — pas approximés. C'est la même exigence
 * que la référence de progression, et pour la même raison : une charge
 * variable d'une série à l'autre ne donne pas « une » charge.
 */
export function serieDeLExercice(
  feedbacks: readonly AdminStudentFeedback[],
  studentId: string,
  cle: string,
): PointPerformance[] {
  const points: PointPerformance[] = [];
  for (const feedback of retoursRetenus(feedbacks, studentId)) {
    const occurrence = occurrenceDuRetour({
      sessionId: feedback.sessionId,
      prescribedSnapshot: feedback.prescribedSnapshot,
    });
    if (!occurrence) continue;
    const banque = banqueParNom(feedback);

    // Les séries de CET exercice dans CE retour, regroupées par numéro.
    const sets: Record<number, { loadUsed: string; repsDone: string; rpe: number | null }> = {};
    for (const entree of feedback.exerciseEntries) {
      if (isCardioResultEntryName(entree.exerciseName)) continue;
      const nomNormalise = normalizeExerciseName(entree.exerciseName);
      if (cleDExercice(nomNormalise, banque.get(nomNormalise) ?? null) !== cle) continue;
      sets[entree.setNumber] = { loadUsed: entree.loadUsed, repsDone: entree.repsDone, rpe: entree.rpe ?? null };
    }
    if (Object.keys(sets).length === 0) continue;

    const series = seriesRealiseesDe({ sets, exerciseRpe: null, performedAt: null, matchedBy: "name" });
    const lue = referenceDeProgression(series);
    if (!lue.ok) continue;

    points.push({
      occurrence,
      performedAt: feedback.performedAt ?? feedback.date ?? null,
      chargeKg: lue.reference.chargeKg,
      unite: uniteDeLaReference(series),
      reps: lue.reference.reps,
    });
  }
  return points.sort(
    (a, b) =>
      a.occurrence.weekNumber - b.occurrence.weekNumber ||
      (a.performedAt ?? "").localeCompare(b.performedAt ?? "") ||
      normaliserJour(a.occurrence.day).localeCompare(normaliserJour(b.occurrence.day)),
  );
}

/* ═══════════════════════════════════════════════════════════════════════
 * 3. STAGNATION
 * ═══════════════════════════════════════════════════════════════════════ */

/**
 * SEUIL : deux occurrences identiques suffisent à signaler.
 *
 * Décision produit : « même performance pendant 2 occurrences → détectée ».
 * Une seule occurrence ne peut rien dire — il n'y a rien à comparer.
 */
export const OCCURRENCES_POUR_STAGNATION = 2;

export interface Stagnation {
  /** Le jour programmé concerné — la stagnation est toujours à jour constant. */
  readonly day: string;
  /** Nombre d'occurrences CONSÉCUTIVES à performance identique. */
  readonly occurrences: number;
  readonly premiereSemaine: number;
  readonly derniereSemaine: number;
  /** La performance qui ne bouge pas — charge EFFECTIVE. */
  readonly chargeKg: number;
  /** L'unité de saisie, pour que le message parle la langue du coach. */
  readonly unite: UniteCharge;
  readonly reps: number;
}

/**
 * « MÊME PERFORMANCE » = MÊME CHARGE ET MÊME MOYENNE ARRONDIE DE RÉPÉTITIONS.
 *
 * ⚠️ CE N'EST PAS « LE MOTEUR RECOMMANDE LA MÊME CHOSE ». Les deux lectures
 * coïncident sur les cas courants, mais divergent sur un cas précis : plage
 * 8-13, 13 répétitions puis 14. Le moteur recommande la même cible les deux
 * fois (borne haute atteinte ou dépassée, même traitement), alors que l'élève
 * a fait une répétition de plus. Signaler cela comme une stagnation serait
 * faux : la performance a bougé. La règle retenue compare donc la PERFORMANCE,
 * pas la recommandation.
 */
function memePerformance(a: PointPerformance, b: PointPerformance): boolean {
  return a.chargeKg === b.chargeKg && a.reps === b.reps;
}

/**
 * La stagnation la plus longue en cours, ou `null`.
 *
 * On regarde chaque JOUR programmé séparément, on prend ses occurrences
 * disponibles dans l'ordre des semaines, et on remonte depuis la plus récente
 * tant que la performance est identique.
 *
 * ⚠️ « CONSÉCUTIVES » PORTE SUR LES OCCURRENCES DISPONIBLES, PAS SUR LES
 * NUMÉROS DE SEMAINE. Si la semaine 3 n'a pas été réalisée, elle n'existe pas
 * dans la série : compter l'écart de semaines annoncerait une durée pour une
 * semaine sans donnée. Le nombre rendu est donc un nombre d'occurrences
 * réelles, et `premiereSemaine`/`derniereSemaine` permettent de le dire
 * précisément à l'affichage.
 */
export function stagnationEnCours(points: readonly PointPerformance[]): Stagnation | null {
  const parJour = new Map<string, PointPerformance[]>();
  for (const point of points) {
    const jour = normaliserJour(point.occurrence.day);
    const liste = parJour.get(jour) ?? [];
    liste.push(point);
    parJour.set(jour, liste);
  }

  let meilleure: Stagnation | null = null;
  for (const liste of parJour.values()) {
    const ordonnees = [...liste].sort((a, b) => a.occurrence.weekNumber - b.occurrence.weekNumber);
    const derniere = ordonnees[ordonnees.length - 1];
    if (!derniere) continue;

    let compte = 1;
    for (let i = ordonnees.length - 2; i >= 0; i -= 1) {
      if (!memePerformance(ordonnees[i], derniere)) break;
      compte += 1;
    }
    if (compte < OCCURRENCES_POUR_STAGNATION) continue;

    const premiere = ordonnees[ordonnees.length - compte];
    const candidate: Stagnation = {
      day: derniere.occurrence.day,
      occurrences: compte,
      premiereSemaine: premiere.occurrence.weekNumber,
      derniereSemaine: derniere.occurrence.weekNumber,
      chargeKg: derniere.chargeKg,
      unite: derniere.unite,
      reps: derniere.reps,
    };
    // La plus longue gagne ; à égalité, la plus récente.
    if (
      !meilleure ||
      candidate.occurrences > meilleure.occurrences ||
      (candidate.occurrences === meilleure.occurrences && candidate.derniereSemaine > meilleure.derniereSemaine)
    ) {
      meilleure = candidate;
    }
  }
  return meilleure;
}

/**
 * Le message affiché sous le graphique.
 *
 * La durée annoncée est le nombre d'occurrences RÉELLEMENT disponibles, ce qui
 * est aussi le nombre de semaines où l'exercice a été fait ce jour-là. Quand
 * des semaines manquent entre les deux bornes, le message le dit plutôt que
 * de laisser croire à une série continue.
 */
export function messageDeStagnation(nomExercice: string, stagnation: Stagnation): string {
  const semainesCouvertes = stagnation.derniereSemaine - stagnation.premiereSemaine + 1;
  const base = `${nomExercice} à surveiller : stagnation depuis ${stagnation.occurrences} semaines`;
  const jour = ` (${stagnation.day.toLowerCase()}, semaines ${stagnation.premiereSemaine} à ${stagnation.derniereSemaine})`;
  const trou =
    semainesCouvertes > stagnation.occurrences
      ? ` — ${semainesCouvertes - stagnation.occurrences} semaine(s) sans séance dans cet intervalle`
      : "";
  return `${base}${jour}${trou}`;
}

/**
 * La performance figée, écrite dans l'unité de saisie.
 *
 * « 24 kg / haltère × 10 répétitions », jamais « 48 kg × 10 » : le coach doit
 * reconnaître le chiffre qu'il a lui-même prescrit.
 */
export function performanceFigee(stagnation: Stagnation): string {
  return `${formaterChargeUtilisateur(stagnation.chargeKg, stagnation.unite)} × ${stagnation.reps} répétitions`;
}
