import Link from "next/link";
import { ArrowRight, Dumbbell } from "lucide-react";

import type { WorkoutSession } from "@/types";

export function NextSessionHighlight({
  session,
  dayLabel,
}: {
  session: WorkoutSession;
  dayLabel: string;
}) {
  // Séances cardio (V3) : même convention que ProgramWeekCalendar (voir
  // components/student/ProgramWeekCalendar.tsx) — "X exercices" n'a pas de
  // sens pour une séance 100% cardio.
  const sessionType = session.sessionType ?? "strength";
  const cardioBlocksCount = (session.cardioBlocks ?? []).length;

  return (
    <div className="border border-primary bg-primary/10 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Prochaine séance
        </h2>
        <span className="font-heading text-xs uppercase tracking-widest text-primary">
          {dayLabel}
        </span>
      </div>

      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center bg-primary">
          <Dumbbell size={20} className="text-primary-foreground" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">
            {session.name}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {session.durationMinutes} min
            {sessionType !== "cardio" ? ` · ${session.exercises.length} exercices` : ""}
            {sessionType !== "strength"
              ? ` · ${cardioBlocksCount} bloc${cardioBlocksCount > 1 ? "s" : ""} cardio`
              : ""}
          </div>
        </div>
      </div>

      <Link
        href={`/entrainement/seance/${session.id}`}
        className="flex w-full items-center justify-center gap-2 border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        Voir la séance <ArrowRight size={14} />
      </Link>
    </div>
  );
}
