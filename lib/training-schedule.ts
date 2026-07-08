import { ADMIN_REFERENCE_DATE, daysBetween, weekDays } from "@/lib/admin";
import type {
  AdminContentStatus,
  AdminProgram,
  AdminStudent,
  AdminWorkoutSession,
  Exercise,
  ProgramScheduleDay,
  ProgramStatus,
  TrainingProgram,
  WorkoutSession,
} from "@/types";

/**
 * Compose un AdminProgram Supabase réel (voir lib/supabase/programs.ts) vers
 * les types élève historiques (TrainingProgram / WorkoutSession /
 * ProgramScheduleDay) déjà consommés par les pages /entrainement et leurs
 * composants (TrainingProgramCard, NextSessionHighlight, ProgramWeekCalendar,
 * WeekAnalysisSection) — ces composants n'ont donc rien à changer.
 *
 * Utilise ADMIN_REFERENCE_DATE (même date de référence figée que le reste de
 * l'admin, voir lib/admin.ts) plutôt que `new Date()`, pour rester cohérent
 * avec le calcul de semaine déjà utilisé côté admin (/admin/eleves/[studentId]).
 */

const STATUS_ADMIN_TO_STUDENT: Record<AdminContentStatus, ProgramStatus> = {
  brouillon: "à venir",
  actif: "actif",
  "archivé": "terminé",
};

/** Numéro de semaine "actuelle" pour un élève, dérivé de sa date de début de suivi. */
export function computeCurrentWeekNumber(program: AdminProgram, student: AdminStudent | null): number {
  if (program.status !== "actif" || !student || !student.startDate) {
    return 1;
  }
  const daysSinceStart = daysBetween(student.startDate);
  if (!Number.isFinite(daysSinceStart) || daysSinceStart < 0) {
    return 1;
  }
  const weekNumber = Math.floor(daysSinceStart / 7) + 1;
  return Math.min(Math.max(program.durationWeeks, 1), Math.max(1, weekNumber));
}

/** Planning des 7 jours d'une semaine donnée du programme, avec `isToday` calculé sur ADMIN_REFERENCE_DATE. */
export function buildScheduleForWeek(program: AdminProgram, weekNumber: number): ProgramScheduleDay[] {
  // getDay() : 0 = dimanche .. 6 = samedi -> réindexé pour matcher weekDays (0 = lundi .. 6 = dimanche).
  const jsWeekday = ADMIN_REFERENCE_DATE.getDay();
  const todayIndex = (jsWeekday + 6) % 7;
  const sessionsForWeek = program.sessions.filter((s) => s.weekNumber === weekNumber);

  return weekDays.map((day, index) => {
    const session = sessionsForWeek.find((s) => s.day === day && !s.isRestDay);
    return {
      day,
      isToday: index === todayIndex,
      sessionId: session ? session.id : null,
    };
  });
}

function toEleveExercise(exercise: AdminWorkoutSession["exercises"][number]): Exercise {
  return {
    id: exercise.id,
    name: exercise.name,
    sets: exercise.sets,
    reps: exercise.reps,
    restSeconds: exercise.restSeconds,
    tempo: exercise.tempo,
    recommendedLoad: exercise.recommendedLoad,
    videoUrl: exercise.videoUrl,
    muscleGroup: exercise.muscleGroup,
  };
}

export function toEleveWorkoutSession(session: AdminWorkoutSession): WorkoutSession {
  return {
    id: session.id,
    programId: session.programId,
    day: session.day,
    name: session.name,
    muscleGroups: session.muscleGroup,
    durationMinutes: session.durationMinutes,
    warmup: session.warmup,
    coachNotes: session.coachNotes,
    exercises: session.exercises.map(toEleveExercise),
  };
}

export function toEleveTrainingProgram(program: AdminProgram, weekNumber: number): TrainingProgram {
  const weekNumbers = Array.from(new Set(program.sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);
  const referenceWeek = weekNumbers.includes(weekNumber) ? weekNumber : (weekNumbers[0] ?? weekNumber);
  const sessionsPerWeek = program.sessions.filter((s) => s.weekNumber === referenceWeek && !s.isRestDay).length;
  const progressPercent =
    program.durationWeeks > 0 ? Math.round((Math.min(weekNumber, program.durationWeeks) / program.durationWeeks) * 100) : 0;

  return {
    id: program.id,
    name: program.name,
    goal: program.goal,
    level: program.level,
    durationWeeks: program.durationWeeks,
    status: STATUS_ADMIN_TO_STUDENT[program.status],
    sessionsPerWeek,
    currentWeek: weekNumber,
    progressPercent,
    schedule: buildScheduleForWeek(program, weekNumber),
  };
}
