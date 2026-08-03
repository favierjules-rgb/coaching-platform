import { PlayCircle } from "lucide-react";

import {
  formatPreviousSetLabel,
  resolveSetPlaceholders,
  type PreviousExercisePerf,
} from "@/lib/previous-performance";
import type { Exercise, ExerciseFeedback } from "@/types";

interface ExerciseFeedbackCardProps {
  exercise: Exercise;
  index: number;
  feedback: ExerciseFeedback;
  /**
   * Dernière performance passée du même exercice
   * (feat/student-previous-set-performance) — repères VISUELS uniquement :
   * ligne « Dernières perfs » + placeholders. Jamais écrite dans l'état du
   * formulaire ni dans le payload. Optionnelle : null/absente = aucun repère.
   */
  previous?: PreviousExercisePerf | null;
  /**
   * Option B : le RPE se saisit PAR SÉRIE (champ `rpe` de chaque ligne).
   * L'ancien sélecteur RPE d'exercice a été retiré — le RPE global
   * historique n'est plus une saisie, seulement une mention honnête.
   */
  onSetChange: (
    setNumber: number,
    field: "loadUsed" | "repsDone" | "rpe",
    value: string,
  ) => void;
  onCommentChange: (value: string) => void;
}

export function ExerciseFeedbackCard({
  exercise,
  index,
  feedback,
  previous,
  onSetChange,
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

        {previous?.exerciseRpe != null && (
          // Ancien retour (pré-option B) : le RPE n'existait qu'au niveau de
          // l'exercice — affiché UNE fois, avec un libellé honnête, jamais
          // recopié dans les lignes ou placeholders de série.
          <p className="mb-3 text-[11px] leading-tight text-muted-foreground/70">
            Dernières perfs — RPE global de l&apos;exercice : {previous.exerciseRpe}
          </p>
        )}

        <div className="mb-4 flex flex-col gap-2">
          {feedback.sets.map((set) => {
            // Repères « Dernières perfs » : correspondance par INDEX de série
            // (ancienne série N → série actuelle N). Série sans historique →
            // aucune ligne. PRIORITÉ champ par champ dans le placeholder :
            // prescription du coach (libellé existant) sinon dernière perf,
            // sinon libellé vide — la saisie réelle (value) masque tout.
            const previousSet = previous?.sets[set.setNumber] ?? null;
            const previousLabel = formatPreviousSetLabel(previousSet);
            const placeholders = resolveSetPlaceholders(exercise, previousSet);
            return (
              <div key={set.setNumber} className="flex flex-col gap-1">
                {previousLabel && (
                  <span
                    aria-label={`Dernières performances série ${set.setNumber}`}
                    className="block text-[11px] leading-tight text-muted-foreground/70"
                  >
                    Dernières perfs : {previousLabel}
                  </span>
                )}
                <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[100px_1fr_1fr_88px]">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Série {set.setNumber}
                  </span>
                  <input
                    value={set.loadUsed}
                    onChange={(event) =>
                      onSetChange(set.setNumber, "loadUsed", event.target.value)
                    }
                    placeholder={placeholders.load}
                    className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                  />
                  <input
                    value={set.repsDone}
                    onChange={(event) =>
                      onSetChange(set.setNumber, "repsDone", event.target.value)
                    }
                    placeholder={placeholders.reps}
                    className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                  />
                  <input
                    value={set.rpe}
                    onChange={(event) =>
                      onSetChange(set.setNumber, "rpe", event.target.value)
                    }
                    inputMode="numeric"
                    aria-label={`RPE série ${set.setNumber} (1 à 10)`}
                    placeholder={placeholders.rpe}
                    className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none"
                  />
                </div>
              </div>
            );
          })}
        </div>

        <input
          value={feedback.comment}
          onChange={(event) => onCommentChange(event.target.value)}
          placeholder="Commentaire exercice (optionnel)"
          className="w-full border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
        />
      </div>
    </div>
  );
}
