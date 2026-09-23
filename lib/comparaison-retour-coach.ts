/**
 * LES INDICATEURS IMMÉDIATS, CÔTÉ COACH — sur un retour DÉJÀ SOUMIS.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Les indicateurs immédiats ne vivaient que dans le formulaire de l'ÉLÈVE
 * (`ExerciseFeedbackCard`). Le coach qui relit un retour voyait « 47 kg ·
 * 10 reps » sans rien qui lui dise si l'élève a monté la charge, ni s'il l'a
 * tenue — l'information qu'il cherche en premier.
 *
 * ⚠️ AUCUNE RÈGLE N'EST RÉÉCRITE ICI, ET C'EST TOUT L'INTÉRÊT. Le verdict
 * ✓/✕, l'écart de charge et l'écart de répétitions viennent de
 * `comparerALaReference` (lib/indicateurs-progression.ts), inchangé. Ce module
 * ne fait que RASSEMBLER ses trois entrées depuis un retour soumis :
 *
 *   • la FOURCHETTE PRESCRITE, lue dans la photographie du prescrit du retour
 *     lui-même — pas dans le programme d'aujourd'hui, qui a pu changer depuis ;
 *   • la RÉFÉRENCE, c'est-à-dire l'occurrence N-1 du même jour, via
 *     `referenceDeLOccurrencePrecedente` — le même repère que côté élève, pour
 *     que les deux écrans ne racontent jamais deux histoires différentes ;
 *   • la SAISIE de chaque série, telle que l'élève l'a enregistrée.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUI N'EST VOLONTAIREMENT PAS REPRIS : LA FLÈCHE DE CONSEIL
 * ────────────────────────────────────────────────────────────────────────
 * ↑/↓ dit « change la charge à la série suivante ». Sur une séance TERMINÉE,
 * ce conseil ne s'adresse à personne : la série suivante a déjà eu lieu.
 * L'afficher serait un pictogramme sans action possible. Le coach reçoit donc
 * les trois indicateurs de CONSTAT, et pas l'affordance de saisie.
 *
 * ⚠️ AUCUNE REQUÊTE. L'historique est déjà chargé par l'écran appelant ; ce
 * module est pur et ne connaît ni Supabase ni le réseau.
 */
import {
  comparerALaReference,
  contexteDeComparaison,
  referenceDeLOccurrencePrecedente,
  uniteDeCharge,
  type ComparaisonImmediate,
  type UniteCharge,
} from "@/lib/indicateurs-progression";
import { occurrenceDuRetour } from "@/lib/occurrence-programmee";
import { buildPreviousPerformanceIndex, normalizeExerciseName } from "@/lib/previous-performance";
import { isCardioResultEntryName } from "@/lib/cardio-feedback";
import { isPrescribedSnapshot } from "@/lib/workout-history";
import type { AdminStudentFeedback } from "@/types";

/** Ce qu'on sait dire d'UNE série d'un retour soumis. */
export interface ComparaisonDeSerie {
  readonly comparaison: ComparaisonImmediate;
  /** L'unité de SAISIE, pour que l'écart s'affiche dans la langue de l'élève. */
  readonly unite: UniteCharge;
}

/**
 * La clé d'une série dans la table rendue : nom NORMALISÉ de l'exercice et
 * numéro de série.
 *
 * Le nom normalisé, et non le nom brut : « Développé Couché » et « developpé
 * couché » sont le même exercice, et la photographie du prescrit ne garantit
 * pas la casse de l'un ou de l'autre.
 */
export function cleDeSerie(exerciseName: string, setNumber: number): string {
  return `${normalizeExerciseName(exerciseName)}::${setNumber}`;
}

/** La prescription d'un exercice, lue dans la photographie du prescrit du retour. */
interface PrescriptionLue {
  readonly reps: string;
  readonly exerciseLibraryId: string | null;
  readonly name: string;
}

