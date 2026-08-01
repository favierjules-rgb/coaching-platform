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
});

const exerciseSchema = z.object({
  exerciseName: z.string().min(1).max(200),
  // Musculation : index 0..n. Cardio : 900 + position (contrat historique).
  exerciseOrder: z.number().int().min(0).max(2000),
  rpe: z.number().int().min(1).max(10).nullable(),
  // Enveloppe JSON cardio incluse (commentaire libre de l'élève à l'intérieur).
  comment: z.string().max(10000),
  sets: z.array(setSchema).max(50),
});

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
