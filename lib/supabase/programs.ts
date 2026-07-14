import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type { ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import type { AdminExercise, AdminProgram, AdminTrainingBlock, AdminTrainingPrescription, AdminWorkoutSession } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès aux programmes Supabase (tables `programs`, `program_weeks`,
 * `workout_sessions`, `workout_exercises`, `training_blocks`,
 * `training_prescriptions`) et à leur assignation aux élèves (table
 * `assignments`, content_type = "programme").
 *
 * Chantier "training-builder-v2" : introduit les blocs (superset/circuit/
 * EMOM/...) et les prescriptions par série (mode détaillé), en conservant
 * une compatibilité totale avec les anciennes séances "à plat" (voir
 * `buildBlocksForSession` — adaptateur de lecture qui synthétise un bloc
 * "standard" pour tout `workout_exercises.block_id` null, jamais écrit en
 * base tel quel).
 *
 * Le second changement de ce chantier : `updateProgram` ne fait plus un
 * delete+reinsert complet de la structure à chaque sauvegarde (voir
 * ancienne version dans l'historique git) — cela changeait l'id de chaque
 * séance/exercice à chaque édition et cassait le lien vers
 * `workout_feedback`/`exercise_feedback` déjà soumis par l'élève (retrouvés
 * par `session_key` = l'ancien `workout_sessions.id`). La nouvelle écriture
 * diffe : les lignes déjà en base (id réel, uuid) sont mises à jour en
 * place, seules les lignes réellement nouvelles sont insérées, et seules
 * les lignes réellement retirées par le coach sont supprimées.
 *
 * Comme lib/supabase/students.ts et lib/supabase/workout-feedback.ts, toutes
 * les lectures renvoient un résultat "vide" (jamais d'exception) aussi bien
 * quand Supabase n'a réellement aucune donnée qu'en cas d'erreur (RLS,
 * réseau...) — warning dev uniquement, jamais bloquant, pour préserver le
 * repli mock/localStorage.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

type ProgramRow = Database["public"]["Tables"]["programs"]["Row"];
type WorkoutSessionRow = Database["public"]["Tables"]["workout_sessions"]["Row"];
type WorkoutExerciseRow = Database["public"]["Tables"]["workout_exercises"]["Row"];
type TrainingBlockRow = Database["public"]["Tables"]["training_blocks"]["Row"];
type TrainingPrescriptionRow = Database["public"]["Tables"]["training_prescriptions"]["Row"];
type AssignmentRow = Database["public"]["Tables"]["assignments"]["Row"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** true si `id` est déjà un identifiant réel Supabase (uuid) — false pour un id généré côté client (voir lib/admin.ts generateId, ex: "sess-1737..."), qui doit donc être inséré comme une ligne neuve. */
function isPersistedId(id: string): boolean {
  return UUID_RE.test(id);
}

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

function mapPrescriptionRow(row: TrainingPrescriptionRow): AdminTrainingPrescription {
  return {
    id: row.id,
    exerciseId: row.exercise_id,
    setNumber: row.set_number,
    setType: row.set_type,
    targetReps: row.target_reps,
    repsMin: row.reps_min,
    repsMax: row.reps_max,
    durationSeconds: row.duration_seconds,
    distanceMeters: row.distance_meters,
    targetLoad: row.target_load,
    loadUnit: row.load_unit,
    loadInputMode: row.load_input_mode,
    targetPercentage: row.target_percentage,
    targetRpe: row.target_rpe,
    targetRir: row.target_rir,
    bodyweightPercentage: row.bodyweight_percentage,
    tempoEccentric: row.tempo_eccentric,
    tempoBottomPause: row.tempo_bottom_pause,
    tempoConcentric: row.tempo_concentric,
    tempoTopPause: row.tempo_top_pause,
    restSeconds: row.rest_seconds,
    coachNotes: row.coach_notes,
    position: row.position,
  };
}

function mapExerciseRow(row: WorkoutExerciseRow, prescriptions: AdminTrainingPrescription[]): AdminExercise {
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
    blockId: row.block_id ?? undefined,
    supersetLabel: row.superset_label ?? undefined,
    prescriptions: prescriptions.length > 0 ? prescriptions.sort((a, b) => a.setNumber - b.setNumber) : undefined,
  };
}

/**
 * Compose les blocs d'une séance à partir des lignes brutes. Tout exercice
 * avec `block_id` null (toute séance créée avant ce chantier, ou toute
 * séance sauvegardée via l'ancien ProgramBuilder qui ne manipule pas encore
 * les blocs — voir upsertBlocksForSession plus bas) est regroupé en un bloc
 * "standard" synthétisé à la volée, jamais écrit en base : c'est
 * l'adaptateur de lecture qui garde les anciens programmes lisibles sans
 * aucune migration destructive.
 */
function buildBlocksForSession(
  sessionId: string,
  blockRows: TrainingBlockRow[],
  exerciseRows: WorkoutExerciseRow[],
  prescriptionsByExercise: Map<string, AdminTrainingPrescription[]>,
): { blocks: AdminTrainingBlock[]; exercises: AdminExercise[] } {
  const exercisesByBlock = groupBy(exerciseRows, (e) => e.block_id);

  const realBlocks: AdminTrainingBlock[] = blockRows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((block) => {
      const exercises = (exercisesByBlock.get(block.id) ?? [])
        .slice()
        .sort((a, b) => a.order_index - b.order_index)
        .map((row) => mapExerciseRow(row, prescriptionsByExercise.get(row.id) ?? []));
      return {
        id: block.id,
        sessionId: block.session_id,
        blockType: block.block_type,
        title: block.title,
        description: block.description,
        scoringType: block.scoring_type,
        colorKey: block.color_key,
        rounds: block.rounds,
        timeCapSeconds: block.time_cap_seconds,
        durationSeconds: block.duration_seconds,
        workSeconds: block.work_seconds,
        restSeconds: block.rest_seconds,
        emomMinutes: block.emom_minutes,
        position: block.position,
        mediaPath: block.media_path,
        versionNumber: block.version_number,
        exercises,
      };
    });

  const looseExerciseRows = exercisesByBlock.get(null) ?? [];
  const blocks = [...realBlocks];
  if (looseExerciseRows.length > 0) {
    const exercises = looseExerciseRows
      .slice()
      .sort((a, b) => a.order_index - b.order_index)
      .map((row) => mapExerciseRow(row, prescriptionsByExercise.get(row.id) ?? []));
    blocks.unshift({
      id: `standard-${sessionId}`,
      sessionId,
      blockType: "standard",
      title: "",
      description: "",
      scoringType: null,
      colorKey: "gray",
      rounds: null,
      timeCapSeconds: null,
      durationSeconds: null,
      workSeconds: null,
      restSeconds: null,
      emomMinutes: null,
      position: -1,
      mediaPath: null,
      versionNumber: 1,
      isSynthesizedStandard: true,
      exercises,
    });
  }

  return { blocks, exercises: blocks.flatMap((b) => b.exercises) };
}

function mapSessionRow(
  row: WorkoutSessionRow,
  weekNumber: number,
  blockRows: TrainingBlockRow[],
  exerciseRows: WorkoutExerciseRow[],
  prescriptionsByExercise: Map<string, AdminTrainingPrescription[]>,
): AdminWorkoutSession {
  const { blocks, exercises } = buildBlocksForSession(row.id, blockRows, exerciseRows, prescriptionsByExercise);
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
    blocks,
    exercises,
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
    programType: row.program_type,
    publicationStatus: row.publication_status,
    coverImagePath: row.cover_image_path,
    experienceLevel: row.experience_level,
    expectedDaysPerWeek: row.expected_days_per_week,
    estimatedSessionDurationMinutes: row.estimated_session_duration_minutes,
    sourceTemplateId: row.source_template_id,
    ownerStudentId: row.owner_student_id,
    versionNumber: row.version_number,
    publishedAt: row.published_at,
    assignedStudentIds,
    sessions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Charge et compose un ensemble de programmes complets (semaines/séances/blocs/exercices/prescriptions/assignations) en un minimum de requêtes. */
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
  const [blocksResult, exercisesResult] =
    sessionIds.length > 0
      ? await Promise.all([
          supabase.from("training_blocks").select("*").in("session_id", sessionIds),
          supabase.from("workout_exercises").select("*").in("session_id", sessionIds),
        ])
      : [
          { data: [] as TrainingBlockRow[], error: null },
          { data: [] as WorkoutExerciseRow[], error: null },
        ];
  devWarn("loadPrograms (training_blocks)", blocksResult.error);
  devWarn("loadPrograms (workout_exercises)", exercisesResult.error);
  const blockRows = blocksResult.data ?? [];
  const exerciseRows = exercisesResult.data ?? [];

  const exerciseIds = exerciseRows.map((e) => e.id);
  const { data: prescriptionRowsRaw, error: prescriptionsError } =
    exerciseIds.length > 0
      ? await supabase.from("training_prescriptions").select("*").in("exercise_id", exerciseIds)
      : { data: [] as TrainingPrescriptionRow[], error: null };
  devWarn("loadPrograms (training_prescriptions)", prescriptionsError);
  const prescriptionRowsByExercise = groupBy(prescriptionRowsRaw ?? [], (p) => p.exercise_id);
  const prescriptionsMapped = new Map<string, AdminTrainingPrescription[]>(
    Array.from(prescriptionRowsByExercise.entries()).map(([exerciseId, rows]) => [exerciseId, rows.map(mapPrescriptionRow)]),
  );

  const weeksByProgram = groupBy(weekRows, (w) => w.program_id);
  const sessionsByWeek = groupBy(sessionRows, (s) => s.program_week_id);
  const blocksBySession = groupBy(blockRows, (b) => b.session_id);
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
          blocksBySession.get(sessionRow.id) ?? [],
          exercisesBySession.get(sessionRow.id) ?? [],
          prescriptionsMapped,
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

/** Un seul programme complet par id, ou `null` s'il n'existe pas (RLS incluse — un élève non assigné ou un brouillon d'un autre programme renvoient `null`). */
export async function getProgramById(supabase: TypedSupabaseClient, programId: string): Promise<AdminProgram | null> {
  const { data, error } = await supabase.from("programs").select("*").eq("id", programId).maybeSingle();
  devWarn("getProgramById", error);
  if (!data) {
    return null;
  }
  const programs = await loadPrograms(supabase, [data]);
  return programs[0] ?? null;
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

/**
 * Diffe et écrit les prescriptions d'un exercice (mode détaillé). Aucune
 * table ne référence `training_prescriptions.id` (contrairement à
 * `workout_sessions`/`workout_exercises`, ciblées par `workout_feedback`/
 * `exercise_feedback`) : un remplacement complet à chaque sauvegarde est
 * donc sûr, plus simple qu'un diff fin, et sans aucun risque de casser un
 * lien existant.
 */
async function replacePrescriptionsForExercise(
  supabase: TypedSupabaseClient,
  exerciseId: string,
  prescriptions: AdminTrainingPrescription[] | undefined,
): Promise<void> {
  const { error: deleteError } = await supabase.from("training_prescriptions").delete().eq("exercise_id", exerciseId);
  devWarn("replacePrescriptionsForExercise (delete)", deleteError);
  if (!prescriptions || prescriptions.length === 0) {
    return;
  }
  const { error: insertError } = await supabase.from("training_prescriptions").insert(
    prescriptions.map((p, index) => ({
      exercise_id: exerciseId,
      set_number: p.setNumber,
      set_type: p.setType,
      target_reps: p.targetReps,
      reps_min: p.repsMin,
      reps_max: p.repsMax,
      duration_seconds: p.durationSeconds,
      distance_meters: p.distanceMeters,
      target_load: p.targetLoad,
      load_unit: p.loadUnit,
      load_input_mode: p.loadInputMode,
      target_percentage: p.targetPercentage,
      target_rpe: p.targetRpe,
      target_rir: p.targetRir,
      bodyweight_percentage: p.bodyweightPercentage,
      tempo_eccentric: p.tempoEccentric,
      tempo_bottom_pause: p.tempoBottomPause,
      tempo_concentric: p.tempoConcentric,
      tempo_top_pause: p.tempoTopPause,
      rest_seconds: p.restSeconds,
      coach_notes: p.coachNotes,
      position: p.position ?? index + 1,
    })),
  );
  devWarn("replacePrescriptionsForExercise (insert)", insertError);
}

/**
 * Diffe et écrit les exercices d'un bloc réel (id uuid persistant, jamais
 * un id synthétisé "standard-..."). Les exercices déjà en base (id uuid
 * existant) sont mis à jour en place — leur id ne change jamais, ce qui
 * préserve le lien `exercise_feedback.exercise_id` déjà soumis par l'élève.
 * Seuls les exercices réellement retirés par le coach sont supprimés.
 */
async function upsertExercisesForBlock(
  supabase: TypedSupabaseClient,
  blockId: string,
  sessionId: string,
  exercises: AdminExercise[],
): Promise<void> {
  const { data: existingRows, error: existingError } = await supabase.from("workout_exercises").select("id").eq("block_id", blockId);
  devWarn("upsertExercisesForBlock (existing)", existingError);
  const existingIds = new Set((existingRows ?? []).map((r) => r.id));
  const keepIds = new Set<string>();

  for (const [index, exercise] of exercises.entries()) {
    const payload = {
      session_id: sessionId,
      block_id: blockId,
      order_index: exercise.order ?? index + 1,
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
      superset_label: exercise.supersetLabel ?? null,
      updated_at: new Date().toISOString(),
    };

    let realExerciseId: string | null = null;
    if (isPersistedId(exercise.id) && existingIds.has(exercise.id)) {
      const { error } = await supabase.from("workout_exercises").update(payload).eq("id", exercise.id);
      devWarn("upsertExercisesForBlock (update)", error);
      realExerciseId = exercise.id;
    } else {
      const { data: row, error } = await supabase.from("workout_exercises").insert(payload).select("id").single();
      devWarn("upsertExercisesForBlock (insert)", error);
      realExerciseId = row?.id ?? null;
    }
    if (realExerciseId) {
      keepIds.add(realExerciseId);
      await replacePrescriptionsForExercise(supabase, realExerciseId, exercise.prescriptions);
    }
  }

  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase.from("workout_exercises").delete().in("id", toDelete);
    devWarn("upsertExercisesForBlock (delete)", error);
  }
}

/**
 * Diffe et écrit les blocs d'une séance. Deux cas :
 * - `session.blocks` renseigné avec au moins un bloc réel (futur éditeur de
 *   blocs) : chaque bloc réel (id uuid existant) est mis à jour en place,
 *   les nouveaux sont créés, les blocs retirés sont supprimés (cascade sur
 *   leurs exercices).
 * - `session.blocks` vide/absent/uniquement synthétisé (ProgramBuilder
 *   actuel, qui ne manipule encore que `session.exercises` à plat) : un
 *   unique bloc "standard" est réutilisé (ou créé) pour porter tous les
 *   exercices de la séance, sans qu'aucune UI supplémentaire ne soit
 *   nécessaire pour continuer à publier des séances "classiques".
 */
async function upsertBlocksForSession(supabase: TypedSupabaseClient, sessionId: string, session: AdminWorkoutSession): Promise<void> {
  const { data: existingBlockRows, error: existingError } = await supabase
    .from("training_blocks")
    .select("id, block_type")
    .eq("session_id", sessionId);
  devWarn("upsertBlocksForSession (existing)", existingError);
  const existingIds = new Set((existingBlockRows ?? []).map((r) => r.id));

  const explicitBlocks = (session.blocks ?? []).filter((b) => !b.isSynthesizedStandard);

  if (explicitBlocks.length > 0) {
    const keepIds = new Set<string>();
    for (const [index, block] of explicitBlocks.entries()) {
      const payload = {
        session_id: sessionId,
        block_type: block.blockType,
        title: block.title,
        description: block.description,
        scoring_type: block.scoringType,
        color_key: block.colorKey,
        rounds: block.rounds,
        time_cap_seconds: block.timeCapSeconds,
        duration_seconds: block.durationSeconds,
        work_seconds: block.workSeconds,
        rest_seconds: block.restSeconds,
        emom_minutes: block.emomMinutes,
        position: block.position ?? index + 1,
        media_path: block.mediaPath,
        updated_at: new Date().toISOString(),
      };
      let realBlockId: string | null = null;
      if (isPersistedId(block.id) && existingIds.has(block.id)) {
        const { error } = await supabase.from("training_blocks").update(payload).eq("id", block.id);
        devWarn("upsertBlocksForSession (update)", error);
        realBlockId = block.id;
      } else {
        const { data: row, error } = await supabase.from("training_blocks").insert(payload).select("id").single();
        devWarn("upsertBlocksForSession (insert)", error);
        realBlockId = row?.id ?? null;
      }
      if (realBlockId) {
        keepIds.add(realBlockId);
        await upsertExercisesForBlock(supabase, realBlockId, sessionId, block.exercises);
      }
    }
    const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
    if (toDelete.length > 0) {
      const { error } = await supabase.from("training_blocks").delete().in("id", toDelete);
      devWarn("upsertBlocksForSession (delete removed blocks)", error);
    }
    return;
  }

  // Repli "mode simple" (ProgramBuilder actuel) : un unique bloc standard
  // porte tous les exercices à plat de la séance. Réutilise le premier bloc
  // "standard" déjà en base pour cette séance s'il existe, pour ne pas non
  // plus faire tourner inutilement l'id du bloc à chaque sauvegarde.
  const existingStandard = (existingBlockRows ?? []).find((b) => b.block_type === "standard");
  let standardBlockId = existingStandard?.id ?? null;
  if (session.exercises.length === 0) {
    // Rien à porter : si un bloc standard vide existe encore, on le retire.
    if (standardBlockId) {
      const { error } = await supabase.from("training_blocks").delete().eq("id", standardBlockId);
      devWarn("upsertBlocksForSession (delete empty standard)", error);
    }
    return;
  }
  if (!standardBlockId) {
    const { data: row, error } = await supabase
      .from("training_blocks")
      .insert({ session_id: sessionId, block_type: "standard", position: 1 })
      .select("id")
      .single();
    devWarn("upsertBlocksForSession (insert standard)", error);
    standardBlockId = row?.id ?? null;
  }
  if (standardBlockId) {
    await upsertExercisesForBlock(supabase, standardBlockId, sessionId, session.exercises);
  }
  // Supprime tout autre bloc résiduel (ex: un bloc réel créé puis vidé par
  // un retour arrière au mode simple) — cas limite, mais évite un bloc
  // fantôme sans exercice.
  const otherIds = [...existingIds].filter((id) => id !== standardBlockId);
  if (otherIds.length > 0) {
    const { error } = await supabase.from("training_blocks").delete().in("id", otherIds);
    devWarn("upsertBlocksForSession (delete residual blocks)", error);
  }
}

/**
 * Diffe et écrit les séances d'une semaine. Une séance déjà en base (id
 * uuid existant) est mise à jour en place — son id ne change jamais, ce qui
 * préserve `workout_feedback.session_key` (voir en-tête de fichier).
 */
async function upsertSessionsForWeek(
  supabase: TypedSupabaseClient,
  programId: string,
  weekId: string,
  sessionsForWeek: AdminWorkoutSession[],
): Promise<void> {
  const { data: existingRows, error: existingError } = await supabase.from("workout_sessions").select("id").eq("program_week_id", weekId);
  devWarn("upsertSessionsForWeek (existing)", existingError);
  const existingIds = new Set((existingRows ?? []).map((r) => r.id));
  const keepIds = new Set<string>();

  for (const session of sessionsForWeek) {
    const payload = {
      program_id: programId,
      program_week_id: weekId,
      day: session.day,
      is_rest_day: session.isRestDay,
      name: session.name,
      muscle_group: session.muscleGroup,
      duration_minutes: session.durationMinutes,
      warmup: session.warmup,
      coach_notes: session.coachNotes,
      updated_at: new Date().toISOString(),
    };

    let realSessionId: string | null = null;
    if (isPersistedId(session.id) && existingIds.has(session.id)) {
      const { error } = await supabase.from("workout_sessions").update(payload).eq("id", session.id);
      devWarn("upsertSessionsForWeek (update)", error);
      realSessionId = session.id;
    } else {
      const { data: row, error } = await supabase.from("workout_sessions").insert(payload).select("id").single();
      devWarn("upsertSessionsForWeek (insert)", error);
      realSessionId = row?.id ?? null;
    }

    if (realSessionId) {
      keepIds.add(realSessionId);
      if (!session.isRestDay) {
        await upsertBlocksForSession(supabase, realSessionId, session);
      } else {
        // Séance marquée repos : retire tout bloc/exercice résiduel.
        const { data: staleBlocks } = await supabase.from("training_blocks").select("id").eq("session_id", realSessionId);
        const staleIds = (staleBlocks ?? []).map((b) => b.id);
        if (staleIds.length > 0) {
          await supabase.from("training_blocks").delete().in("id", staleIds);
        }
      }
    }
  }

  const toDelete = [...existingIds].filter((id) => !keepIds.has(id));
  if (toDelete.length > 0) {
    const { error } = await supabase.from("workout_sessions").delete().in("id", toDelete);
    devWarn("upsertSessionsForWeek (delete)", error);
  }
}

/**
 * Diffe et écrit les semaines d'un programme. Une semaine existante est
 * retrouvée par (program_id, week_number) — pas par id, `AdminWorkoutSession`
 * ne portant que `weekNumber` — puis ses séances sont diffées à leur tour.
 * Une semaine entièrement retirée par le coach (plus aucune séance de ce
 * numéro dans les données envoyées) est supprimée, cascade sur ses séances/
 * blocs/exercices — suppression volontaire, jamais un effet de bord d'une
 * autre édition.
 */
async function upsertProgramStructure(supabase: TypedSupabaseClient, programId: string, sessions: AdminWorkoutSession[]): Promise<void> {
  const weekNumbers = Array.from(new Set(sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);

  const { data: existingWeeks, error: existingWeeksError } = await supabase
    .from("program_weeks")
    .select("id, week_number")
    .eq("program_id", programId);
  devWarn("upsertProgramStructure (existing weeks)", existingWeeksError);
  const weekIdByNumber = new Map<number, string>();
  for (const week of existingWeeks ?? []) {
    weekIdByNumber.set(week.week_number, week.id);
  }

  for (const weekNumber of weekNumbers) {
    if (weekIdByNumber.has(weekNumber)) continue;
    const { data: row, error } = await supabase
      .from("program_weeks")
      .insert({ program_id: programId, week_number: weekNumber })
      .select("id")
      .single();
    devWarn("upsertProgramStructure (insert week)", error);
    if (row) {
      weekIdByNumber.set(weekNumber, row.id);
    }
  }

  const sessionsByWeekNumber = groupBy(sessions, (s) => s.weekNumber);
  for (const weekNumber of weekNumbers) {
    const weekId = weekIdByNumber.get(weekNumber);
    if (!weekId) continue;
    await upsertSessionsForWeek(supabase, programId, weekId, sessionsByWeekNumber.get(weekNumber) ?? []);
  }

  const removedWeekIds = (existingWeeks ?? []).filter((w) => !weekNumbers.includes(w.week_number)).map((w) => w.id);
  if (removedWeekIds.length > 0) {
    const { error } = await supabase.from("program_weeks").delete().in("id", removedWeekIds);
    devWarn("upsertProgramStructure (delete removed weeks)", error);
  }
}

/** Crée un nouveau programme réel avec toute sa structure (semaines/séances/blocs/exercices). */
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
      // program_type/publication_status/etc. restent sur leur défaut DB
      // ('group'/'published') tant que le parcours de création en 3 étapes
      // (chantier training-builder-v2, tâche "3-step program creation
      // flow") ne les expose pas encore dans ProgramBuilderData.
    })
    .select("id")
    .single();
  devWarn("createProgram", programError);
  if (!programRow) {
    return null;
  }

  await upsertProgramStructure(supabase, programRow.id, data.sessions);
  return programRow.id;
}

/**
 * Met à jour un programme existant : les champs du programme sont modifiés
 * en place, et sa structure (semaines/séances/blocs/exercices) est diffée
 * (voir upsertProgramStructure) plutôt qu'intégralement remplacée — les
 * identifiants des lignes non touchées par cette édition restent stables.
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

  await upsertProgramStructure(supabase, programId, data.sessions);
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
 * (content_type = "programme"). Réservé aux programmes de groupe/durée fixe
 * (structure partagée) — pour une programmation individuelle, voir
 * `assignIndividualProgram` (crée une copie dédiée avant d'assigner).
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

/**
 * Attribution "individuelle" (chantier training-builder-v2) : au lieu de
 * partager le même `program_id` entre plusieurs élèves (comportement
 * "groupe" historique de `setProgramAssignment`), copie intégralement la
 * structure du programme modèle (semaines/séances/blocs/exercices/
 * prescriptions — jamais les performances/feedbacks) dans un nouveau
 * programme dédié à cet unique élève, puis l'assigne. Le coach peut ensuite
 * adapter cette copie librement sans jamais affecter le modèle source ni les
 * copies des autres élèves.
 */
export async function assignIndividualProgram(
  supabase: TypedSupabaseClient,
  templateProgramId: string,
  studentId: string,
): Promise<string | null> {
  const template = await getProgramById(supabase, templateProgramId);
  if (!template) {
    devWarn("assignIndividualProgram", { message: `Programme modèle ${templateProgramId} introuvable.` });
    return null;
  }

  const { data: copyRow, error: copyError } = await supabase
    .from("programs")
    .insert({
      name: template.name,
      goal: template.goal,
      level: template.level,
      duration_weeks: template.durationWeeks,
      description: template.description,
      status: "actif",
      program_type: "individual",
      publication_status: "published",
      cover_image_path: template.coverImagePath,
      experience_level: template.experienceLevel,
      expected_days_per_week: template.expectedDaysPerWeek,
      estimated_session_duration_minutes: template.estimatedSessionDurationMinutes,
      source_template_id: templateProgramId,
      owner_student_id: studentId,
      version_number: 1,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  devWarn("assignIndividualProgram (create copy)", copyError);
  if (!copyRow) {
    return null;
  }

  // Réutilise le même écrivain que create/updateProgram : les ids de
  // semaines/séances/blocs/exercices de `template` sont volontairement
  // remplacés par des ids client fraîchement générés (préfixe
  // "individual-copy-", jamais un uuid) pour garantir que upsertProgramStructure
  // les traite comme des lignes neuves à insérer plutôt que comme des
  // lignes existantes du modèle source à modifier en place — jamais les
  // performances/feedbacks, qui ne sont de toute façon pas portés par
  // AdminWorkoutSession/AdminExercise.
  const sessionsForCopy: AdminWorkoutSession[] = template.sessions.map((session) => ({
    ...session,
    id: `individual-copy-${session.id}`,
    blocks: session.blocks
      .filter((b) => !b.isSynthesizedStandard)
      .map((block) => ({
        ...block,
        id: `individual-copy-${block.id}`,
        exercises: block.exercises.map((ex) => ({ ...ex, id: `individual-copy-${ex.id}` })),
      })),
    exercises: session.exercises.map((ex) => ({ ...ex, id: `individual-copy-${ex.id}` })),
  }));
  await upsertProgramStructure(supabase, copyRow.id, sessionsForCopy);

  const assigned = await setProgramAssignment(supabase, studentId, copyRow.id, true);
  if (!assigned) {
    devWarn("assignIndividualProgram (assign)", { message: "La copie a été créée mais l'assignation a échoué." });
  }
  return copyRow.id;
}
