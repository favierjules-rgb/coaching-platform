import { z } from "zod";

/**
 * Schéma STRICT du corps de POST /api/student/workout-feedback — extrait de
 * la route (correctif fix/workout-feedback-save-production) pour être testé
 * contre le payload RÉEL du composant sans dépendre de `server-only`.
 *
 * INCIDENT du 01/08/2026 : la première version bornait `exerciseOrder` à 200
 * et `comment` à 2000, alors que le contrat cardio EXISTANT du dépôt
 * (lib/cardio-feedback.ts::serializeCardioBlockResult) émet :
 *   - `exerciseOrder = 900 + position du bloc` (pour trier le cardio APRÈS
 *     la musculation) ;
 *   - `comment = JSON.stringify(CardioBlockResult)` — enveloppe JSON qui
 *     contient notamment le commentaire LIBRE de l'élève.
 * Toute séance contenant un bloc cardio était donc rejetée en 400 avant la
 * moindre écriture. Les bornes ci-dessous couvrent ce contrat ; le schéma
 * reste `.strict()` : ni `prescribed_snapshot`, ni `studentId`, ni
 * `sessionStatus` — toute clé inconnue est toujours rejetée.
 */

const setSchema = z.object({
  setNumber: z.number().int().min(1).max(50),
  loadUsed: z.string().max(200),
  repsDone: z.string().max(200),
  // RPE PAR SÉRIE (option B, feat/student-previous-set-performance) —
  // optionnel/null : une série sans RPE est acceptée, et le contrat cardio
  // existant (serializeCardioBlockResult) n'émet pas cette clé. Mêmes
  // bornes que le CHECK exercise_set_feedback_rpe_check (1-10).
  rpe: z.number().int().min(1).max(10).nullable().optional(),
  })
  // STRICT ici AUSSI (durcissement F3). La strictesse ne portait que sur
  // l'enveloppe : une clé inconnue GLISSÉE DANS UN EXERCICE ou dans une
  // série était silencieusement retirée, jamais refusée. Rien de ce que le
  // dépôt émet n'en dépend — SessionFeedbackSection et
  // lib/cardio-feedback.ts::serializeCardioBlockResult produisent
  // exactement les clés déclarées — mais un `substituteExerciseName` glissé
  // à la main mérite un 400 explicite, pas un silence.
  .strict();

const exerciseSchema = z.object({
  exerciseName: z.string().min(1).max(200),
  // Musculation : index 0..n. Cardio : 900 + position (contrat historique).
  exerciseOrder: z.number().int().min(0).max(2000),
  rpe: z.number().int().min(1).max(10).nullable(),
  // Enveloppe JSON cardio incluse (commentaire libre de l'élève à l'intérieur).
  comment: z.string().max(10000),
  sets: z.array(setSchema).max(50),
  // ── Remplacement d'exercice (F3, feat/training-movement-patterns) ────────
  // `exerciseId` = `workout_exercises.id` de l'exercice PRESCRIT. Optionnel :
  // `null` pour une séance mock ou un bloc cardio, qui n'ont pas d'uuid réel.
  exerciseId: z.uuid().nullable().optional(),
  // Identité de la fiche de banque réellement réalisée. Le NOM n'est jamais
  // accepté du client : il est dérivé côté base. Le schéma reste `.strict()`,
  // donc envoyer `substituteExerciseName` fait toujours échouer la requête.
  substituteExerciseLibraryId: z.uuid().nullable().optional(),
  })
  .strict();

export const workoutFeedbackPayloadSchema = z
  .object({
    sessionKey: z.string().min(1).max(120),
    sessionRefLabel: z.string().max(300),
    completed: z.boolean(),
    globalRpe: z.number().int().min(1).max(10).nullable(),
    globalComment: z.string().max(10000),
    pain: z.string().max(10000),
    exercises: z.array(exerciseSchema).max(60),
    sessionId: z.uuid().nullable().optional(),
    programId: z.uuid().nullable().optional(),
    performedAt: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    durationMinutes: z.number().int().min(1).max(600).nullable().optional(),
  })
  .strict();

export type WorkoutFeedbackRouteBody = z.infer<typeof workoutFeedbackPayloadSchema>;
