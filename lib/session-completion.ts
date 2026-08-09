import { isCardioResultEntryName } from "@/lib/cardio-feedback";
import {
  buildPreviousPerformanceIndex,
  findPreviousPerformance,
  hasRealizedSetInput,
  normalizeExerciseName,
} from "@/lib/previous-performance";
import { calculateExerciseTonnage, getEffectiveLoadKg, parseLoad } from "@/lib/training-metrics";
import type { AdminExerciseFeedbackEntry, AdminStudentFeedback } from "@/types";

/**
 * F2 — LE BILAN DE FIN DE SÉANCE : les chiffres, et rien d'autre.
 *
 * Ce module ne dessine rien et ne parle à personne : il prend un retour qui
 * vient d'être envoyé, l'historique de l'élève, et rend ce que la carte
 * affichera. Tout se prouve dans Node, sur des cas réels.
 *
 * ────────────────────────────────────────────────────────────────────────
 * AUCUNE MIGRATION, AUCUN NOUVEAU CALCUL
 * ────────────────────────────────────────────────────────────────────────
 * Tout vient de ce que la base porte DÉJÀ : `duration_minutes` posé par
 * l'élève, les séries de `exercise_feedback`, et l'historique que
 * `previous-performance` sait indexer depuis F-précédentes. Les charges sont
 * analysées par `parseLoad` — celui-là même qui sert aux métriques du coach.
 * Écrire un second analyseur de « 24 kg / haltère » aurait garanti que les
 * deux finissent par ne plus dire la même chose.
 *
 * ────────────────────────────────────────────────────────────────────────
 * ON NE GONFLE JAMAIS UN CHIFFRE
 * ────────────────────────────────────────────────────────────────────────
 * Une séance de tractions au poids du corps n'a pas de tonnage. On pourrait
 * estimer un poids de corps et l'afficher quand même : ce serait un chiffre
 * inventé, sur un écran de félicitations, à quelqu'un qui n'a aucun moyen de
 * le vérifier. Le tonnage est donc `null` quand rien n'est chiffrable, et
 * marqué PARTIEL dès qu'une seule série échappe au calcul. La carte le dit.
 */

/** Un exercice dont la charge a monté depuis la dernière fois. */
export interface ProgressionExercice {
  /** Nom PRESCRIT — celui que l'élève reconnaît dans sa séance. */
  exerciseName: string;
  avantKg: number;
  apresKg: number;
}

export interface BilanFinSeance {
  /**
   * L'élève a-t-il coché « Séance terminée » ?
   *
   * La case part DÉCOCHÉE et le formulaire s'envoie très bien sans elle : un
   * élève qui a dû s'arrêter en cours de route envoie quand même son retour.
   * La carte s'en sert pour ne pas lui annoncer une séance terminée qu'il n'a
   * pas déclarée — le titre est la seule chose qu'elle affirme, elle doit
   * être vraie.
   */
  seanceTerminee: boolean;
  /** Déclarée par l'élève. `null` s'il ne l'a pas renseignée. */
  dureeMinutes: number | null;
  /** Séries réellement saisies — jamais les séries prescrites. */
  seriesRealisees: number;
  /** `null` quand AUCUNE charge n'était chiffrable. */
  tonnageKg: number | null;
  /**
   * Au moins une série saisie échappe au calcul (poids du corps, assisté,
   * machine sans kilos, charge non renseignée). Le total affiché est alors
   * un PLANCHER, et la carte doit le dire.
   */
  tonnagePartiel: boolean;
  /** Les hausses de charge, de la plus forte à la plus faible. */
  progressions: ProgressionExercice[];
}

/**
 * Nombre de progressions montrées.
 *
 * Trois, pas toutes : la carte est un instant, pas un tableau. Au-delà, on
 * perd la seule information qui compte — « tu as progressé, et voilà où ».
 */
export const PROGRESSIONS_AFFICHEES = 3;

/** Les entrées de MUSCULATION réellement saisies (le cardio a son propre bloc). */
function seriesDeMuscu(entries: readonly AdminExerciseFeedbackEntry[]): AdminExerciseFeedbackEntry[] {
  return entries.filter(
    (entry) =>
      !isCardioResultEntryName(entry.exerciseName) &&
      hasRealizedSetInput({ loadUsed: entry.loadUsed ?? "", repsDone: entry.repsDone ?? "" }),
  );
}

/** Charge effective d'UNE série, en kg — `null` si elle n'est pas chiffrable. */
function chargeEffective(loadUsed: string): number | null {
  return getEffectiveLoadKg(parseLoad(loadUsed ?? ""));
}

/** La charge la plus lourde d'un groupe de séries, ou `null`. */
function chargeMaximale(charges: readonly (number | null)[]): number | null {
  const chiffrables = charges.filter((c): c is number => c !== null && c > 0);
  return chiffrables.length > 0 ? Math.max(...chiffrables) : null;
}

/**
 * Construit le bilan affiché sur la carte de fin de séance.
 *
 * `historique` doit contenir les retours de l'élève ; celui qui vient d'être
 * envoyé est écarté ici, pour qu'une séance ne se compare jamais à
 * elle-même — ce qui rendrait toute progression nulle.
 */
