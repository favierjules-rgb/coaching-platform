import { PlayCircle } from "lucide-react";

import type { Exercise, ExerciseFeedback } from "@/types";

const rpeOptions = Array.from({ length: 10 }, (_, index) => index + 1);

interface ExerciseFeedbackCardProps {
  exercise: Exercise;
  index: number;
  feedback: ExerciseFeedback;
  onSetChange: (
    setNumber: number,
    field: "loadUsed" | "repsDone",
    value: string,
  ) => void;
  onRpeChange: (value: string) => void;
  onCommentChange: (value: string) => void;
}

export function ExerciseFeedbackCard({
  exercise,
  index,
  feedback,
  onSetChange,
  onRpeChange,
  onCommentChange,
}: ExerciseFeedbackCardProps) {
  return (
    <div className="border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-heading text-xs font-semibold text-primary">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="text-sm font-medium text-foreground">{exercise.name}</h3>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>{exercise.sets} séries</span>
          <span>{exercise.reps} reps</span>
          <span>{exercise.restSeconds}s repos</span>
          <span>Tempo {exercise.tempo}</span>
          <span>Charge conseillée : {exercise.recommendedLoad}</span>
        </div>
        {exercise.videoUrl.trim() ? (
          <a
            href={exercise.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <PlayCircle size={16} />
            Voir la démo
          </a>
        ) : (
          <span
            title="Aucune vidéo disponible"
            className="flex cursor-not-allowed items-center gap-2 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground/40"
          >
            <PlayCircle size={16} />
            Aucune vidéo disponible
          </span>
        )}
      </div>

      <div className="border-t border-border pt-4">
        <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-primary">
          Retour élève
        </span>

        <div className="mb-4 flex flex-col gap-2">
          {feedback.sets.map((set) => (
            <div
              key={set.setNumber}
              className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[100px_1fr_1fr]"
            >
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Série {set.setNumber}
              </span>
              <input
                value={set.loadUsed}
                onChange={(event) =>
                  onSetChange(set.setNumber, "loadUsed", event.target.value)
                }
                placeholder={`Charge (${exercise.recommendedLoad})`}
                className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
              />
              <input
                value={set.repsDone}
                onChange={(event) =>
                  onSetChange(set.setNumber, "repsDone", event.target.value)
                }
                placeholder={`Reps (${exercise.reps})`}
                className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[160px_1fr]">
          <select
            value={feedback.rpe ?? ""}
            onChange={(event) => onRpeChange(event.target.value)}
            className="w-full appearance-none border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          >
            <option value="">RPE exercice</option>
            {rpeOptions.map((value) => (
              <option key={value} value={value}>
                {value} / 10
              </option>
            ))}
          </select>
          <input
            value={feedback.comment}
            onChange={(event) => onCommentChange(event.target.value)}
            placeholder="Commentaire exercice (optionnel)"
            className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          />
        </div>
      </div>
    </div>
  );
}
