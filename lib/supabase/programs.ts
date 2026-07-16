import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type { ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import type { AdminExercise, AdminProgram, AdminWorkoutSession } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès aux programmes Supabase (tables `programs`, `program_weeks`,
 * `workout_sessions`, `workout_exercises`) et à leur assignation aux élèves
 * (table `assignments`, content_type = "programme" — voir supabase/schema.sql
 * sections 10-14 et 25, déjà en place côté base, jamais encore branchées à
 * l'app avant cette étape).
 *
 * Comme lib/supabase/students.ts et lib/supabase/workout-feedback.ts, toutes
 * les lectures renvoient un résultat "vide" (jamais d'exception) aussi bien
 * quand Supabase n'a réellement aucune donnée qu'en cas d'erreur (RLS,
 * réseau...) — warning dev uniquement, jamais bloquant, pour préserver le
 * repli mock/localStorage.
 *
 * Les lignes sont composées en `AdminProgram` / `AdminWorkoutSession` /
 * `AdminExercise` (formes mock déjà utilisées par tout l'admin et l'élève,
 * voir types/index.ts) pour que ProgramBuilder et les pages d'affichage
 * n'aient rien à changer.
 *
 * La banque d'exercices (`exercise_library`) est branchée à Supabase depuis
 * le chantier "supabase-exercise-library" (voir lib/supabase/exercise-library.ts).
 * `workout_exercises.exercise_library_id` référence optionnellement
 * l'exercice source, mais tous les champs affichés (nom, vidéo, groupe
 * musculaire...) restent copiés par valeur à l'ajout — une modification
 * ultérieure de l'exercice dans la banque n'affecte jamais un programme déjà
 * enregistré.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];