export function construireBilanFinSeance(input: {
  /**
   * `null` accepté : l'écran appelle ce calcul avant de savoir s'il y a un
   * retour à afficher, et un bilan vide se rend très bien — la carte masque
   * simplement toutes ses tuiles. C'est plus honnête que de fabriquer un
   * faux retour pour satisfaire une signature.
   */
  feedback: AdminStudentFeedback | null;
  historique: readonly AdminStudentFeedback[];
  /** Injectée pour que les tests n'aient pas à voyager dans le temps. */
  aujourdhui?: string;
}): BilanFinSeance {
  const { feedback } = input;
  if (!feedback) {
    return {
      seanceTerminee: false,
      dureeMinutes: null,
      seriesRealisees: 0,
      tonnageKg: null,
      tonnagePartiel: false,
      progressions: [],
    };
  }
  const series = seriesDeMuscu(feedback.exerciseEntries);

  /* ── Tonnage ─────────────────────────────────────────────────────────── */
  let total = 0;
  let auMoinsUneChiffrable = false;
  let partiel = false;
  for (const entry of series) {
    // Une entrée = UNE série : d'où le `1`. `calculateExerciseTonnage` gère le
    // doublement des haltères et la moyenne d'une fourchette de répétitions.
    const { tonnageKg, notCalculated } = calculateExerciseTonnage(1, entry.repsDone ?? "", entry.loadUsed ?? "");
    if (notCalculated || tonnageKg <= 0) {
      partiel = true;
      continue;
    }
    total += tonnageKg;
    auMoinsUneChiffrable = true;
  }

  /* ── Progressions ────────────────────────────────────────────────────── */
  const passe = buildPreviousPerformanceIndex({
    feedbacks: input.historique.filter((f) => f.id !== feedback.id),
    studentId: feedback.studentId,
    currentSessionId: feedback.sessionId ?? null,
    today: input.aujourdhui,
  });

  // Charge maximale de CETTE séance, par exercice. On garde le nom tel qu'il
  // s'affiche, mais on regroupe sur le nom NORMALISÉ : « Développé couché »
  // et « developpe couche » sont le même exercice.
  const maintenant = new Map<string, { nom: string; charges: (number | null)[] }>();
  for (const entry of series) {
    const cle = normalizeExerciseName(entry.exerciseName);
    if (!cle) continue;
    const groupe = maintenant.get(cle) ?? { nom: entry.exerciseName, charges: [] };
    groupe.charges.push(chargeEffective(entry.loadUsed ?? ""));
    maintenant.set(cle, groupe);
  }

  const progressions: ProgressionExercice[] = [];
  for (const [cle, groupe] of maintenant) {
    const apres = chargeMaximale(groupe.charges);
    if (apres === null) continue;

    const precedent = findPreviousPerformance(passe, { name: cle });
    if (!precedent) continue;
    const avant = chargeMaximale(Object.values(precedent.sets).map((s) => chargeEffective(s.loadUsed)));
    if (avant === null) continue;

    // STRICTEMENT supérieur. Annoncer une « progression » de 0 kg serait une
    // félicitation vide, et l'élève le verrait tout de suite.
    if (apres > avant) progressions.push({ exerciseName: groupe.nom, avantKg: avant, apresKg: apres });
  }
  progressions.sort((a, b) => b.apresKg - b.avantKg - (a.apresKg - a.avantKg));

  return {
    seanceTerminee: feedback.completed === true,
    dureeMinutes: feedback.durationMinutes ?? null,
    seriesRealisees: series.length,
    tonnageKg: auMoinsUneChiffrable ? Math.round(total) : null,
    tonnagePartiel: partiel,
    progressions: progressions.slice(0, PROGRESSIONS_AFFICHEES),
  };
}

/* ════════════════════════════════════════════════════════════════════════
 * MISE EN FORME — une seule façon d'écrire ces chiffres
 * ════════════════════════════════════════════════════════════════════════ */

/** « 1 h 05 » / « 48 min ». `null` si la durée n'a pas été renseignée. */
export function formatDureeSeance(minutes: number | null): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return null;
  const entières = Math.round(minutes);
  if (entières < 60) return `${entières} min`;
  const heures = Math.floor(entières / 60);
  const reste = entières % 60;
  return reste === 0 ? `${heures} h` : `${heures} h ${String(reste).padStart(2, "0")}`;
}

/**
 * « 4 250 kg » / « 4,3 t » au-delà de la tonne.
 *
 * L'espace des milliers est une ESPACE FINE INSÉCABLE (U+202F) : c'est la
 * règle typographique française, et elle évite qu'un nombre se coupe en deux
 * en fin de ligne sur un téléphone.
 */
export function formatTonnageSeance(kg: number | null): string | null {
  if (kg === null || !Number.isFinite(kg) || kg <= 0) return null;
  if (kg >= 1000) {
    const tonnes = kg / 1000;
    // Une décimale suffit : personne ne lit « 4,27 t » comme une performance.
    return `${tonnes.toFixed(1).replace(".", ",")} t`;
  }
  return `${Math.round(kg)} kg`;
}

/** « 80 → 85 kg ». Les décimales inutiles sont retirées (62,5 reste 62,5). */
export function formatProgression(progression: ProgressionExercice): string {
  const nombre = (v: number) => String(Number(v.toFixed(1))).replace(".", ",");
  return `${nombre(progression.avantKg)} → ${nombre(progression.apresKg)} kg`;
}
