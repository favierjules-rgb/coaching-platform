import { z } from "zod";

import { estRpeSurLaGrille } from "@/lib/rpe";

import { FEEDBACK_VIDEO_PATH_SHAPE } from "@/lib/feedback-video";

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

/**
 * Un RPE valide : de `min` à `max`, PAR PAS DE 0,5.
 *
 * `Number.isInteger(v * 2)` est le contrôle exact ici, et pas une
 * approximation : seuls les multiples de 0,5 sont représentés SANS PERTE en
 * binaire, donc 7,5 × 2 vaut exactement 15 tandis que 7,2 × 2 vaut
 * 14,4 — non entier. Aucune tolérance à régler, aucun epsilon.
 *
 * Les bornes restent PARAMÉTRÉES parce que le schéma n'en a pas qu'une :
 * les retours d'élève vont de 1 à 10 (CHECK exercise_set_feedback_rpe_check,
 * workout_feedback_global_rpe_check), une cible de segment cardio part de 0
 * (training_prescriptions_target_rpe_check). On ajoute le demi-point, on
 * n'aligne pas les bornes entre elles.
 */
function rpeDemiPoint(min: number, max: number) {
  return z
    .number()
    .min(min)
    .max(max)
    .refine(estRpeSurLaGrille, {
      message: "Le RPE avance par pas de 0,5 (par exemple 7 ou 7,5).",
    });
}

const setSchema = z.object({
  setNumber: z.number().int().min(1).max(50),
  loadUsed: z.string().max(200),
  repsDone: z.string().max(200),
  // RPE PAR SÉRIE (option B, feat/student-previous-set-performance) —
  // optionnel/null : une série sans RPE est acceptée, et le contrat cardio
  // existant (serializeCardioBlockResult) n'émet pas cette clé. Mêmes
  // bornes que le CHECK exercise_set_feedback_rpe_check (1-10), et même pas
  // de 0,5 depuis la migration 20260830090000.
  rpe: rpeDemiPoint(1, 10).nullable().optional(),
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
  rpe: rpeDemiPoint(1, 10).nullable(),
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
  // ── Vidéo de technique (F4, feat/student-feedback-video) ────────────────
  // Le CHEMIN dans le bucket privé, jamais une URL : une URL signée est un
  // jeton d'accès qui périme, et l'accepter du client reviendrait à laisser
  // écrire n'importe quelle adresse dans le retour. La forme est validée
  // ici ET par la contrainte SQL du même nom ; l'APPARTENANCE, elle, est
  // tranchée par le trigger — un chemin bien formé qui désigne le dossier
  // d'un autre élève passe ce schéma et se fait refuser par la base.
  videoPath: z
    .string()
    .regex(FEEDBACK_VIDEO_PATH_SHAPE, "chemin de vidéo non conforme")
    .nullable()
    .optional(),
  })
  .strict();

export const workoutFeedbackPayloadSchema = z
  .object({
    sessionKey: z.string().min(1).max(120),
    sessionRefLabel: z.string().max(300),
    completed: z.boolean(),
    globalRpe: rpeDemiPoint(1, 10).nullable(),
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
