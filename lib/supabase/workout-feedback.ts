import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type {
  AdminExerciseFeedbackEntry,
  AdminStudentFeedback,
  FeedbackStatus,
  SupabaseExerciseFeedback,
  SupabaseExerciseSetFeedback,
  SupabaseWorkoutFeedback,
  WorkoutFeedbackPayload,
} from "@/types";
import type { Database } from "@/types/supabase";
import {
  buildPrescribedSnapshot,
  sanitizeDurationMinutes,
  sanitizePerformedAt,
  type PrescribedSnapshot,
  type SnapshotBlockRow,
  type SnapshotExerciseRow,
  type SnapshotSessionRow,
} from "@/lib/workout-history";

/**
 * Couche d'accès aux retours d'entraînement Supabase (tables
 * `workout_feedback`, `exercise_feedback`, `exercise_set_feedback`).
 *
 * Comme lib/supabase/students.ts, toutes les lectures renvoient un résultat
 * "vide" (jamais d'exception) aussi bien quand Supabase n'a réellement
 * aucune donnée qu'en cas d'erreur (RLS, réseau...) — warning dev
 * uniquement, jamais bloquant, pour préserver le repli mock/localStorage.
 *
 * Les lignes sont converties vers `AdminStudentFeedback` /
 * `AdminExerciseFeedbackEntry` (déjà utilisés par /admin/retours,
 * FeedbackDetailModal et la section "Retours récents" de
 * /admin/eleves/[studentId]) pour que ces composants n'aient rien à
 * changer.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

type WorkoutFeedbackRow = Database["public"]["Tables"]["workout_feedback"]["Row"];
type ExerciseFeedbackRow = Database["public"]["Tables"]["exercise_feedback"]["Row"];
type ExerciseSetFeedbackRow = Database["public"]["Tables"]["exercise_set_feedback"]["Row"];

/**
 * Lignes réelles de la séance pour la photographie du prescrit (phase 1,
 * feat/student-workout-history). Le snapshot n'est JAMAIS accepté tel quel
 * depuis le navigateur : il est reconstruit ici à partir de ce que la base
 * (sous RLS) contient réellement au moment de la soumission. Trois lectures
 * ciblées — pas de dépendance au chargeur complet des programmes.
 * Injectable dans saveWorkoutFeedback pour les tests hors ligne.
 */
export async function loadSessionRowsForSnapshot(
  supabase: TypedSupabaseClient,
  sessionId: string,
): Promise<{ session: SnapshotSessionRow; blocks: SnapshotBlockRow[]; exercises: SnapshotExerciseRow[] } | null> {
  const { data: sessionRow, error: sessionError } = await supabase
    .from("workout_sessions")
    .select("id, name, day")
    .eq("id", sessionId)
    .maybeSingle();
  devWarn("loadSessionRowsForSnapshot (session)", sessionError);
  if (!sessionRow) return null;

  const [blocksResult, exercisesResult] = await Promise.all([
    supabase.from("training_blocks").select("id, title, block_type, position").eq("session_id", sessionId),
    supabase
      .from("workout_exercises")
      .select("block_id, exercise_library_id, name, order_index, sets, reps, recommended_load, rest_seconds, tempo, notes")
      .eq("session_id", sessionId),
  ]);
  devWarn("loadSessionRowsForSnapshot (blocs)", blocksResult.error);
  devWarn("loadSessionRowsForSnapshot (exercices)", exercisesResult.error);

  return {
    session: sessionRow,
    blocks: blocksResult.data ?? [],
    exercises: exercisesResult.data ?? [],
  };
}

export type SnapshotRowsLoader = typeof loadSessionRowsForSnapshot;

function devWarn(context: string, error: { message: string } | null): void {
  if (error && process.env.NODE_ENV === "development") {
    console.warn(`[Supabase] ${context} :`, error.message);
  }
}

/* ─── Row -> types Supabase* (camelCase) ─── */

