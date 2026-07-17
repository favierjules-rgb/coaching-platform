import type { SupabaseClient } from "@supabase/supabase-js";

import { generateId } from "@/lib/admin";
import { cloneCardioBlock } from "@/lib/cardio";
import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type { ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import type {
  AdminCardioBlock,
  AdminCardioSegment,
  AdminExercise,
  AdminProgram,
  AdminWorkoutSession,
  CardioSegmentType,
  CardioType,
  IntensityTargetType,
  MachineType,
} from "@/types";
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
type TrainingBlockRow = Database["public"]["Tables"]["training_blocks"]["Row"];
type TrainingPrescriptionRow = Database["public"]["Tables"]["training_prescriptions"]["Row"];

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

/** Segment cardio (training_prescriptions avec block_id renseigné et exercise_id nul) -> AdminCardioSegment. */
function mapCardioSegmentRow(row: TrainingPrescriptionRow): AdminCardioSegment {
  return {
    id: row.id,
    order: row.position,
    segmentType: (row.segment_type ?? "single") as CardioSegmentType,
    title: row.title ?? "",
    repetitions: row.repetitions ?? undefined,
    durationSeconds: row.work_duration_seconds ?? undefined,
    distanceMeters: row.distance_meters ?? undefined,
    elevationGainMeters: row.elevation_gain_meters ?? undefined,
    inclinePercentage: row.incline_percentage ?? undefined,
    recoveryDurationSeconds: row.recovery_duration_seconds ?? undefined,
    recoveryDistanceMeters: row.recovery_distance_meters ?? undefined,
    intensityTargetType: (row.intensity_target_type ?? "free") as IntensityTargetType,
    targetVmaPercentage: row.target_vma_percentage ?? undefined,
    targetSpeedKmh: row.target_speed_kmh ?? undefined,
    targetPaceSecondsPerKm: row.target_pace_seconds_per_km ?? undefined,
    targetHrPercentage: row.target_hr_percentage ?? undefined,
    targetHrZone: row.target_hr_zone ?? undefined,
    targetPowerWatts: row.target_power_watts ?? undefined,
    targetCadence: row.target_cadence ?? undefined,
    intensityMin: row.intensity_min ?? undefined,
    intensityMax: row.intensity_max ?? undefined,
    surface: row.surface ?? undefined,
    terrain: row.terrain ?? undefined,
    equipmentType: row.equipment_type ?? undefined,
    coachNotes: row.coach_notes ?? undefined,
  };
}

/** Bloc cardio (training_blocks, block_type = "cardio") -> AdminCardioBlock, avec ses segments déjà composés. */
function mapCardioBlockRow(row: TrainingBlockRow, segments: AdminCardioSegment[]): AdminCardioBlock {
  return {
    id: row.id,
    order: row.position,
    title: row.title ?? "",
    cardioType: (row.cardio_type ?? "custom_cardio") as CardioType,
    machineType: (row.machine_type ?? undefined) as MachineType | undefined,
    segments: segments.slice().sort((a, b) => a.order - b.order),
  };
}

function mapSessionRow(
  row: WorkoutSessionRow,
  weekNumber: number,
  exercises: AdminExercise[],
  cardioBlocks: AdminCardioBlock[],
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
    sessionType: row.session_type,
    cardioBlocks: cardioBlocks.slice().sort((a, b) => a.order - b.order),
    bannerUrl: row.banner_url ?? null,
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
    bannerUrl: row.banner_url ?? null,
    programMode: row.program_mode ?? "individuel",
    groupStartDate: row.group_start_date ?? null,
    isPublic: row.is_public ?? false,
    publicSubscriptionTemplateId: row.public_subscription_template_id ?? null,
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

  const { data: blockRowsRaw, error: blocksError } =
    sessionIds.length > 0
      ? await supabase.from("training_blocks").select("*").in("session_id", sessionIds)
      : { data: [] as TrainingBlockRow[], error: null };
  devWarn("loadPrograms (training_blocks)", blocksError);
  const blockRows = blockRowsRaw ?? [];

  const blockIds = blockRows.map((b) => b.id);
  const { data: segmentRowsRaw, error: segmentsError } =
    blockIds.length > 0
      ? await supabase.from("training_prescriptions").select("*").in("block_id", blockIds)
      : { data: [] as TrainingPrescriptionRow[], error: null };
  devWarn("loadPrograms (training_prescriptions)", segmentsError);
  const segmentRows = segmentRowsRaw ?? [];

  const weeksByProgram = groupBy(weekRows, (w) => w.program_id);
  const sessionsByWeek = groupBy(sessionRows, (s) => s.program_week_id);
  const exercisesBySession = groupBy(exerciseRows, (e) => e.session_id);
  const blocksBySession = groupBy(blockRows, (b) => b.session_id);
  const segmentsByBlock = groupBy(segmentRows, (p) => p.block_id ?? "");
  const assignmentsByProgram = groupBy(assignmentRows, (a) => a.content_id);

  return programRows.map((programRow) => {
    const weeksForProgram = weeksByProgram.get(programRow.id) ?? [];
    const weekNumberById = new Map(weeksForProgram.map((w) => [w.id, w.week_number]));
    const sessions = weeksForProgram
      .flatMap((week) => sessionsByWeek.get(week.id) ?? [])
      .map((sessionRow) => {
        const cardioBlocks = (blocksBySession.get(sessionRow.id) ?? []).map((blockRow) =>
          mapCardioBlockRow(blockRow, (segmentsByBlock.get(blockRow.id) ?? []).map(mapCardioSegmentRow)),
        );
        return mapSessionRow(
          sessionRow,
          weekNumberById.get(sessionRow.program_week_id) ?? 0,
          (exercisesBySession.get(sessionRow.id) ?? []).map(mapExerciseRow),
          cardioBlocks,
        );
      });
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

/**
 * Insère les blocs cardio et leurs segments pour une séance donnée (V3).
 * Segments stockés dans `training_prescriptions` avec `block_id` renseigné
 * et `exercise_id` nul — voir mapCardioSegmentRow/AdminCardioSegment.
 * `set_number` est NOT NULL en base même pour ces lignes cardio ; on y met
 * l'ordre du segment, sa valeur réelle n'ayant aucun sens hors contexte
 * musculation (la contrainte UNIQUE(exercise_id, set_number) ne s'applique
 * de toute façon jamais ici puisque exercise_id est toujours nul).
 */
async function insertCardioBlocks(
  supabase: TypedSupabaseClient,
  sessionId: string,
  blocks: AdminCardioBlock[],
): Promise<void> {
  for (const block of blocks) {
    const { data: blockRow, error: blockError } = await supabase
      .from("training_blocks")
      .insert({
        session_id: sessionId,
        block_type: "cardio",
        title: block.title || "",
        position: block.order,
        cardio_type: block.cardioType,
        machine_type: block.machineType ?? null,
      })
      .select("id")
      .single();
    devWarn("insertCardioBlocks (training_blocks)", blockError);
    if (!blockRow || block.segments.length === 0) continue;

    const { error: segmentsError } = await supabase.from("training_prescriptions").insert(
      block.segments.map((segment) => ({
        block_id: blockRow.id,
        exercise_id: null,
        set_number: segment.order,
        set_type: "normal",
        segment_type: segment.segmentType,
        title: segment.title || null,
        repetitions: segment.repetitions ?? null,
        work_duration_seconds: segment.durationSeconds ?? null,
        distance_meters: segment.distanceMeters ?? null,
        elevation_gain_meters: segment.elevationGainMeters ?? null,
        incline_percentage: segment.inclinePercentage ?? null,
        recovery_duration_seconds: segment.recoveryDurationSeconds ?? null,
        recovery_distance_meters: segment.recoveryDistanceMeters ?? null,
        intensity_target_type: segment.intensityTargetType,
        target_vma_percentage: segment.targetVmaPercentage ?? null,
        target_speed_kmh: segment.targetSpeedKmh ?? null,
        target_pace_seconds_per_km: segment.targetPaceSecondsPerKm ?? null,
        target_hr_percentage: segment.targetHrPercentage ?? null,
        target_hr_zone: segment.targetHrZone ?? null,
        target_power_watts: segment.targetPowerWatts ?? null,
        target_cadence: segment.targetCadence ?? null,
        intensity_min: segment.intensityMin ?? null,
        intensity_max: segment.intensityMax ?? null,
        surface: segment.surface ?? null,
        terrain: segment.terrain ?? null,
        equipment_type: segment.equipmentType ?? null,
        // NOT NULL (défaut '') côté base — jamais envoyer null ici.
        coach_notes: segment.coachNotes || "",
        position: segment.order,
      })),
    );
    devWarn("insertCardioBlocks (training_prescriptions)", segmentsError);
  }
}

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
        session_type: session.sessionType ?? "strength",
        banner_url: session.bannerUrl ?? null,
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

    if (!session.isRestDay && (session.cardioBlocks?.length ?? 0) > 0) {
      await insertCardioBlocks(supabase, sessionRow.id, session.cardioBlocks ?? []);
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
      banner_url: data.bannerUrl ?? null,
      program_mode: data.programMode ?? "individuel",
      group_start_date: data.programMode === "groupe" ? (data.groupStartDate ?? null) : null,
      is_public: data.isPublic ?? false,
      public_subscription_template_id: data.isPublic ? (data.publicSubscriptionTemplateId ?? null) : null,
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
 * Duplique un programme complet (toutes ses semaines/séances/exercices/blocs
 * cardio) en un nouveau programme brouillon nommé "{nom} (copie)" — V3 étape
 * 4. Ne copie jamais les élèves assignés (`assignments`), pour ne jamais
 * assigner accidentellement une copie de travail : le coach doit assigner la
 * copie explicitement une fois prête. `insertProgramStructure` crée de toute
 * façon de nouvelles lignes `workout_sessions`, donc les ids de séance source
 * ne sont jamais réutilisés ; on régénère aussi les ids d'exercices/blocs
 * cardio pour ne jamais partager de référence avec le programme source.
 */
export async function duplicateProgram(supabase: TypedSupabaseClient, programId: string): Promise<string | null> {
  const { data: sourceRow, error: sourceError } = await supabase.from("programs").select("*").eq("id", programId).single();
  devWarn("duplicateProgram (lecture programme)", sourceError);
  if (!sourceRow) {
    return null;
  }

  const [program] = await loadPrograms(supabase, [sourceRow]);
  if (!program) {
    return null;
  }

  const { data: newProgramRow, error: insertError } = await supabase
    .from("programs")
    .insert({
      name: `${program.name} (copie)`,
      goal: program.goal,
      level: program.level,
      duration_weeks: program.durationWeeks,
      description: program.description,
      status: "brouillon",
      banner_url: program.bannerUrl ?? null,
      // étape 5 : une copie repart toujours en mode individuel, sans date de
      // groupe — la copie d'un programme de groupe n'est pas automatiquement
      // liée à la même cohorte/date de démarrage, le coach reconfigure si besoin.
      program_mode: "individuel",
      group_start_date: null,
      // étape 6 : une copie ne repasse jamais publique automatiquement — le
      // coach republie explicitement une fois la copie prête (évite de
      // publier accidentellement une copie de travail non finalisée).
      is_public: false,
      public_subscription_template_id: null,
    })
    .select("id")
    .single();
  devWarn("duplicateProgram (insertion programme)", insertError);
  if (!newProgramRow) {
    return null;
  }

  const clonedSessions: AdminWorkoutSession[] = program.sessions.map((session) => ({
    ...session,
    id: generateId("sess"),
    programId: newProgramRow.id,
    exercises: session.exercises.map((ex) => ({ ...ex, id: generateId("ex") })),
    cardioBlocks: (session.cardioBlocks ?? []).map((block) => cloneCardioBlock(block)),
  }));

  await insertProgramStructure(supabase, newProgramRow.id, clonedSessions);
  return newProgramRow.id;
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
        session_type: session.sessionType ?? "strength",
        banner_url: session.bannerUrl ?? null,
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
        session_type: session.sessionType ?? "strength",
        banner_url: session.bannerUrl ?? null,
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

  /*
   * Blocs cardio (V3) : remplacés en bloc (delete + reinsert) pour chaque
   * séance plutôt que diffés finement comme les exercices. Contrairement
   * aux séances/exercices, rien ne référence encore un bloc ou un segment
   * cardio par id (pas de retour élève, pas de stat calculée dessus) — le
   * problème qui a motivé le diff fin des exercices (perte du rattachement
   * workout_feedback.session_id, voir le commentaire au-dessus de cette
   * fonction) ne se pose donc pas ici. Un delete + reinsert est sûr et bien
   * plus simple que de reproduire la résolution parent/enfant d'un vrai
   * diff, pour un gain nul à ce stade.
   */
  const allResolvedSessionIds = sessions
    .map((session) => resolveSessionId(session))
    .filter((id): id is string => Boolean(id));

  const { data: existingBlocksRaw, error: existingBlocksError } =
    allResolvedSessionIds.length > 0
      ? await supabase.from("training_blocks").select("id, session_id").in("session_id", allResolvedSessionIds)
      : { data: [] as { id: string; session_id: string }[], error: null };
  devWarn("diffProgramStructure (training_blocks lecture)", existingBlocksError);
  const existingBlockIds = (existingBlocksRaw ?? []).map((b) => b.id);

  if (existingBlockIds.length > 0) {
    const { error } = await supabase.from("training_blocks").delete().in("id", existingBlockIds);
    devWarn("diffProgramStructure (training_blocks suppression)", error);
  }

  for (const session of sessions) {
    const sessionId = resolveSessionId(session);
    if (!sessionId || session.isRestDay) continue;
    if ((session.cardioBlocks?.length ?? 0) > 0) {
      await insertCardioBlocks(supabase, sessionId, session.cardioBlocks ?? []);
    }
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
      banner_url: data.bannerUrl ?? null,
      program_mode: data.programMode ?? "individuel",
      group_start_date: data.programMode === "groupe" ? (data.groupStartDate ?? null) : null,
      is_public: data.isPublic ?? false,
      public_subscription_template_id: data.isPublic ? (data.publicSubscriptionTemplateId ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", programId);
  devWarn("updateProgram", updateError);

  await diffProgramStructure(supabase, programId, data.sessions);
  return !updateError;
}

/**
 * Supprime définitivement un programme et toute sa structure — jamais
 * juste un archivage. La cascade DB (program_weeks/workout_sessions/
 * workout_exercises/training_blocks/training_prescriptions/
 * training_change_history → programs ON DELETE CASCADE) fait le reste ;
 * `workout_feedback.program_id` passe à null (ON DELETE SET NULL), le
 * retour élève survit sans rattachement. `assignments` n'a en revanche
 * aucune FK vers `programs` (content_id est polymorphe, content_type
 * générique) : on supprime donc explicitement ses lignes en premier pour ne
 * jamais laisser une assignation orpheline pointer vers un programme
 * supprimé.
 */
export async function deleteProgram(supabase: TypedSupabaseClient, programId: string): Promise<boolean> {
  const { error: assignmentsError } = await supabase
    .from("assignments")
    .delete()
    .eq("content_type", "programme")
    .eq("content_id", programId);
  devWarn("deleteProgram (assignments)", assignmentsError);

  const { error } = await supabase.from("programs").delete().eq("id", programId);
  devWarn("deleteProgram", error);
  return !error;
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
