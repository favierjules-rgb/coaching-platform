import { daysBetween, weekDays } from "@/lib/admin";
import { currentDate } from "@/lib/clock";
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
 * Les calculs dépendant du temps (semaine actuelle, repère « aujourd'hui »)
 * utilisent la date RÉELLE via `currentDate()` — correction du 26/07/2026 :
 * ils s'appuyaient jusqu'ici sur ADMIN_REFERENCE_DATE, une date de démo figée
 * au 2 juillet 2026, ce qui gelait la progression des semaines en production.
 * Le paramètre `reference` reste injectable pour garder les tests
 * déterministes.
 */

const STATUS_ADMIN_TO_STUDENT: Record<AdminContentStatus, ProgramStatus> = {
  brouillon: "à venir",
  actif: "actif",
  "archivé": "terminé",
};

/**
 * D'OÙ VIENT LA DATE QUI SERT D'ANCRE — la question, avant le calcul.
 *
 *  · `programme`   — `assignment.programStartDate`. La vérité : la date à
 *    laquelle CE programme commence pour CET élève, décidée par le coach.
 *  · `groupe`      — `program.groupStartDate`. Inchangé : une cohorte partage
 *    un calendrier, c'est le sens même du mode groupe.
 *  · `repli-suivi` — `student.startDate`. L'ANCIENNE ancre, conservée pour les
 *    affectations pas encore régularisées. Transitoire, et surtout NOMMÉE :
 *    c'est ce qui empêche le repli de redevenir la norme en silence.
 *  · `aucune`      — rien d'exploitable, semaine 1.
 */
export type OrigineAncre = "programme" | "groupe" | "repli-suivi" | "aucune";

export interface AncreDeSemaine {
  readonly origine: OrigineAncre;
  readonly date: string | null;
}

/**
 * L'ancre temporelle d'un programme, et d'où elle vient.
 *
 * ⚠️ RENDRE L'ORIGINE, PAS SEULEMENT LA DATE. Un calcul qui ne rendrait que la
 * date serait juste et muet : impossible de distinguer « le coach a fixé le
 * 17/08 » de « personne n'a rien fixé, on retombe sur la date d'inscription ».
 * C'est exactement la confusion qui a produit le défaut d'origine — une élève
 * ayant reçu son programme le jour même se voyait annoncer « Semaine 5 / 12 ».
 * L'interface admin peut désormais signaler le repli au lieu de le subir.
 */
export function ancreDeSemaine(program: AdminProgram, student: AdminStudent | null): AncreDeSemaine {
  if (program.programMode === "groupe") {
    return program.groupStartDate
      ? { origine: "groupe", date: program.groupStartDate }
      : { origine: "aucune", date: null };
  }
  if (program.programStartDate) {
    return { origine: "programme", date: program.programStartDate };
  }
  // ⚠️ LE REPLI N'EST PAS UN DÉFAUT DE CONCEPTION, C'EST UNE TRANSITION.
  // 14 affectations existaient sans date au moment de ce lot ; les faire
  // toutes retomber en « semaine 1 » du jour au lendemain serait une
  // régression visible pour des élèves qui s'entraînent. Le repli tient le
  // temps de la régularisation — et se voit, pendant ce temps.
  return student?.startDate
    ? { origine: "repli-suivi", date: student.startDate }
    : { origine: "aucune", date: null };
}

/**
 * Numéro de semaine "actuelle" du programme.
 *
 * ⚠️ L'ANCRE N'EST PLUS `students.start_date` POUR UN PROGRAMME INDIVIDUEL.
 * Cette colonne est le début du SUIVI, et vaut son propre `created_at` dans
 * 11 cas sur 15 en production : elle ne dit rien du programme. La date de
 * début vit désormais sur l'AFFECTATION — voir `ancreDeSemaine`.
 *
 * La formule, elle, était juste et ne change pas : `floor(jours / 7) + 1`.
 */
export function computeCurrentWeekNumber(
  program: AdminProgram,
  student: AdminStudent | null,
  reference: Date = currentDate(),
): number {
  if (program.status !== "actif") {
    return 1;
  }

  const { date: referenceDate } = ancreDeSemaine(program, student);
  if (!referenceDate) {
    return 1;
  }

  const daysSinceStart = daysBetween(referenceDate, reference);
  // ⚠️ `daysSinceStart < 0` EST REDONDANT AVEC LE `Math.max(1, …)` FINAL, et
  // le sabotage l'a montré : le retirer ne rougit aucun test, parce qu'une
  // date antérieure donne `floor(-7/7)+1 = 0`, que la borne ramène à 1. Il
  // reste pour DIRE l'intention — « une date future n'est pas une semaine 0 »
  // — au lieu de la laisser dépendre d'un effet de bord arithmétique deux
  // lignes plus bas. `Number.isFinite`, lui, est indispensable : il attrape le
  // NaN d'une date illisible, que `Math.max` propagerait.
  if (!Number.isFinite(daysSinceStart) || daysSinceStart < 0) {
    return 1;
  }
  const weekNumber = Math.floor(daysSinceStart / 7) + 1;
  return Math.min(Math.max(program.durationWeeks, 1), Math.max(1, weekNumber));
}

/**
 * Planning des 7 jours d'une semaine donnée du programme.
 *
 * ⚠️ `semaineCourante` DÉCIDE SI « AUJOURD'HUI » A LE DROIT D'EXISTER DANS CE
 * BLOC. C'est le correctif C-min. La page de détail d'un programme empile les
 * 12 semaines et appelait cette fonction une fois par semaine, sans jamais
 * dire laquelle était la bonne : `isToday` se posait donc sur le mardi de la
 * semaine 1, de la 2, de la 3… et des douze à la fois. Douze « aujourd'hui »
 * simultanés, ce qui donnait l'impression d'un calendrier qui défile.
 *
 * ⚠️ PARAMÈTRE OPTIONNEL, ET C'EST DÉLIBÉRÉ. Omis, le repère reste posé —
 * comportement historique, préservé pour les appels qui ne construisent qu'UNE
 * semaine (le bandeau élève, la carte de programme) et pour lesquels la
 * question ne se pose pas. Le rendre obligatoire aurait forcé à réécrire des
 * appelants corrects, et c'est un autre chantier.
 */
export function buildScheduleForWeek(
  program: AdminProgram,
  weekNumber: number,
  reference: Date = currentDate(),
  semaineCourante?: number,
): ProgramScheduleDay[] {
  // getDay() : 0 = dimanche .. 6 = samedi -> réindexé pour matcher weekDays (0 = lundi .. 6 = dimanche).
  const jsWeekday = reference.getDay();
  const todayIndex = (jsWeekday + 6) % 7;
  const semaineAffichee = semaineCourante === undefined || semaineCourante === weekNumber;
  const sessionsForWeek = program.sessions.filter((s) => s.weekNumber === weekNumber);

  return weekDays.map((day, index) => {
    const session = sessionsForWeek.find((s) => s.day === day && !s.isRestDay);
    return {
      day,
      isToday: semaineAffichee && index === todayIndex,
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
    // RPE cible prescrit — placeholder RPE des séries côté élève.
    recommendedRpe: exercise.recommendedRpe ?? "",
    videoUrl: exercise.videoUrl,
    muscleGroup: exercise.muscleGroup,
    // feat/student-previous-set-performance : propagée pour la recherche de
    // la dernière performance (le chemin blocks[] la transporte déjà via
    // AdminExercise ; ce chemin legacy la perdait).
    libraryExerciseId: exercise.libraryExerciseId ?? null,
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
    // V3 étape 5 : transmis tels quels pour l'affichage cardio élève, voir
    // components/student/CardioBlocksSection.tsx.
    sessionType: session.sessionType,
    cardioBlocks: session.cardioBlocks,
    // Multi-blocs : liste canonique déjà composée par lib/supabase/programs.ts
    // (couleurs/ordre réels). Propagée au bord élève pour l'affichage des cartes
    // de séance et de la carte de chaleur musculaire — jamais recomposée depuis
    // exercises[]/cardioBlocks[] dans les composants.
    blocks: session.blocks,
    bannerUrl: session.bannerUrl,
  };
}

export function toEleveTrainingProgram(
  program: AdminProgram,
  weekNumber: number,
  reference: Date = currentDate(),
): TrainingProgram {
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
    schedule: buildScheduleForWeek(program, weekNumber, reference),
    bannerUrl: program.bannerUrl,
  };
}
