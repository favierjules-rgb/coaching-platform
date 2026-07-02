import { TrainingProgramCard } from "@/components/student/TrainingProgramCard";
import { NextSessionHighlight } from "@/components/student/NextSessionHighlight";
import {
  activeProgram,
  getHighlightedScheduleDay,
  getWorkoutSession,
  trainingPrograms,
} from "@/data/student";

export default function EntrainementPage() {
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
