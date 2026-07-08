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
 * Met à jour un programme existant : les champs du programme sont modifiés
 * en place, mais sa structure (semaines/séances/exercices) est entièrement
 * remplacée (delete + reinsert) plutôt que diffée finement — ProgramBuilder
 * renvoie de toute façon systématiquement le jeu complet de séances, et la
 * suppression des program_weeks cascade jusqu'aux séances/exercices (voir
 * supabase/schema.sql). Aussi simple et sûr que le même choix déjà fait pour
 * saveWorkoutFeedback.
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

  const { error: deleteError } = await supabase.from("program_weeks").delete().eq("program_id", programId);
  devWarn("updateProgram (delete previous structure)", deleteError);

  await insertProgramStructure(supabase, programId, data.sessions);
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