type WorkoutSessionRow = Database["public"]["Tables"]["workout_sessions"]["Row"];
type WorkoutExerciseRow = Database["public"]["Tables"]["workout_exercises"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["assignments"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) {
      list.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

/* ─── Row -> AdminProgram (composition) ─── */

function mapExerciseRow(row: WorkoutExerciseRow): AdminExercise {
  return {
    id: row.id,
    order: row.order_index,
    name: row.name,
    sets: row.sets,
    reps: row.reps,
    restSeconds: row.rest_seconds,
    tempo: row.tempo,
    recommendedLoad: row.recommended_load,
    videoUrl: row.video_url,
    notes: row.notes,
    muscleGroup: row.muscle_group ?? undefined,
    libraryExerciseId: row.exercise_library_id ?? undefined,
  };
}

function mapSessionRow(
  row: WorkoutSessionRow,
  weekNumber: number,
  exercises: AdminExercise[],
): AdminWorkoutSession {
  return {
    id: row.id,
    programId: row.program_id,
    weekNumber,
    day: row.day,
    isRestDay: row.is_rest_day,
    name: row.name,
    muscleGroup: row.muscle_group,
    durationMinutes: row.duration_minutes ?? 0,
    warmup: row.warmup,
    coachNotes: row.coach_notes,
    exercises: exercises.slice().sort((a, b) => a.order - b.order),
  };
}

function mapProgramRow(row: ProgramRow, sessions: AdminWorkoutSession[], assignedStudentIds: string[]): AdminProgram {
  return {
    id: row.id,
    name: row.name,
    goal: row.goal,
    level: row.level,
    durationWeeks: row.duration_weeks,
    description: row.description,
    status: row.status,
    assignedStudentIds,
    sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Charge et compose un ensemble de programmes complets (semaines/séances/exercices/assignations) en un minimum de requêtes. */
async function loadPrograms(supabase: TypedSupabaseClient, programRows: ProgramRow[]): Promise<AdminProgram[]> {
  if (programRows.length === 0) {
    return [];
  }
  const programIds = programRows.map((p) => p.id);

  const [weeksResult, assignmentsResult] = await Promise.all([
    supabase.from("program_weeks").select("*").in("program_id", programIds),
    supabase.from("assignments").select("*").eq("content_type", "programme").in("content_id", programIds),
  ]);
  devWarn("loadPrograms (program_weeks)", weeksResult.error);
  devWarn("loadPrograms (assignments)", assignmentsResult.error);
  const weekRows = weeksResult.data ?? [];
  const assignmentRows: AssignmentRow[] = assignmentsResult.data ?? [];

  const weekIds = weekRows.map((w) => w.id);
  const { data: sessionRowsRaw, error: sessionsError } =
    weekIds.length > 0
      ? await supabase.from("workout_sessions").select("*").in("program_week_id", weekIds)
      : { data: [] as WorkoutSessionRow[], error: null };
  devWarn("loadPrograms (workout_sessions)", sessionsError);
  const sessionRows = sessionRowsRaw ?? [];

  const sessionIds = sessionRows.map((s) => s.id);
  const { data: exerciseRowsRaw, error: exercisesError } =
    sessionIds.length > 0
      ? await supabase.from("workout_exercises").select("*").in("session_id", sessionIds)
      : { data: [] as WorkoutExerciseRow[], error: null };
  devWarn("loadPrograms (workout_exercises)", exercisesError);
  const exerciseRows = exerciseRowsRaw ?? [];

  const weeksByProgram = groupBy(weekRows, (w) => w.program_id);
  const sessionsByWeek = groupBy(sessionRows, (s) => s.program_week_id);
  const exercisesBySession = groupBy(exerciseRows, (e) => e.session_id);
  const assignmentsByProgram = groupBy(assignmentRows, (a) => a.content_id);

  return programRows.map((programRow) => {
    const weeksForProgram = weeksByProgram.get(programRow.id) ?? [];
    const weekNumberById = new Map(weeksForProgram.map((w) => [w.id, w.week_number]));
    const sessions = weeksForProgram
      .flatMap((week) => sessionsByWeek.get(week.id) ?? [])
      .map((sessionRow) =>
        mapSessionRow(
          sessionRow,
          weekNumberById.get(sessionRow.program_week_id) ?? 0,
          (exercisesBySession.get(sessionRow.id) ?? []).map(mapExerciseRow),
        ),
      );
    const assignedStudentIds = (assignmentsByProgram.get(programRow.id) ?? []).map((a) => a.student_id);
    return mapProgramRow(programRow, sessions, assignedStudentIds);
  });
}

/* ─── Lecture ─── */

/** Liste de tous les programmes Supabase pour /admin/programmes, plus récents en premier. */
export async function getPrograms(supabase: TypedSupabaseClient): Promise<AdminProgram[]> {
  const { data, error } = await supabase.from("programs").select("*").order("created_at", { ascending: false });
  devWarn("getPrograms", error);
  return loadPrograms(supabase, data ?? []);
}

/**
 * Tous les programmes réellement assignés à un élève (un élève peut en
 * théorie avoir plusieurs assignations), plus récemment assigné en premier —
 * pour la grille "Mes programmes" de /entrainement (équivalent réel de
 * `trainingPrograms` en mock). Tableau vide si aucun programme n'est
 * assigné.
 */
export async function getAssignedProgramsForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminProgram[]> {
  const { data: assignmentRows, error: assignmentError } = await supabase
    .from("assignments")
    .select("content_id, assigned_at")
    .eq("student_id", studentId)
    .eq("content_type", "programme")
    .order("assigned_at", { ascending: false });
  devWarn("getAssignedProgramsForStudent (assignments)", assignmentError);
  if (!assignmentRows || assignmentRows.length === 0) {
    return [];
  }

  const orderedProgramIds = assignmentRows.map((a) => a.content_id);
  const { data: programRows, error: programsError } = await supabase.from("programs").select("*").in("id", orderedProgramIds);
  devWarn("getAssignedProgramsForStudent (programs)", programsError);
  if (!programRows || programRows.length === 0) {
    return [];
  }

  const programs = await loadPrograms(supabase, programRows);
  const programById = new Map(programs.map((p) => [p.id, p]));
  return orderedProgramIds.map((id) => programById.get(id)).filter((p): p is AdminProgram => p !== undefined);
}

/**
 * Programme réellement assigné à un élève à mettre en avant ("programme
 * actif"), ou `null` si aucun programme n'est assigné. Celui au statut
 * "actif" est préféré, sinon le plus récemment assigné.
 */
export async function getAssignedProgramForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminProgram | null> {
  const programs = await getAssignedProgramsForStudent(supabase, studentId);
  if (programs.length === 0) {
    return null;
  }
  return programs.find((p) => p.status === "actif") ?? programs[0];
}

/**
 * Ids des programmes assignés à chaque élève (batch), pour peupler
 * AdminStudent.assignedProgramIds — voir lib/supabase/students.ts. Séparée
 * de getAssignedProgramForStudent (qui compose le programme complet) car
 * getStudents/getFullAdminStudent n'ont besoin que des ids, pas de la
 * structure semaines/séances/exercices.
 */
export async function getAssignedProgramIdsByStudent(
  supabase: TypedSupabaseClient,
  studentIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (studentIds.length === 0) {
    return map;
  }
  const { data, error } = await supabase
    .from("assignments")
    .select("student_id, content_id")
    .eq("content_type", "programme")
    .in("student_id", studentIds);
  devWarn("getAssignedProgramIdsByStudent", error);
  for (const row of data ?? []) {
    const list = map.get(row.student_id) ?? [];
    list.push(row.content_id);
    map.set(row.student_id, list);
  }
  return map;
}

/* ─── Écriture ─── */

/** Insère les semaines/séances/exercices d'un programme déjà créé (partagé par create/update). */
async function insertProgramStructure(
  supabase: TypedSupabaseClient,
  programId: string,
  sessions: AdminWorkoutSession[],
): Promise<void> {
  const weekNumbers = Array.from(new Set(sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);
  const weekIdByNumber = new Map<number, string>();

  for (const weekNumber of weekNumbers) {
    const { data: weekRow, error: weekError } = await supabase
      .from("program_weeks")
      .insert({ program_id: programId, week_number: weekNumber })
      .select("id")
      .single();
    devWarn("insertProgramStructure (program_weeks)", weekError);
    if (weekRow) {
      weekIdByNumber.set(weekNumber, weekRow.id);
    }
  }

  for (const session of sessions) {
    const weekId = weekIdByNumber.get(session.weekNumber);
    if (!weekId) continue;
    const { data: sessionRow, error: sessionError } = await supabase
      .from("workout_sessions")
      .insert({
        program_id: programId,
        program_week_id: weekId,
        day: session.day,
        is_rest_day: session.isRestDay,
        name: session.name,
        muscle_group: session.muscleGroup,
        duration_minutes: session.durationMinutes,
        warmup: session.warmup,
        coach_notes: session.coachNotes,
      })
      .select("id")
      .single();
    devWarn("insertProgramStructure (workout_sessions)", sessionError);
    if (!sessionRow) continue;

    if (!session.isRestDay && session.exercises.length > 0) {
      const { error: exercisesError } = await supabase.from("workout_exercises").insert(
        session.exercises.map((ex) => ({
          session_id: sessionRow.id,
          order_index: ex.order,
          name: ex.name,
          sets: ex.sets,
          reps: ex.reps,
          rest_seconds: ex.restSeconds,
          tempo: ex.tempo,
          recommended_load: ex.recommendedLoad,
          video_url: ex.videoUrl,
          notes: ex.notes,
          muscle_group: ex.muscleGroup ?? null,
          exercise_library_id: ex.libraryExerciseId ?? null,
        })),
      );
      devWarn("insertProgramStructure (workout_exercises)", exercisesError);
    }
  }
}

/** Crée un nouveau programme réel avec toute sa structure (semaines/séances/exercices). */
export async function createProgram(supabase: TypedSupabaseClient, data: ProgramBuilderData): Promise<string | null> {
  const { data: programRow, error: programError } = await supabase
    .from("programs")
    .insert({
      name: data.name,
      goal: data.goal,
      level: data.level,
      duration_weeks: data.durationWeeks,
      description: data.description,
      status: data.status,
    })
    .select("id")
    .single();
  devWarn("createProgram", programError);
  if (!programRow) {
    return null;
  }

  await insertProgramStructure(supabase, programRow.id, data.sessions);
  return programRow.id;
}

/**
 * Diffe et applique en place la structure (semaines/séances/exercices) d'un
 * programme existant, au lieu du delete + reinsert complet précédemment
 * utilisé par updateProgram (voir V3 — training-builder-v3-running-fullscreen).
 *
 * Pourquoi ce changement : le delete + reinsert recréait un nouvel id à
 * chaque séance/exercice à chaque sauvegarde, ce qui (a) mettait à `null` le
 * lien `workout_feedback.session_id` de tout retour élève déjà soumis pour
 * cette séance (ON DELETE SET NULL — le retour survit mais perd son
 * rattachement direct), et (b) aurait supprimé et fait perdre tout bloc/
 * prescription cardio (training_blocks/training_prescriptions, ON DELETE
 * CASCADE sur workout_sessions/workout_exercises) à chaque simple
 * modification du programme par le coach une fois le builder cardio en
 * place. Le diff fin préserve les ids existants et donc ces rattachements.
 *
 * Stratégie de correspondance (sans nouvelle colonne, juste plus de
 * requêtes ciblées) :
 * - Semaine : identifiée par son `week_number` (unique par programme).
 * - Séance : identifiée par (semaine, `day`) — chaque semaine a toujours
 *   exactement les 7 jours de weekDays, day est donc une clé stable.
 * - Exercice : identifié par son `id` — un id déjà présent en base pour
 *   CETTE séance est mis à jour ; un id absent (placeholder généré
 *   côté client par generateId(), voir lib/admin.ts) est inséré comme
 *   nouvel exercice ; un id en base absent du nouveau jeu de données est
 *   supprimé.
 */
async function diffProgramStructure(
  supabase: TypedSupabaseClient,
  programId: string,
  sessions: AdminWorkoutSession[],
): Promise<void> {
  const incomingWeekNumbers = Array.from(new Set(sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);

  const { data: existingWeeksRaw, error: existingWeeksError } = await supabase
    .from("program_weeks")
    .select("id, week_number")
    .eq("program_id", programId);
  devWarn("diffProgramStructure (program_weeks lecture)", existingWeeksError);
  const existingWeeks = existingWeeksRaw ?? [];

  const weekIdByNumber = new Map<number, string>(existingWeeks.map((w) => [w.week_number, w.id]));

  // Semaines retirées par le coach (plus aucune séance dessus) : suppression,
  // cascade jusqu'aux séances/exercices/blocs/prescriptions de cette semaine.
  const weeksToDelete = existingWeeks.filter((w) => !incomingWeekNumbers.includes(w.week_number));
  if (weeksToDelete.length > 0) {
    const { error } = await supabase
      .from("program_weeks")
      .delete()
      .in("id", weeksToDelete.map((w) => w.id));
    devWarn("diffProgramStructure (program_weeks suppression)", error);
    for (const w of weeksToDelete) weekIdByNumber.delete(w.week_number);
  }

  // Nouvelles semaines : insertion, on complète weekIdByNumber avec leur id.
  const weekNumbersToInsert = incomingWeekNumbers.filter((n) => !weekIdByNumber.has(n));
  for (const weekNumber of weekNumbersToInsert) {
    const { data: weekRow, error } = await supabase
      .from("program_weeks")
      .insert({ program_id: programId, week_number: weekNumber })
      .select("id")
      .single();
    devWarn("diffProgramStructure (program_weeks insertion)", error);
    if (weekRow) weekIdByNumber.set(weekNumber, weekRow.id);
  }

  const keptOrNewWeekIds = incomingWeekNumbers.map((n) => weekIdByNumber.get(n)).filter((id): id is string => Boolean(id));

  const { data: existingSessionsRaw, error: existingSessionsError } =
    keptOrNewWeekIds.length > 0
      ? await supabase.from("workout_sessions").select("id, program_week_id, day").in("program_week_id", keptOrNewWeekIds)
      : { data: [] as { id: string; program_week_id: string; day: string }[], error: null };
  devWarn("diffProgramStructure (workout_sessions lecture)", existingSessionsError);
  const existingSessions = existingSessionsRaw ?? [];

  // Clé stable "weekId::day" -> session id existante.
  const existingSessionIdByKey = new Map<string, string>(
    existingSessions.map((s) => [`${s.program_week_id}::${s.day}`, s.id]),
  );

  const incomingSessionKeys = new Set<string>();
  const sessionsToUpdate: { id: string; session: AdminWorkoutSession }[] = [];
  const sessionsToInsert: AdminWorkoutSession[] = [];

  for (const session of sessions) {
    const weekId = weekIdByNumber.get(session.weekNumber);
    if (!weekId) continue;
    const key = `${weekId}::${session.day}`;
    incomingSessionKeys.add(key);
    const existingId = existingSessionIdByKey.get(key);
    if (existingId) {
      sessionsToUpdate.push({ id: existingId, session });
    } else {
      sessionsToInsert.push(session);
    }
  }

  // Séances en base qui n'apparaissent plus du tout dans le nouveau jeu de
  // données (cas défensif : ne devrait pas arriver via ProgramBuilder, qui
  // conserve toujours les 7 jours par semaine, mais on ne laisse pas de
  // séance orpheline si ça change un jour).
  const sessionsToDelete = existingSessions.filter((s) => !incomingSessionKeys.has(`${s.program_week_id}::${s.day}`));
  if (sessionsToDelete.length > 0) {
    const { error } = await supabase
      .from("workout_sessions")
      .delete()
      .in("id", sessionsToDelete.map((s) => s.id));
    devWarn("diffProgramStructure (workout_sessions suppression)", error);
  }

  for (const { id, session } of sessionsToUpdate) {
    const { error } = await supabase
      .from("workout_sessions")
      .update({
        name: session.name,
        is_rest_day: session.isRestDay,
        muscle_group: session.muscleGroup,
        duration_minutes: session.durationMinutes,
        warmup: session.warmup,
        coach_notes: session.coachNotes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    devWarn("diffProgramStructure (workout_sessions mise à jour)", error);
  }

  const sessionIdByInsertedKey = new Map<AdminWorkoutSession, string>();
  for (const session of sessionsToInsert) {
    const weekId = weekIdByNumber.get(session.weekNumber);
    if (!weekId) continue;
    const { data: sessionRow, error } = await supabase
      .from("workout_sessions")
      .insert({
        program_id: programId,
        program_week_id: weekId,
        day: session.day,
        is_rest_day: session.isRestDay,
        name: session.name,
        muscle_group: session.muscleGroup,
        duration_minutes: session.durationMinutes,
        warmup: session.warmup,
        coach_notes: session.coachNotes,
      })
      .select("id")
      .single();
    devWarn("diffProgramStructure (workout_sessions insertion)", error);
    if (sessionRow) sessionIdByInsertedKey.set(session, sessionRow.id);
  }

  // Résout l'id de séance (existante ou tout juste créée) pour chaque
  // séance entrante, pour la passe exercices ci-dessous.
  function resolveSessionId(session: AdminWorkoutSession): string | undefined {
    const weekId = weekIdByNumber.get(session.weekNumber);
    if (!weekId) return undefined;
    const key = `${weekId}::${session.day}`;
    return existingSessionIdByKey.get(key) ?? sessionIdByInsertedKey.get(session);
  }

  // Exercices : uniquement pour les séances déjà existantes (les séances
  // tout juste insérées n'ont par définition encore aucun exercice en base).
  const updatedSessionIds = sessionsToUpdate.map((s) => s.id);
  const { data: existingExercisesRaw, error: existingExercisesError } =
    updatedSessionIds.length > 0
      ? await supabase.from("workout_exercises").select("id, session_id").in("session_id", updatedSessionIds)
      : { data: [] as { id: string; session_id: string }[], error: null };
  devWarn("diffProgramStructure (workout_exercises lecture)", existingExercisesError);
  const existingExercises = existingExercisesRaw ?? [];

  const existingExerciseIdsBySession = new Map<string, Set<string>>();
  for (const ex of existingExercises) {
    const set = existingExerciseIdsBySession.get(ex.session_id) ?? new Set<string>();
    set.add(ex.id);
    existingExerciseIdsBySession.set(ex.session_id, set);
  }

  const exercisesToInsert: (AdminExercise & { sessionId: string })[] = [];
  const exerciseIdsToDelete: string[] = [];

  for (const session of sessions) {
    const sessionId = resolveSessionId(session);
    if (!sessionId) continue;

    const existingIdsForSession = existingExerciseIdsBySession.get(sessionId) ?? new Set<string>();
    const incomingIds = new Set<string>();

    if (session.isRestDay) {
      // Un jour marqué repos ne conserve aucun exercice.
      for (const existingId of existingIdsForSession) exerciseIdsToDelete.push(existingId);
      continue;
    }

    for (const exercise of session.exercises) {
      if (existingIdsForSession.has(exercise.id)) {
        incomingIds.add(exercise.id);
      } else {
        exercisesToInsert.push({ ...exercise, sessionId });
      }
    }

    for (const existingId of existingIdsForSession) {
      if (!incomingIds.has(existingId)) exerciseIdsToDelete.push(existingId);
    }

    for (const exercise of session.exercises) {
      if (!existingIdsForSession.has(exercise.id)) continue;
      const { error } = await supabase
        .from("workout_exercises")
        .update({
          order_index: exercise.order,
          name: exercise.name,
          sets: exercise.sets,
          reps: exercise.reps,
          rest_seconds: exercise.restSeconds,
          tempo: exercise.tempo,
          recommended_load: exercise.recommendedLoad,
          video_url: exercise.videoUrl,
          notes: exercise.notes,
          muscle_group: exercise.muscleGroup ?? null,
          exercise_library_id: exercise.libraryExerciseId ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", exercise.id);
      devWarn("diffProgramStructure (workout_exercises mise à jour)", error);
    }
  }

  if (exerciseIdsToDelete.length > 0) {
    const { error } = await supabase.from("workout_exercises").delete().in("id", exerciseIdsToDelete);
    devWarn("diffProgramStructure (workout_exercises suppression)", error);
  }

  if (exercisesToInsert.length > 0) {
    const { error } = await supabase.from("workout_exercises").insert(
      exercisesToInsert.map((ex) => ({
        session_id: ex.sessionId,
        order_index: ex.order,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        rest_seconds: ex.restSeconds,
        tempo: ex.tempo,
        recommended_load: ex.recommendedLoad,
        video_url: ex.videoUrl,
        notes: ex.notes,
        muscle_group: ex.muscleGroup ?? null,
        exercise_library_id: ex.libraryExerciseId ?? null,
      })),
    );
    devWarn("diffProgramStructure (workout_exercises insertion)", error);
  }
}

/**
 * Met à jour un programme existant : les champs du programme sont modifiés
 * en place, et sa structure (semaines/séances/exercices) est diffée
 * finement (voir diffProgramStructure) plutôt que remplacée par delete +
 * reinsert, pour préserver les ids existants (retours élève déjà soumis,
 * futurs blocs/prescriptions cardio V3).
 */
export async function updateProgram(
  supabase: TypedSupabaseClient,
  programId: string,
  data: ProgramBuilderData,
): Promise<boolean> {
  const { error: updateError } = await supabase
    .from("programs")
    .update({
      name: data.name,
      goal: data.goal,
      level: data.level,
      duration_weeks: data.durationWeeks,
      description: data.description,
      status: data.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", programId);
  devWarn("updateProgram", updateError);

  await diffProgramStructure(supabase, programId, data.sessions);
  return !updateError;
}

export async function updateProgramStatus(
  supabase: TypedSupabaseClient,
  programId: string,
  status: AdminProgram["status"],
): Promise<boolean> {
  const { error } = await supabase
    .from("programs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", programId);
  devWarn("updateProgramStatus", error);
  return !error;
}

/**
 * Assigne/retire un programme réel à un élève réel via la table `assignments`
 * (content_type = "programme"). Contrairement à useAdminData().setAssignment
 * (mock), il n'y a rien à synchroniser côté élève : `assignments` est déjà
 * la source de vérité unique, lue par getAssignedProgramForStudent et par
 * les policies RLS de programs/program_weeks/workout_sessions/workout_exercises.
 */
export async function setProgramAssignment(
  supabase: TypedSupabaseClient,
  studentId: string,
  programId: string,
  assigned: boolean,
): Promise<boolean> {
  if (!assigned) {
    const { error } = await supabase
      .from("assignments")
      .delete()
      .eq("student_id", studentId)
      .eq("content_type", "programme")
      .eq("content_id", programId);
    devWarn("setProgramAssignment (delete)", error);
    return !error;
  }

  const { data: existing, error: lookupError } = await supabase
    .from("assignments")
    .select("id")
    .eq("student_id", studentId)
    .eq("content_type", "programme")
    .eq("content_id", programId)
    .maybeSingle();
  devWarn("setProgramAssignment (lookup)", lookupError);
  if (existing) {
    return true;
  }

  const { error: insertError } = await supabase.from("assignments").insert({
    student_id: studentId,
    content_type: "programme",
    content_id: programId,
  });
  devWarn("setProgramAssignment (insert)", insertError);
  if (!insertError) {
    const { data: program } = await supabase.from("programs").select("name").eq("id", programId).maybeSingle();
    await logActivityEvent(supabase, {
      studentId,
      actorType: "coach",
      eventType: "program_assigned",
      title: "Programme assigné",
      description: program?.name ? `Programme "${program.name}" assigné.` : "Un programme a été assigné.",
      metadata: buildStudentActivityLink(studentId),
    });
  }
  return !insertError;
}
