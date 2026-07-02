import { Dumbbell } from "lucide-react";

import { TrainingProgramCard } from "@/components/student/TrainingProgramCard";
import { TrainingWeekOverview } from "@/components/student/TrainingWeekOverview";
import {
  activeProgram,
  trainingPrograms,
  upcomingSession,
  weekTrainingSchedule,
} from "@/data/student";

export default function EntrainementPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Entraînement
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Programme actif : {activeProgram.name} · Semaine en cours
        </p>
      </div>

      <div className="mb-6 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Aperçu de la semaine
        </h2>
        <TrainingWeekOverview days={weekTrainingSchedule} />
      </div>

      <div className="mb-8 border border-primary bg-primary/10 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Prochaine séance
          </h2>
          <span className="font-heading text-xs uppercase tracking-widest text-primary">
            {upcomingSession.day}
          </span>
        </div>
        <div className="mb-4 flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center bg-primary">
            <Dumbbell size={20} className="text-primary-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">
              {upcomingSession.name}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {upcomingSession.time} · {upcomingSession.durationMinutes} min ·{" "}
              {upcomingSession.exerciseCount} exercices
            </div>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="w-full cursor-not-allowed border border-border py-3 text-center text-xs uppercase tracking-widest text-muted-foreground"
        >
          Détail de la séance — bientôt disponible
        </button>
      </div>

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
