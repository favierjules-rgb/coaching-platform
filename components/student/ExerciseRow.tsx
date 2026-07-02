import { PlayCircle } from "lucide-react";

import type { Exercise } from "@/types";

export function ExerciseRow({
  exercise,
  index,
}: {
  exercise: Exercise;
  index: number;
}) {
  return (
    <div className="flex flex-col gap-3 border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="mb-1 flex items-center gap-2">
          <span className="font-heading text-xs font-semibold text-primary">
            {String(index + 1).padStart(2, "0")}
          </span>
          <h3 className="text-sm font-medium text-foreground">
            {exercise.name}
          </h3>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{exercise.sets} séries</span>
          <span>{exercise.reps} reps</span>
          <span>{exercise.restSeconds}s repos</span>
          <span>Tempo {exercise.tempo}</span>
          <span>Charge : {exercise.recommendedLoad}</span>
        </div>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 self-start border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary sm:self-auto"
      >
        <PlayCircle size={16} />
        Voir la démo
      </button>
    </div>
  );
}