/**
 * Nom normalisé → prescription, depuis la PHOTOGRAPHIE DU PRESCRIT du retour.
 *
 * ⚠️ JAMAIS DEPUIS LE PROGRAMME ACTUEL. Le coach a pu changer la fourchette
 * depuis ; juger une séance de la semaine 3 sur la prescription de la semaine
 * 9 rendrait un ✓ ou un ✕ faux. Le snapshot est la prescription qui était en
 * vigueur ce jour-là, c'est la seule qui puisse rendre un verdict honnête.
 */
function prescriptionsDuRetour(retour: AdminStudentFeedback): Map<string, PrescriptionLue> {
  const table = new Map<string, PrescriptionLue>();
  const snapshot = retour.prescribedSnapshot;
  if (!isPrescribedSnapshot(snapshot)) return table;
  for (const bloc of snapshot.blocks) {
    for (const exercice of bloc.exercises) {
      const cle = normalizeExerciseName(exercice.name);
      if (cle === "" || table.has(cle)) continue;
      table.set(cle, {
        reps: exercice.reps ?? "",
        exerciseLibraryId: exercice.exerciseLibraryId ?? null,
        name: exercice.name,
      });
    }
  }
  return table;
}

/**
 * Les comparaisons immédiates de toutes les séries d'un retour soumis.
 *
 * La table est VIDE — et c'est un état normal, jamais un échec — quand :
 * le retour ne porte pas d'occurrence identifiable, la fourchette prescrite
 * n'est pas exploitable, l'occurrence N-1 n'a pas été réalisée, ou la charge
 * et les répétitions ne sont pas chiffrables. Un écran sans badge est
 * préférable à un badge calculé sur la mauvaise séance.
 */
export function comparaisonsDuRetour(entree: {
  readonly retour: AdminStudentFeedback;
  /** L'historique de l'élève, déjà chargé par l'écran. Le retour relu en fait partie. */
  readonly historique: readonly AdminStudentFeedback[];
}): ReadonlyMap<string, ComparaisonDeSerie> {
  const table = new Map<string, ComparaisonDeSerie>();
  const { retour, historique } = entree;

  const occurrence = occurrenceDuRetour({
    sessionId: retour.sessionId,
    prescribedSnapshot: retour.prescribedSnapshot,
  });
  if (!occurrence) return table;

  // ⚠️ L'INDEX EXCLUT LE RETOUR RELU (`currentSessionId`) : sans cela, une
  // séance pourrait se comparer à elle-même. Et `today` est la date de CE
  // retour, pour qu'une séance POSTÉRIEURE ne serve jamais de référence à une
  // séance antérieure qu'on relit après coup.
  const index = buildPreviousPerformanceIndex({
    feedbacks: [...historique],
    studentId: retour.studentId,
    currentSessionId: retour.sessionId ?? null,
    ...(retour.performedAt ?? retour.date ? { today: (retour.performedAt ?? retour.date) as string } : {}),
  });

  const prescriptions = prescriptionsDuRetour(retour);

  for (const entree_ of retour.exerciseEntries) {
    // Les lignes « Cardio · Résultats » ne sont pas des séries de musculation :
    // elles ne portent pas de charge et n'ont rien à comparer.
    if (isCardioResultEntryName(entree_.exerciseName)) continue;
    const cle = normalizeExerciseName(entree_.exerciseName);
    const prescription = prescriptions.get(cle);
    if (!prescription) continue;

    const reference = referenceDeLOccurrencePrecedente(
      index,
      { name: prescription.name, libraryExerciseId: prescription.exerciseLibraryId },
      occurrence,
    );
    const contexte = contexteDeComparaison({ repsPrescrites: prescription.reps, reference });
    if (!contexte) continue;

    const comparaison = comparerALaReference(contexte, {
      chargeSaisie: entree_.loadUsed,
      repsSaisies: entree_.repsDone,
    });
    if (!comparaison) continue;

    // L'unité vient de la charge SAISIE par l'élève sur CETTE série : c'est
    // celle qu'il faut réafficher, et elle ne dépend pas de la référence.
    table.set(cleDeSerie(entree_.exerciseName, entree_.setNumber), {
      comparaison,
      unite: uniteDeCharge(entree_.loadUsed),
    });
  }

  return table;
}
