import type { SupabaseClient } from "@supabase/supabase-js";

import { getActivityEventsForStudent } from "@/lib/supabase/activity";
import { getAppointmentsForStudent } from "@/lib/supabase/appointments";
import { getAssignedNutritionPlanForStudent } from "@/lib/supabase/nutrition";
import { getNutritionLogsForDates } from "@/lib/supabase/nutrition-logs";
import { getAssignedProgramForStudent } from "@/lib/supabase/programs";
import { getFullAdminStudent } from "@/lib/supabase/students";
import { getWorkoutFeedbackForStudent } from "@/lib/supabase/workout-feedback";
import { getAverageReps, getEffectiveLoadKg, parseLoad } from "@/lib/training-metrics";
import { getCurrentWeekDates, type DailyNutritionLog } from "@/lib/nutrition-weekly";
import type {
  ActivityEvent,
  AdminAppointment,
  AdminStudentFeedback,
  BodyMeasurement,
  CustomMeasurement,
  MeasurementLogEntry,
  ProgressPhoto,
  WeightEntry,
} from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'agrégation pour la page progression/analytics élève (chantier
 * "supabase-student-progress-analytics"). N'introduit AUCUNE nouvelle
 * table : compose exclusivement les fonctions de lecture déjà existantes
 * (students.ts, workout-feedback.ts, nutrition.ts/nutrition-logs.ts,
 * programs.ts, appointments.ts, activity.ts) — voir
 * docs/supabase-student-progress-analytics-model.md pour le détail de
 * l'audit. Chaque fonction reste indépendamment appelable (comme demandé),
 * même si certaines rechargent des données déjà lues par une autre — volume
 * faible par élève, pas un chemin chaud, simplicité préférée à la
 * micro-optimisation (page appelée une fois par visite d'un coach ou d'un
 * élève, jamais en boucle).
 *
 * Toutes les fonctions renvoient une forme "vide mais valide" (jamais
 * d'exception, jamais de donnée inventée) si Supabase n'a rien à
 * renvoyer — la page affiche alors un état vide explicite plutôt qu'un
 * plantage ou des zéros qui ressembleraient à de vraies données.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(context: string, error: unknown): void {
  if (error) {
    console.error(`[Supabase] ${context} :`, error);
  }
}

/* ─── 1. Résumé global ─── */

export interface StudentProgressSummary {
  firstName: string;
  lastName: string;
  startWeightKg: number | null;
  currentWeightKg: number | null;
  targetWeightKg: number | null;
  weightDeltaKg: number | null;
  weightDistanceToGoalKg: number | null;
  goal: string;
  daysSinceStart: number | null;
  sessionsCompleted: number;
  feedbackSentCount: number;
  /** null si aucun programme assigné (pas de dénominateur exploitable). */
  attendanceRatePercent: number | null;
  lastWorkoutFeedbackAt: string | null;
  lastNutritionLogAt: string | null;
  nextAppointmentAt: string | null;
}

export async function getStudentProgressSummary(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<StudentProgressSummary> {
  const [student, feedback, program, appointments, latestLog] = await Promise.all([
    getFullAdminStudent(supabase, studentId),
    getWorkoutFeedbackForStudent(supabase, studentId),
    getAssignedProgramForStudent(supabase, studentId),
    getAppointmentsForStudent(supabase, studentId),
    getLatestNutritionLogDate(supabase, studentId),
  ]);

  const hasWeightData = !!student && (student.weightHistory.length > 0 || student.currentWeightKg > 0);
  const startWeightKg = hasWeightData ? (student!.startWeightKg || student!.weightHistory[0]?.kg || null) : null;
  const currentWeightKg = hasWeightData ? (student!.currentWeightKg || null) : null;
  const targetWeightKg = student?.targetWeightKg || null;
  const weightDeltaKg =
    startWeightKg !== null && currentWeightKg !== null ? Math.round((currentWeightKg - startWeightKg) * 10) / 10 : null;
  const weightDistanceToGoalKg =
    currentWeightKg !== null && targetWeightKg !== null ? Math.round((targetWeightKg - currentWeightKg) * 10) / 10 : null;

  const daysSinceStart = student?.startDate
    ? Math.max(0, Math.floor((Date.now() - new Date(student.startDate).getTime()) / 86_400_000))
    : null;

  const completedFeedback = feedback.filter((f) => f.type === "entrainement" && f.completed !== false);
  const sessionsCompleted = completedFeedback.length;
  const plannedSessions = program ? program.sessions.filter((s) => !s.isRestDay).length : 0;
  const attendanceRatePercent = plannedSessions > 0 ? Math.round((sessionsCompleted / plannedSessions) * 100) : null;

  const lastWorkoutFeedbackAt = feedback.length > 0 ? feedback.slice().sort((a, b) => b.date.localeCompare(a.date))[0].date : null;

  const now = Date.now();
  const upcomingAppointment = appointments
    .filter((a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).getTime() >= now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];

  return {
    firstName: student?.firstName ?? "",
    lastName: student?.lastName ?? "",
    startWeightKg,
    currentWeightKg,
    targetWeightKg,
    weightDeltaKg,
    weightDistanceToGoalKg,
    goal: student?.goal ?? "",
    daysSinceStart,
    sessionsCompleted,
    feedbackSentCount: feedback.length,
    attendanceRatePercent,
    lastWorkoutFeedbackAt,
    lastNutritionLogAt: latestLog,
    nextAppointmentAt: upcomingAppointment?.startAt ?? null,
  };
}

async function getLatestNutritionLogDate(supabase: TypedSupabaseClient, studentId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("nutrition_daily_logs")
    .select("log_date")
    .eq("student_id", studentId)
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  devWarn("getLatestNutritionLogDate", error);
  return data?.log_date ?? null;
}

/* ─── 2. Évolution du poids + mensurations ─── */

export interface StudentWeightProgress {
  history: WeightEntry[];
  startWeightKg: number | null;
  currentWeightKg: number | null;
  targetWeightKg: number | null;
  delta7dKg: number | null;
  delta30dKg: number | null;
  deltaTotalKg: number | null;
  lastWeighInAt: string | null;
  measurements: BodyMeasurement[];
  customMeasurements: CustomMeasurement[];
  measurementHistory: MeasurementLogEntry[];
}

/** Delta entre le dernier relevé et le dernier relevé disponible au moins `days` avant lui — null si l'historique ne couvre pas assez loin. */
function deltaOverDays(history: WeightEntry[], dates: string[], days: number): number | null {
  if (history.length === 0 || dates.length === 0) return null;
  const lastIndex = history.length - 1;
  const lastDate = new Date(dates[lastIndex]).getTime();
  const cutoff = lastDate - days * 86_400_000;
  let referenceIndex = -1;
  for (let i = lastIndex; i >= 0; i -= 1) {
    if (new Date(dates[i]).getTime() <= cutoff) {
      referenceIndex = i;
      break;
    }
  }
  if (referenceIndex === -1) return null;
  return Math.round((history[lastIndex].kg - history[referenceIndex].kg) * 10) / 10;
}

export async function getStudentWeightProgress(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<StudentWeightProgress> {
  const student = await getFullAdminStudent(supabase, studentId);
  const { data: rawEntries, error } = await supabase
    .from("weight_entries")
    .select("recorded_at, weight_kg")
    .eq("student_id", studentId)
    .order("recorded_at", { ascending: true });
  devWarn("getStudentWeightProgress (weight_entries)", error);

  const dates = (rawEntries ?? []).map((r) => r.recorded_at);
  const history: WeightEntry[] = student?.weightHistory ?? [];

  const startWeightKg = history.length > 0 ? history[0].kg : student?.startWeightKg || null;
  const currentWeightKg = history.length > 0 ? history[history.length - 1].kg : student?.currentWeightKg || null;

  return {
    history,
    startWeightKg,
    currentWeightKg,
    targetWeightKg: student?.targetWeightKg || null,
    delta7dKg: deltaOverDays(history, dates, 7),
    delta30dKg: deltaOverDays(history, dates, 30),
    deltaTotalKg:
      startWeightKg !== null && currentWeightKg !== null ? Math.round((currentWeightKg - startWeightKg) * 10) / 10 : null,
    lastWeighInAt: dates.length > 0 ? dates[dates.length - 1] : null,
    measurements: student?.measurements ?? [],
    customMeasurements: student?.customMeasurements ?? [],
    measurementHistory: student?.measurementHistory ?? [],
  };
}

/* ─── 3. Entraînement ─── */

export interface ExerciseProgressPoint {
  date: string;
  maxLoadKg: number | null;
}

export interface ExerciseProgressSeries {
  exerciseName: string;
  points: ExerciseProgressPoint[];
  /** true si au moins un point a une charge non chiffrable (poids du corps, machine sans charge...). */
  hasUnparsedLoads: boolean;
}

export interface StudentWorkoutAnalytics {
  sessionsCompleted: number;
  totalSets: number;
  totalVolume: number;
  totalTonnageKg: number;
  averageRpe: number | null;
  recentFeedback: AdminStudentFeedback[];
  topExercises: ExerciseProgressSeries[];
}

export async function getStudentWorkoutAnalytics(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<StudentWorkoutAnalytics> {
  const feedback = await getWorkoutFeedbackForStudent(supabase, studentId);
  const trainingFeedback = feedback.filter((f) => f.type === "entrainement");

  let totalSets = 0;
  let totalVolume = 0;
  let totalTonnageKg = 0;
  const rpeValues: number[] = [];
  const exerciseOccurrences = new Map<string, { date: string; loadKg: number | null }[]>();

  for (const entry of trainingFeedback) {
    if (entry.rpe !== null) rpeValues.push(entry.rpe);
    for (const exercise of entry.exerciseEntries) {
      totalSets += 1;
      const reps = getAverageReps(exercise.repsDone);
      totalVolume += reps;
      const parsed = parseLoad(exercise.loadUsed);
      const effectiveLoadKg = getEffectiveLoadKg(parsed);
      if (effectiveLoadKg !== null) {
        totalTonnageKg += reps * effectiveLoadKg;
      }
      const list = exerciseOccurrences.get(exercise.exerciseName) ?? [];
      list.push({ date: entry.date, loadKg: effectiveLoadKg });
      exerciseOccurrences.set(exercise.exerciseName, list);
    }
  }

  const topExercises: ExerciseProgressSeries[] = Array.from(exerciseOccurrences.entries())
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 4)
    .map(([exerciseName, occurrences]) => {
      const byDate = new Map<string, number | null>();
      let hasUnparsedLoads = false;
      for (const occ of occurrences) {
        if (occ.loadKg === null) {
          hasUnparsedLoads = true;
          continue;
        }
        const current = byDate.get(occ.date);
        if (current === undefined || current === null || occ.loadKg > current) {
          byDate.set(occ.date, occ.loadKg);
        }
      }
      const points = Array.from(byDate.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, maxLoadKg]) => ({ date, maxLoadKg }));
      return { exerciseName, points, hasUnparsedLoads };
    })
    .filter((series) => series.points.length > 0);

  return {
    sessionsCompleted: trainingFeedback.filter((f) => f.completed !== false).length,
    totalSets,
    totalVolume: Math.round(totalVolume),
    totalTonnageKg: Math.round(totalTonnageKg),
    averageRpe: rpeValues.length > 0 ? Math.round((rpeValues.reduce((a, b) => a + b, 0) / rpeValues.length) * 10) / 10 : null,
    recentFeedback: trainingFeedback.slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    topExercises,
  };
}

/* ─── 4. Nutrition ─── */

export interface StudentNutritionAnalytics {
  hasActivePlan: boolean;
  targetCaloriesPerDay: number | null;
  weeklyTargetCalories: number | null;
  weekCaloriesConsumed: number;
  daysFilledThisWeek: number;
  averageCalories: number | null;
  averageProtein: number | null;
  averageCarbs: number | null;
  averageFat: number | null;
  /** % d'écart moyen par rapport à l'objectif quotidien sur les jours remplis (positif = au-dessus). */
  averageVariancePercent: number | null;
  lastLogAt: string | null;
  /** Semaine courante — pour le graphique calories/jour (CaloriesWeekChart). */
  weekDates: string[];
  weekLogs: DailyNutritionLog[];
}

export async function getStudentNutritionAnalytics(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<StudentNutritionAnalytics> {
  const plan = await getAssignedNutritionPlanForStudent(supabase, studentId);
  const lastLogAt = await getLatestNutritionLogDate(supabase, studentId);
  const weekDates = getCurrentWeekDates();

  if (!plan) {
    return {
      hasActivePlan: false,
      targetCaloriesPerDay: null,
      weeklyTargetCalories: null,
      weekCaloriesConsumed: 0,
      daysFilledThisWeek: 0,
      averageCalories: null,
      averageProtein: null,
      averageCarbs: null,
      averageFat: null,
      averageVariancePercent: null,
      lastLogAt,
      weekDates,
      weekLogs: [],
    };
  }

  const logs = await getNutritionLogsForDates(supabase, studentId, plan.id, weekDates);
  const filled = logs.filter((l) => l.calories !== null);

  const sum = (key: "calories" | "proteinG" | "carbsG" | "fatG") =>
    filled.reduce((total, log) => total + (log[key] ?? 0), 0);
  const avg = (total: number) => (filled.length > 0 ? Math.round(total / filled.length) : null);

  const weekCaloriesConsumed = sum("calories");
  const averageCalories = avg(weekCaloriesConsumed);
  const averageVariancePercent =
    averageCalories !== null && plan.caloriesPerDay > 0
      ? Math.round(((averageCalories - plan.caloriesPerDay) / plan.caloriesPerDay) * 1000) / 10
      : null;

  return {
    hasActivePlan: true,
    targetCaloriesPerDay: plan.caloriesPerDay,
    weeklyTargetCalories: plan.weeklyTargetCalories ?? plan.caloriesPerDay * 7,
    weekCaloriesConsumed,
    daysFilledThisWeek: filled.length,
    averageCalories,
    averageProtein: avg(sum("proteinG")),
    averageCarbs: avg(sum("carbsG")),
    averageFat: avg(sum("fatG")),
    averageVariancePercent,
    weekDates,
    weekLogs: logs,
    lastLogAt,
  };
}

/* ─── 5. Rendez-vous ─── */

export interface StudentAppointmentStats {
  completedCount: number;
  cancelledCount: number;
  upcoming: AdminAppointment[];
  nextAppointment: AdminAppointment | null;
  lastAppointment: AdminAppointment | null;
}

export async function getStudentAppointmentStats(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<StudentAppointmentStats> {
  const appointments = await getAppointmentsForStudent(supabase, studentId);
  const now = Date.now();

  const completedCount = appointments.filter(
    (a) => a.status === "completed" || ((a.status === "confirmed" || a.status === "pending") && new Date(a.startAt).getTime() < now),
  ).length;
  const cancelledCount = appointments.filter((a) => a.status === "cancelled").length;
  const upcoming = appointments
    .filter((a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).getTime() >= now)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  const past = appointments
    .filter((a) => new Date(a.startAt).getTime() < now)
    .sort((a, b) => b.startAt.localeCompare(a.startAt));

  return {
    completedCount,
    cancelledCount,
    upcoming,
    nextAppointment: upcoming[0] ?? null,
    lastAppointment: past[0] ?? null,
  };
}

/* ─── 6. Activité récente ─── */

/** Simple alias explicite sur lib/supabase/activity.ts::getActivityEventsForStudent — pas de logique dupliquée. */
export async function getStudentRecentActivity(supabase: TypedSupabaseClient, studentId: string): Promise<ActivityEvent[]> {
  return getActivityEventsForStudent(supabase, studentId);
}

/* ─── Photos (lecture seule — pas de chantier photo ici, voir consigne) ─── */

export async function getStudentProgressPhotos(supabase: TypedSupabaseClient, studentId: string): Promise<ProgressPhoto[]> {
  const student = await getFullAdminStudent(supabase, studentId);
  return student?.progressPhotos ?? [];
}