function mapWorkoutFeedbackRow(row: WorkoutFeedbackRow): SupabaseWorkoutFeedback {
  return {
    id: row.id,
    studentId: row.student_id,
    sessionId: row.session_id,
    programId: row.program_id,
    sessionKey: row.session_key,
    sessionRefLabel: row.session_ref_label,
    completed: row.completed,
    globalRpe: row.global_rpe,
    globalComment: row.global_comment,
    pain: row.pain,
    status: row.status as FeedbackStatus,
    coachReply: row.coach_reply,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    prescribedSnapshot: row.prescribed_snapshot ?? null,
    performedAt: row.performed_at ?? null,
    durationMinutes: row.duration_minutes ?? null,
    sessionStatus: row.session_status ?? null,
  };
}

function mapExerciseFeedbackRow(row: ExerciseFeedbackRow): SupabaseExerciseFeedback {
  return {
    id: row.id,
    workoutFeedbackId: row.workout_feedback_id,
    studentId: row.student_id,
    exerciseId: row.exercise_id,
    exerciseName: row.exercise_name,
    exerciseOrder: row.exercise_order,
    rpe: row.rpe,
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapExerciseSetFeedbackRow(row: ExerciseSetFeedbackRow): SupabaseExerciseSetFeedback {
  return {
    id: row.id,
    exerciseFeedbackId: row.exercise_feedback_id,
    studentId: row.student_id,
    setNumber: row.set_number,
    loadUsed: row.load_used,
    repsDone: row.reps_done,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Compose un AdminStudentFeedback (forme mock existante) à partir d'un
 * retour Supabase et de ses exercices/séries déjà triés. `exerciseEntries`
 * reste volontairement une liste à plat (une entrée par série, avec
 * exerciseName/rpe/comment dupliqués) pour correspondre exactement à ce que
 * produit déjà SessionFeedbackSection côté mock — un exercice sans aucune
 * série renseignée ne produit aucune entrée, comme en mock.
 */
function toAdminStudentFeedback(
  feedback: SupabaseWorkoutFeedback,
  exercises: SupabaseExerciseFeedback[],
  setsByExerciseFeedbackId: Map<string, SupabaseExerciseSetFeedback[]>,
): AdminStudentFeedback {
  const exerciseEntries: AdminExerciseFeedbackEntry[] = exercises
    .slice()
    .sort((a, b) => (a.exerciseOrder ?? 0) - (b.exerciseOrder ?? 0))
    .flatMap((exercise) => {
      const sets = (setsByExerciseFeedbackId.get(exercise.id) ?? [])
        .slice()
        .sort((a, b) => a.setNumber - b.setNumber);
      return sets.map((set) => ({
        exerciseId: exercise.exerciseId ?? undefined,
        exerciseName: exercise.exerciseName,
        setNumber: set.setNumber,
        loadUsed: set.loadUsed,
        repsDone: set.repsDone,
        rpe: exercise.rpe,
        comment: exercise.comment,
      }));
    });

  return {
    id: feedback.id,
    studentId: feedback.studentId,
    type: "entrainement",
    sessionId: feedback.sessionKey ?? undefined,
    programId: feedback.programId,
    refLabel: feedback.sessionRefLabel || "Séance",
    date: feedback.submittedAt.slice(0, 10),
    completed: feedback.completed,
    rpe: feedback.globalRpe,
    pain: feedback.pain,
    comment: feedback.globalComment,
    exerciseEntries,
    status: feedback.status,
    coachReply: feedback.coachReply,
    prescribedSnapshot: feedback.prescribedSnapshot ?? null,
    performedAt: feedback.performedAt ?? null,
    durationMinutes: feedback.durationMinutes ?? null,
    sessionStatus: (feedback.sessionStatus as "done" | "missed" | null) ?? null,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt,
  };
}

/** Récupère et regroupe les exercices/séries de un ou plusieurs retours en un minimum de requêtes. */
async function loadExercisesAndSets(
  supabase: TypedSupabaseClient,
  workoutFeedbackIds: string[],
): Promise<{
  exercisesByFeedbackId: Map<string, SupabaseExerciseFeedback[]>;
  setsByExerciseFeedbackId: Map<string, SupabaseExerciseSetFeedback[]>;
}> {
  if (workoutFeedbackIds.length === 0) {
    return { exercisesByFeedbackId: new Map(), setsByExerciseFeedbackId: new Map() };
  }

  const { data: exerciseRows, error: exerciseError } = await supabase
    .from("exercise_feedback")
    .select("*")
    .in("workout_feedback_id", workoutFeedbackIds);
  devWarn("loadExercisesAndSets (exercise_feedback)", exerciseError);
  const exercises = (exerciseRows ?? []).map(mapExerciseFeedbackRow);

  const exerciseIds = exercises.map((exercise) => exercise.id);
  const { data: setRows, error: setsError } =
    exerciseIds.length > 0
      ? await supabase.from("exercise_set_feedback").select("*").in("exercise_feedback_id", exerciseIds)
      : { data: [] as ExerciseSetFeedbackRow[], error: null };
  devWarn("loadExercisesAndSets (exercise_set_feedback)", setsError);
  const sets = (setRows ?? []).map(mapExerciseSetFeedbackRow);

  const exercisesByFeedbackId = new Map<string, SupabaseExerciseFeedback[]>();
  for (const exercise of exercises) {
    const list = exercisesByFeedbackId.get(exercise.workoutFeedbackId) ?? [];
    list.push(exercise);
    exercisesByFeedbackId.set(exercise.workoutFeedbackId, list);
  }

  const setsByExerciseFeedbackId = new Map<string, SupabaseExerciseSetFeedback[]>();
  for (const set of sets) {
    const list = setsByExerciseFeedbackId.get(set.exerciseFeedbackId) ?? [];
    list.push(set);
    setsByExerciseFeedbackId.set(set.exerciseFeedbackId, list);
  }

  return { exercisesByFeedbackId, setsByExerciseFeedbackId };
}

/* ─── Lecture ─── */

/**
 * Retour déjà soumis par un élève pour une séance donnée (identifiée par
 * `sessionKey`, l'id mock stable de la séance), ou `null` si aucun retour
 * n'existe encore — utilisé par SessionFeedbackSection pour préremplir /
 * afficher le récapitulatif au lieu du formulaire vierge.
 */
export async function getWorkoutFeedbackBySession(
  supabase: TypedSupabaseClient,
  studentId: string,
  sessionKey: string,
): Promise<AdminStudentFeedback | null> {
  const { data, error } = await supabase
    .from("workout_feedback")
    .select("*")
    .eq("student_id", studentId)
    .eq("session_key", sessionKey)
    .maybeSingle();
  devWarn("getWorkoutFeedbackBySession", error);
  if (!data) {
    return null;
  }

  const feedback = mapWorkoutFeedbackRow(data);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(supabase, [feedback.id]);
  return toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId);
}

/** Liste de tous les retours Supabase pour /admin/retours, plus récents en premier. */
export async function getAdminWorkoutFeedbackList(supabase: TypedSupabaseClient): Promise<AdminStudentFeedback[]> {
  const { data, error } = await supabase
    .from("workout_feedback")
    .select("*")
    .order("submitted_at", { ascending: false });
  devWarn("getAdminWorkoutFeedbackList", error);
  if (!data || data.length === 0) {
    return [];
  }

  const feedbacks = data.map(mapWorkoutFeedbackRow);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(
    supabase,
    feedbacks.map((f) => f.id),
  );
  return feedbacks.map((feedback) =>
    toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId),
  );
}

/** Retours Supabase d'un élève précis, pour la section "Retours récents" de /admin/eleves/[studentId]. */
export async function getWorkoutFeedbackForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminStudentFeedback[]> {
  const { data, error } = await supabase
    .from("workout_feedback")
    .select("*")
    .eq("student_id", studentId)
    .order("submitted_at", { ascending: false });
  devWarn("getWorkoutFeedbackForStudent", error);
  if (!data || data.length === 0) {
    return [];
  }

  const feedbacks = data.map(mapWorkoutFeedbackRow);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(
    supabase,
    feedbacks.map((f) => f.id),
  );
  return feedbacks.map((feedback) =>
    toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId),
  );
}

/** `null` si le retour n'existe pas/erreur — utilisé pour un rafraîchissement ciblé du détail. */
export async function getAdminWorkoutFeedbackDetail(
  supabase: TypedSupabaseClient,
  feedbackId: string,
): Promise<AdminStudentFeedback | null> {
  const { data, error } = await supabase.from("workout_feedback").select("*").eq("id", feedbackId).maybeSingle();
  devWarn("getAdminWorkoutFeedbackDetail", error);
  if (!data) {
    return null;
  }

  const feedback = mapWorkoutFeedbackRow(data);
  const { exercisesByFeedbackId, setsByExerciseFeedbackId } = await loadExercisesAndSets(supabase, [feedback.id]);
  return toAdminStudentFeedback(feedback, exercisesByFeedbackId.get(feedback.id) ?? [], setsByExerciseFeedbackId);
}

/* ─── Écriture ─── */

/**
 * Enregistre le retour complet d'une séance (upsert par student_id +
 * sessionKey, voir la contrainte unique sur workout_feedback) : si un
 * retour existe déjà, ses champs sont mis à jour et ses exercices/séries
 * sont remplacés (delete + reinsert, plus simple et tout aussi correct
 * qu'un diff fin vu la fréquence de resoumission) — le statut existant
 * (traité/important) n'est jamais réinitialisé par une mise à jour. Sinon
 * un nouveau retour est créé avec le statut par défaut "a-traiter".
 *
 * `payload.exercises` doit déjà être filtré en amont (un exercice sans
 * aucune série renseignée ne doit pas être transmis), comme le fait
 * SessionFeedbackSection côté mock.
 */
export async function saveWorkoutFeedback(
  supabase: TypedSupabaseClient,
  payload: WorkoutFeedbackPayload,
  loadSnapshotRows: SnapshotRowsLoader = loadSessionRowsForSnapshot,
): Promise<AdminStudentFeedback | null> {
  const { data: existing, error: lookupError } = await supabase
    .from("workout_feedback")
    .select("id, status, coach_reply, prescribed_snapshot, performed_at")
    .eq("student_id", payload.studentId)
    .eq("session_key", payload.sessionKey)
    .maybeSingle();
  devWarn("saveWorkoutFeedback (lookup)", lookupError);

  const now = new Date().toISOString();

  // ── Historique (phase 1) ─────────────────────────────────────────────────
  // La photographie du prescrit n'est prise qu'à la PREMIÈRE soumission d'une
  // séance terminée, et jamais réécrite ensuite (garde applicative ici, et
  // trigger workout_feedback_snapshot_immutable côté base) : une nouvelle
  // soumission met à jour le réalisé, jamais la photographie d'origine.
  const dejaFige = Boolean(existing?.prescribed_snapshot);
  let snapshot: PrescribedSnapshot | null = null;
  if (payload.completed && !dejaFige && payload.sessionId) {
    const lignes = await loadSnapshotRows(supabase, payload.sessionId);
    if (lignes) {
      snapshot = buildPrescribedSnapshot(lignes.session, lignes.blocks, lignes.exercises, now);
    }
  }
  // La date de réalisation est conservée telle que posée à l'origine ; à
  // défaut, la date (validée) de cette soumission.
  const performedAt = payload.completed
    ? (existing?.performed_at ?? sanitizePerformedAt(payload.performedAt))
    : null;
  const durationMinutes = sanitizeDurationMinutes(payload.durationMinutes);
  const sessionStatus = payload.completed ? "done" : null;
  const champsHistorique = {
    performed_at: performedAt,
    duration_minutes: durationMinutes,
    session_status: sessionStatus,
    ...(snapshot ? { prescribed_snapshot: snapshot as unknown as Record<string, unknown> } : {}),
  };

  let feedbackId: string;
  let status: FeedbackStatus;
  let coachReply: string;

  if (existing) {
    feedbackId = existing.id;
    status = existing.status as FeedbackStatus;
    coachReply = existing.coach_reply;
    const { error: updateError } = await supabase
      .from("workout_feedback")
      .update({
        session_id: payload.sessionId ?? null,
        program_id: payload.programId ?? null,
        session_ref_label: payload.sessionRefLabel,
        completed: payload.completed,
        global_rpe: payload.globalRpe,
        global_comment: payload.globalComment,
        pain: payload.pain,
        submitted_at: now,
        updated_at: now,
        ...champsHistorique,
      })
      .eq("id", feedbackId);
    devWarn("saveWorkoutFeedback (update)", updateError);

    const { error: deleteError } = await supabase.from("exercise_feedback").delete().eq("workout_feedback_id", feedbackId);
    devWarn("saveWorkoutFeedback (delete previous exercises)", deleteError);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("workout_feedback")
      .insert({
        student_id: payload.studentId,
        session_id: payload.sessionId ?? null,
        program_id: payload.programId ?? null,
        session_key: payload.sessionKey,
        session_ref_label: payload.sessionRefLabel,
        completed: payload.completed,
        global_rpe: payload.globalRpe,
        global_comment: payload.globalComment,
        pain: payload.pain,
        submitted_at: now,
        ...champsHistorique,
      })
      .select("id, status, coach_reply")
      .single();
    devWarn("saveWorkoutFeedback (insert)", insertError);
    if (!inserted) {
      return null;
    }
    feedbackId = inserted.id;
    status = inserted.status as FeedbackStatus;
    coachReply = inserted.coach_reply;
  }

  const exerciseEntries: AdminExerciseFeedbackEntry[] = [];
  for (const exercise of payload.exercises) {
    if (exercise.sets.length === 0) continue;
    const { data: exerciseRow, error: exerciseError } = await supabase
      .from("exercise_feedback")
      .insert({
        workout_feedback_id: feedbackId,
        student_id: payload.studentId,
        exercise_name: exercise.exerciseName,
        exercise_order: exercise.exerciseOrder,
        rpe: exercise.rpe,
        comment: exercise.comment,
      })
      .select("id")
      .single();
    devWarn("saveWorkoutFeedback (exercise insert)", exerciseError);
    if (!exerciseRow) continue;

    const { error: setsError } = await supabase.from("exercise_set_feedback").insert(
      exercise.sets.map((set) => ({
        exercise_feedback_id: exerciseRow.id,
        student_id: payload.studentId,
        set_number: set.setNumber,
        load_used: set.loadUsed,
        reps_done: set.repsDone,
      })),
    );
    devWarn("saveWorkoutFeedback (sets insert)", setsError);

    for (const set of exercise.sets) {
      exerciseEntries.push({
        exerciseName: exercise.exerciseName,
        setNumber: set.setNumber,
        loadUsed: set.loadUsed,
        repsDone: set.repsDone,
        rpe: exercise.rpe,
        comment: exercise.comment,
      });
    }
  }

  await logActivityEvent(supabase, {
    studentId: payload.studentId,
    actorType: "student",
    eventType: "workout_feedback_submitted",
    title: "Retour entraînement envoyé",
    description: payload.sessionRefLabel ? `Retour envoyé pour "${payload.sessionRefLabel}".` : "Retour d'entraînement envoyé.",
    metadata: buildStudentActivityLink(payload.studentId),
  });

  return {
    id: feedbackId,
    studentId: payload.studentId,
    type: "entrainement",
    sessionId: payload.sessionKey,
    programId: payload.programId ?? null,
    refLabel: payload.sessionRefLabel || "Séance",
    date: now.slice(0, 10),
    completed: payload.completed,
    rpe: payload.globalRpe,
    pain: payload.pain,
    comment: payload.globalComment,
    exerciseEntries,
    status,
    coachReply,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateWorkoutFeedbackStatus(
  supabase: TypedSupabaseClient,
  feedbackId: string,
  status: FeedbackStatus,
): Promise<boolean> {
  const { error } = await supabase
    .from("workout_feedback")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", feedbackId);
  devWarn("updateWorkoutFeedbackStatus", error);
  return !error;
}

export function markWorkoutFeedbackReviewed(supabase: TypedSupabaseClient, feedbackId: string): Promise<boolean> {
  return updateWorkoutFeedbackStatus(supabase, feedbackId, "traité");
}

export function markWorkoutFeedbackImportant(supabase: TypedSupabaseClient, feedbackId: string): Promise<boolean> {
  return updateWorkoutFeedbackStatus(supabase, feedbackId, "important");
}

/** Comme useAdminData().addCoachReply côté mock : enregistre la réponse et marque le retour "traité". */
export async function updateWorkoutFeedbackCoachReply(
  supabase: TypedSupabaseClient,
  feedbackId: string,
  reply: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("workout_feedback")
    .update({ coach_reply: reply, status: "traité", updated_at: new Date().toISOString() })
    .eq("id", feedbackId);
  devWarn("updateWorkoutFeedbackCoachReply", error);
  return !error;
}
