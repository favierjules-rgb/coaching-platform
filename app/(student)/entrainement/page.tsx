"use client";

import { NextSessionHighlight } from "@/components/student/NextSessionHighlight";
import { TrainingProgramCard } from "@/components/student/TrainingProgramCard";
import {
  activeProgram,
  getHighlightedScheduleDay,
  getWorkoutSession,
  trainingPrograms,
} from "@/data/student";
import { useSupabaseTrainingProgram } from "@/hooks/useSupabaseTrainingProgram";
import { computeCurrentWeekNumber, toEleveTrainingProgram, toEleveWorkoutSession } from "@/lib/training-schedule";

/**
 * Priorité Supabase dès qu'un compte élève réel est identifié (même
 * principe que /profil et /dashboard) : les programmes assignés réels
 * (table `assignments`, voir lib/supabase/programs.ts) remplacent alors
 * entièrement data/student.ts, y compris pour afficher "Aucun programme
 * attribué" plutôt qu'un programme mock qui ferait croire à un vrai suivi.
 */
export default function EntrainementPage() {
  const supabaseTraining = useSupabaseTrainingProgram();

  if (!supabaseTraining.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseTraining.active) {
    const { programs, activeProgram: realActiveProgram, student } = supabaseTraining;

    if (!realActiveProgram) {
      return (
        <div>
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              Entraînement
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Aucun programme attribué pour le moment. Contacte ton coach.
          </p>
        </div>
      );
    }

    const weekNumber = computeCurrentWeekNumber(realActiveProgram, student);
    const eleveActiveProgram = toEleveTrainingProgram(realActiveProgram, weekNumber);
    const weekSessions = realActiveProgram.sessions
      .filter((s) => s.weekNumber === weekNumber)
      .map(toEleveWorkoutSession);
    const highlightedDay = getHighlightedScheduleDay(eleveActiveProgram.schedule);
    const highlightedSession = highlightedDay?.sessionId
      ? weekSessions.find((s) => s.id === highlightedDay.sessionId)
      : undefined;

    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Entraînement
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Programme actif : {eleveActiveProgram.name} · Semaine {eleveActiveProgram.currentWeek} /{" "}
            {eleveActiveProgram.durationWeeks}
          </p>
        </div>

        {highlightedSession && highlightedDay && (
          <div className="mb-8">
            <NextSessionHighlight
              session={highlightedSession}
              dayLabel={highlightedDay.isToday ? "Aujourd'hui" : highlightedDay.day}
            />
          </div>
        )}

        <div>
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Mes programmes
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {programs.map((program) => (
              <TrainingProgramCard
                key={program.id}
                program={toEleveTrainingProgram(
                  program,
                  computeCurrentWeekNumber(program, student),
                )}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const highlightedDay = getHighlightedScheduleDay(activeProgram.schedule);
  const highlightedSession = highlightedDay?.sessionId
    ? getWorkoutSession(highlightedDay.sessionId)
    : undefined;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Entraînement
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Programme actif : {activeProgram.name} · Semaine{" "}
          {activeProgram.currentWeek} / {activeProgram.durationWeeks}
        </p>
      </div>

      {highlightedSession && highlightedDay && (
        <div className="mb-8">
          <NextSessionHighlight
            session={highlightedSession}
            dayLabel={highlightedDay.isToday ? "Aujourd'hui" : highlightedDay.day}
          />
        </div>
      )}

      <div>
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Mes programmes
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {trainingPrograms.map((program) => (
            <TrainingProgramCard key={program.id} program={program} />
          ))}
        </div>
      </div>
    </div>
  );
}
