import type {
  ActualSetEntry,
  ExerciseMetrics,
  LoadType,
  MuscleGroup,
  MuscleGroupVolume,
  ParsedLoad,
  PlannedVsActualTrainingMetrics,
  SessionMetrics,
  TrainingMetrics,
  WeekTrainingMetrics,
} from "@/types";

/**
 * Formes minimales dont ont besoin les fonctions de ce fichier — satisfaites
 * structurellement par AdminExercise/AdminWorkoutSession (admin) et
 * Exercise/WorkoutSession (élève, en mappant muscleGroups → muscleGroup à
 * l'appel), sans les coupler à l'un ou l'autre modèle de données.
 */
export interface MetricsExerciseInput {
  id: string;
  name: string;
  muscleGroup?: string;
  sets: number;
  reps: string;
  recommendedLoad: string;
}

export interface MetricsSessionInput {
  id: string;
  day?: string;
  weekNumber?: number;
  isRestDay?: boolean;
  /** Groupe(s) musculaire(s) de la séance, utilisé en repli si un exercice n'a pas le sien. */
  muscleGroup: string;
  exercises: MetricsExerciseInput[];
}

export const muscleGroupOrder: MuscleGroup[] = [
  "pectoraux",
  "dos",
  "épaules",
  "biceps",
  "triceps",
  "quadriceps",
  "ischios",
  "fessiers",
  "mollets",
  "abdos",
  "lombaires",
  "cardio",
  "full-body",
  "autre",
];

export const muscleGroupLabels: Record<MuscleGroup, string> = {
  pectoraux: "Pectoraux",
  dos: "Dos",
  "épaules": "Épaules",
  biceps: "Biceps",
  triceps: "Triceps",
  quadriceps: "Quadriceps",
  ischios: "Ischios",
  fessiers: "Fessiers",
  mollets: "Mollets",
  abdos: "Abdos",
  lombaires: "Lombaires",
  cardio: "Cardio",
  "full-body": "Full body",
  autre: "Autre",
};

export const loadTypeLabels: Record<LoadType, string> = {
  kg: "Charge (kg)",
  kg_per_dumbbell: "Kg / haltère",
  bodyweight: "Poids du corps",
  machine: "Machine",
  assisted: "Assisté",
  other: "Autre",
};

function stripAccents(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

const muscleGroupAliases: [MuscleGroup, RegExp][] = [
  ["pectoraux", /pector|pecs\b|chest/],
  ["dos", /\bdos\b|dorsaux|back/],
  ["épaules", /epaule|shoulder|deltoide/],
  ["biceps", /biceps/],
  ["triceps", /triceps/],
  ["ischios", /ischio|hamstring/],
  ["fessiers", /fessier|glute/],
  ["mollets", /mollet|calf|calves/],
  // "jambes" est ambigu (quadriceps/ischios/fessiers/mollets) : on l'assigne
  // par défaut aux quadriceps, l'approximation la plus courante pour un
  // "jour jambes" généraliste — à affiner exercice par exercice si besoin.
  ["quadriceps", /quadri|\bjambe/],
  ["abdos", /abdo|sangle abdominale|core\b|gainage/],
  ["lombaires", /lombaire|lower back/],
  ["cardio", /cardio/],
  ["full-body", /corps entier|full.?body|full.?corps/],
];

/**
 * Normalise une étiquette libre (session ou exercice, ex: "Pectoraux,
 * triceps") vers un ou plusieurs MuscleGroup canoniques. Retourne
 * ["autre"] si rien ne correspond. Prépare le terrain pour une future
 * table Supabase `exercise.muscle_group` typée au lieu de texte libre.
 */
export function normalizeMuscleGroups(raw: string | undefined): MuscleGroup[] {
  if (!raw || !raw.trim()) return ["autre"];
  const tokens = raw
    .split(/[,/]|\bet\b/i)
    .map((t) => stripAccents(t.trim().toLowerCase()))
    .filter(Boolean);
  const matched = new Set<MuscleGroup>();
  for (const token of tokens) {
    const found = muscleGroupAliases.find(([, pattern]) => pattern.test(token));
    if (found) matched.add(found[0]);
  }
  return matched.size > 0 ? Array.from(matched) : ["autre"];
}

/** Premier MuscleGroup d'un exercice (son propre tag, sinon celui de la séance). */
export function resolveExerciseMuscleGroup(exercise: MetricsExerciseInput, sessionMuscleGroup: string): MuscleGroup {
  const groups = normalizeMuscleGroups(exercise.muscleGroup || sessionMuscleGroup);
  return groups[0];
}

/** Tous les MuscleGroup d'un exercice (son propre tag, sinon ceux de la séance). */
export function resolveExerciseMuscleGroups(exercise: MetricsExerciseInput, sessionMuscleGroup: string): MuscleGroup[] {
  return normalizeMuscleGroups(exercise.muscleGroup || sessionMuscleGroup);
}

/**
 * Extrait la fourchette de répétitions d'une chaîne libre (ex: "8-10",
 * "12", "12 / jambe"). Le texte après le nombre (unité, précision "par
 * jambe"...) est ignoré. Retourne null si aucun nombre n'est trouvé
 * (ex: "AMRAP").
 */
export function parseRepRange(reps: string): { min: number; max: number } | null {
  const match = reps.match(/(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?/);
  if (!match) return null;
  const min = Number(match[1].replace(",", "."));
  const max = match[2] ? Number(match[2].replace(",", ".")) : min;
  if (Number.isNaN(min) || Number.isNaN(max)) return null;
  return { min, max };
}

/** Moyenne d'une fourchette de répétitions ("8-10" → 9), 0 si non chiffrable. */
export function getAverageReps(reps: string): number {
  const range = parseRepRange(reps);
  if (!range) return 0;
  return (range.min + range.max) / 2;
}

/**
 * Analyse une chaîne de charge libre. Gère : "80 kg", "62.5 kg", "+10 kg"
 * (charge additionnelle, estimation), "24 kg / haltère" (par haltère,
 * doublée dans calculateExerciseTonnage), "poids du corps", "machine",
 * "assisté", fourchettes ("60-70 kg", moyenne).
 */
export function parseLoad(load: string): ParsedLoad {
  const text = stripAccents(load.trim().toLowerCase());

  if (!text) {
    return { loadType: "other", valueKg: null, isEstimate: true };
  }
  if (/poids du corps|body ?weight/.test(text)) {
    return { loadType: "bodyweight", valueKg: null, isEstimate: false };
  }
  if (/assist/.test(text)) {
    return { loadType: "assisted", valueKg: null, isEstimate: false };
  }

  const dumbbellMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:-\s*(\d+(?:[.,]\d+)?))?\s*kg\s*\/?\s*(?:par\s*)?(halte?re|dumbbell)/);
  if (dumbbellMatch) {
    const min = Number(dumbbellMatch[1].replace(",", "."));
    const max = dumbbellMatch[2] ? Number(dumbbellMatch[2].replace(",", ".")) : min;
    return { loadType: "kg_per_dumbbell", valueKg: (min + max) / 2, isEstimate: Boolean(dumbbellMatch[2]) };
  }

  const machineMatch = text.match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (/machine/.test(text)) {
    return {
      loadType: "machine",
      valueKg: machineMatch ? Number(machineMatch[1].replace(",", ".")) : null,
      isEstimate: false,
    };
  }

  const kgRangeMatch = text.match(/(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgRangeMatch) {
    const min = Number(kgRangeMatch[1].replace(",", "."));
    const max = Number(kgRangeMatch[2].replace(",", "."));
    return { loadType: "kg", valueKg: (min + max) / 2, isEstimate: true };
  }

  const kgMatch = text.match(/(\d+(?:[.,]\d+)?)\s*kg/);
  if (kgMatch) {
    return {
      loadType: "kg",
      valueKg: Number(kgMatch[1].replace(",", ".")),
      // Une charge notée "+10 kg" (lestage) exclut le poids du corps du
      // calcul : le tonnage réel est donc sous-estimé, on le signale.
      isEstimate: text.trim().startsWith("+"),
    };
  }

  return { loadType: "other", valueKg: null, isEstimate: true };
}

/** Charge effective (kg) utilisée pour le tonnage, en appliquant le doublement haltères. */
export function getEffectiveLoadKg(parsed: ParsedLoad): number | null {
  if (parsed.valueKg === null) return null;
  if (parsed.loadType === "kg_per_dumbbell") return parsed.valueKg * 2;
  return parsed.valueKg;
}

/** volume = sets × moyenne des répétitions. */
export function calculateExerciseVolume(sets: number, reps: string): number {
  return sets * getAverageReps(reps);
}

/** tonnage = sets × moyenne des répétitions × charge effective (kg). */
export function calculateExerciseTonnage(
  sets: number,
  reps: string,
  load: string,
): { tonnageKg: number; isEstimate: boolean; notCalculated: boolean; loadType: LoadType } {
  const parsedLoad = parseLoad(load);
  const effectiveLoadKg = getEffectiveLoadKg(parsedLoad);
  const repRange = parseRepRange(reps);
  const isRepEstimate = Boolean(repRange && repRange.min !== repRange.max);

  if (effectiveLoadKg === null) {
    return { tonnageKg: 0, isEstimate: parsedLoad.isEstimate || isRepEstimate, notCalculated: true, loadType: parsedLoad.loadType };
  }

  const tonnageKg = sets * getAverageReps(reps) * effectiveLoadKg;
  return {
    tonnageKg,
    isEstimate: parsedLoad.isEstimate || isRepEstimate,
    notCalculated: false,
    loadType: parsedLoad.loadType,
  };
}

function metricsForExercise(exercise: MetricsExerciseInput, sessionMuscleGroup: string): ExerciseMetrics {
  const muscleGroup = resolveExerciseMuscleGroup(exercise, sessionMuscleGroup);
  const volume = calculateExerciseVolume(exercise.sets, exercise.reps);
  const tonnage = calculateExerciseTonnage(exercise.sets, exercise.reps, exercise.recommendedLoad);
  return {
    exerciseId: exercise.id,
    name: exercise.name,
    muscleGroup,
    sets: exercise.sets,
    averageReps: getAverageReps(exercise.reps),
    volume,
    tonnageKg: tonnage.tonnageKg,
    loadType: tonnage.loadType,
    isEstimate: tonnage.isEstimate,
    notCalculated: tonnage.notCalculated,
  };
}

function emptyMuscleGroupVolumes(): Record<MuscleGroup, MuscleGroupVolume> {
  const entries = muscleGroupOrder.map((group) => [group, { muscleGroup: group, sets: 0, volume: 0, tonnageKg: 0 }] as const);
  return Object.fromEntries(entries) as Record<MuscleGroup, MuscleGroupVolume>;
}

/** Séries/volume/tonnage par groupe musculaire pour une liste de séances (semaine, programme...). */
export function calculateMuscleGroupSets(sessions: MetricsSessionInput[]): MuscleGroupVolume[] {
  const totals = emptyMuscleGroupVolumes();
  for (const session of sessions) {
    if (session.isRestDay) continue;
    for (const exercise of session.exercises) {
      const groups = resolveExerciseMuscleGroups(exercise, session.muscleGroup);
      const volume = calculateExerciseVolume(exercise.sets, exercise.reps);
      const tonnage = calculateExerciseTonnage(exercise.sets, exercise.reps, exercise.recommendedLoad);
      for (const group of groups) {
        totals[group].sets += exercise.sets;
        totals[group].volume += volume;
        totals[group].tonnageKg += tonnage.tonnageKg;
      }
    }
  }
  return muscleGroupOrder.map((group) => totals[group]).filter((entry) => entry.sets > 0);
}

/** Métriques agrégées pour une séance entière. */
export function calculateSessionMetrics(session: MetricsSessionInput): SessionMetrics {
  const exercises = session.isRestDay
    ? []
    : session.exercises.map((exercise) => metricsForExercise(exercise, session.muscleGroup));

  return {
    sessionId: session.id,
    totalSets: exercises.reduce((sum, ex) => sum + ex.sets, 0),
    totalVolume: exercises.reduce((sum, ex) => sum + ex.volume, 0),
    totalTonnageKg: exercises.reduce((sum, ex) => sum + ex.tonnageKg, 0),
    hasEstimatedValues: exercises.some((ex) => ex.isEstimate),
    hasNotCalculatedValues: exercises.some((ex) => ex.notCalculated),
    exercises,
    muscleGroupBreakdown: calculateMuscleGroupSets([session]),
  };
}

/** Métriques agrégées pour toutes les séances d'une semaine de programme. */
export function calculateWeekMetrics(sessions: MetricsSessionInput[], weekNumber: number): WeekTrainingMetrics {
  const weekSessions = sessions.filter((s) => s.weekNumber === weekNumber && !s.isRestDay);
  const muscleGroupBreakdown = calculateMuscleGroupSets(weekSessions);
  const mostTrained = [...muscleGroupBreakdown].sort((a, b) => b.sets - a.sets)[0] ?? null;

  const setsByDay = new Map<string, number>();
  for (const session of weekSessions) {
    const sessionSets = session.exercises.reduce((sum, ex) => sum + ex.sets, 0);
    setsByDay.set(session.day ?? session.id, (setsByDay.get(session.day ?? session.id) ?? 0) + sessionSets);
  }
  let busiestDay: { day: string; sets: number } | null = null;
  for (const [day, sets] of setsByDay) {
    if (!busiestDay || sets > busiestDay.sets) busiestDay = { day, sets };
  }

  return {
    weekNumber,
    sessionsCount: weekSessions.length,
    totalSets: weekSessions.reduce((sum, s) => sum + s.exercises.reduce((esum, ex) => esum + ex.sets, 0), 0),
    totalVolume: weekSessions.reduce(
      (sum, s) => sum + s.exercises.reduce((esum, ex) => esum + calculateExerciseVolume(ex.sets, ex.reps), 0),
      0,
    ),
    totalTonnageKg: weekSessions.reduce(
      (sum, s) => sum + s.exercises.reduce((esum, ex) => esum + calculateExerciseTonnage(ex.sets, ex.reps, ex.recommendedLoad).tonnageKg, 0),
      0,
    ),
    muscleGroupBreakdown,
    mostTrainedMuscleGroup: mostTrained?.muscleGroup ?? null,
    busiestDay,
  };
}

/** Métriques agrégées génériques pour une liste de séances quelconque (programme entier...). */
export function calculateTrainingMetrics(sessions: MetricsSessionInput[]): TrainingMetrics {
  const trainingSessions = sessions.filter((s) => !s.isRestDay);
  return {
    totalSets: trainingSessions.reduce((sum, s) => sum + s.exercises.reduce((esum, ex) => esum + ex.sets, 0), 0),
    totalVolume: trainingSessions.reduce(
      (sum, s) => sum + s.exercises.reduce((esum, ex) => esum + calculateExerciseVolume(ex.sets, ex.reps), 0),
      0,
    ),
    totalTonnageKg: trainingSessions.reduce(
      (sum, s) => sum + s.exercises.reduce((esum, ex) => esum + calculateExerciseTonnage(ex.sets, ex.reps, ex.recommendedLoad).tonnageKg, 0),
      0,
    ),
    muscleGroupBreakdown: calculateMuscleGroupSets(trainingSessions),
  };
}

/**
 * Compare les métriques prévues (programme) aux métriques réalisées
 * (retour élève, ex: AdminStudentFeedback.exerciseEntries). Regroupe les
 * entrées réalisées par nom d'exercice (correspondance texte avec le nom
 * planifié) et calcule sets/reps moyens/charge moyenne réellement
 * enregistrés. `actual` reste null tant qu'aucune entrée ne correspond.
 */
export function calculatePlannedVsActualMetrics(
  planned: MetricsSessionInput,
  actualEntries: ActualSetEntry[],
): PlannedVsActualTrainingMetrics {
  const plannedMetrics = calculateSessionMetrics(planned);

  if (actualEntries.length === 0) {
    return { planned: plannedMetrics, actual: null, volumeDeltaPercent: null, tonnageDeltaKg: null, tonnageDeltaPercent: null };
  }

  const byExercise = new Map<string, ActualSetEntry[]>();
  for (const entry of actualEntries) {
    const key = stripAccents(entry.exerciseName.trim().toLowerCase());
    byExercise.set(key, [...(byExercise.get(key) ?? []), entry]);
  }

  const actualExercises: ExerciseMetrics[] = [];
  for (const exercise of planned.isRestDay ? [] : planned.exercises) {
    const key = stripAccents(exercise.name.trim().toLowerCase());
    const entries = byExercise.get(key);
    if (!entries || entries.length === 0) continue;

    const actualSets = new Set(entries.map((e) => e.setNumber)).size;
    const repsValues = entries.map((e) => getAverageReps(e.repsDone)).filter((v) => v > 0);
    const averageReps = repsValues.length > 0 ? repsValues.reduce((a, b) => a + b, 0) / repsValues.length : 0;

    const loadValues = entries.map((e) => getEffectiveLoadKg(parseLoad(e.loadUsed))).filter((v): v is number => v !== null);
    const notCalculated = loadValues.length === 0;
    const averageLoadKg = loadValues.length > 0 ? loadValues.reduce((a, b) => a + b, 0) / loadValues.length : 0;

    const muscleGroup = resolveExerciseMuscleGroup(exercise, planned.muscleGroup);
    const volume = actualSets * averageReps;
    const tonnageKg = notCalculated ? 0 : actualSets * averageReps * averageLoadKg;

    actualExercises.push({
      exerciseId: exercise.id,
      name: exercise.name,
      muscleGroup,
      sets: actualSets,
      averageReps,
      volume,
      tonnageKg,
      loadType: notCalculated ? "other" : "kg",
      isEstimate: true,
      notCalculated,
    });
  }

  if (actualExercises.length === 0) {
    return { planned: plannedMetrics, actual: null, volumeDeltaPercent: null, tonnageDeltaKg: null, tonnageDeltaPercent: null };
  }

  const actualMetrics: SessionMetrics = {
    sessionId: planned.id,
    totalSets: actualExercises.reduce((sum, ex) => sum + ex.sets, 0),
    totalVolume: actualExercises.reduce((sum, ex) => sum + ex.volume, 0),
    totalTonnageKg: actualExercises.reduce((sum, ex) => sum + ex.tonnageKg, 0),
    hasEstimatedValues: true,
    hasNotCalculatedValues: actualExercises.some((ex) => ex.notCalculated),
    exercises: actualExercises,
    muscleGroupBreakdown: calculateMuscleGroupSets([
      { ...planned, exercises: planned.exercises.filter((ex) => actualExercises.some((a) => a.exerciseId === ex.id)) },
    ]),
  };

  const volumeDeltaPercent =
    plannedMetrics.totalVolume > 0 ? ((actualMetrics.totalVolume - plannedMetrics.totalVolume) / plannedMetrics.totalVolume) * 100 : null;
  const tonnageDeltaKg = actualMetrics.totalTonnageKg - plannedMetrics.totalTonnageKg;
  const tonnageDeltaPercent =
    plannedMetrics.totalTonnageKg > 0 ? (tonnageDeltaKg / plannedMetrics.totalTonnageKg) * 100 : null;

  return { planned: plannedMetrics, actual: actualMetrics, volumeDeltaPercent, tonnageDeltaKg, tonnageDeltaPercent };
}

/* ─── Formatage d'affichage ─── */

export function formatVolume(volume: number): string {
  return `${Math.round(volume)} reps totales`;
}

export function formatSets(sets: number): string {
  return `${Math.round(sets)} série${sets > 1 ? "s" : ""}`;
}

export function formatTonnage(tonnageKg: number): string {
  return `${Math.round(tonnageKg).toLocaleString("fr-FR")} kg`;
}
