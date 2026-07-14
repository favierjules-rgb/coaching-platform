import { Clock, Repeat } from "lucide-react";

import { blockTypeLabels } from "@/components/admin/BlockEditor";
import type { AdminTrainingBlock } from "@/types";

/**
 * Affichage informationnel des blocs d'une séance côté élève (chantier
 * training-builder-v2) : structure (superset A1/A2/A3, tours, repos, durée
 * EMOM...), pas la saisie de performance — celle-ci reste gérée par
 * SessionFeedbackSection (liste plate, inchangée) juste en dessous. Un bloc
 * "standard" synthétisé (séance legacy, voir lib/supabase/programs.ts)
 * n'est jamais affiché ici : sa liste d'exercices est déjà couverte par la
 * section de feedback qui suit, l'afficher deux fois créerait une
 * redondance confuse. Le minuteur d'exécution en direct (tour/minute
 * actuels) est reporté en phase 2.
 */
export function BlockAwareSessionBlocks({ blocks }: { blocks: AdminTrainingBlock[] }) {
  const structuredBlocks = blocks.filter((b) => !b.isSynthesizedStandard);
  if (structuredBlocks.length === 0) {
    return null;
  }

  return (
    <div className="mb-8 flex flex-col gap-4">
      {structuredBlocks.map((block) => (
        <div key={block.id} className="border border-border bg-card p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="border border-primary/40 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary">
                {blockTypeLabels[block.blockType]}
              </span>
              {block.title && <h3 className="font-heading text-sm font-bold uppercase text-foreground">{block.title}</h3>}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              {block.rounds !== null && (
                <span className="flex items-center gap-1">
                  <Repeat size={12} />
                  {block.rounds} tour{block.rounds > 1 ? "s" : ""}
                </span>
              )}
              {block.emomMinutes !== null && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  {block.emomMinutes} min (EMOM)
                </span>
              )}
              {block.timeCapSeconds !== null && (
                <span className="flex items-center gap-1">
                  <Clock size={12} />
                  Time cap {Math.round(block.timeCapSeconds / 60)} min
                </span>
              )}
            </div>
          </div>

          {block.description && <p className="mb-3 text-sm text-muted-foreground">{block.description}</p>}

          <ul className="flex flex-col gap-1.5">
            {block.exercises.map((exercise) => (
              <li key={exercise.id} className="flex items-center gap-2 text-sm text-foreground">
                {exercise.supersetLabel && (
                  <span className="border border-border px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">
                    {exercise.supersetLabel}
                  </span>
                )}
                <span>{exercise.name || "Exercice sans nom"}</span>
                <span className="text-xs text-muted-foreground">
                  {exercise.sets} × {exercise.reps}
                </span>
              </li>
            ))}
          </ul>

          {(block.restSeconds !== null || block.restBetweenRoundsSeconds !== null) && (
            <p className="mt-3 text-xs text-muted-foreground">
              {block.restSeconds !== null && <>Repos entre exercices : {block.restSeconds}s. </>}
              {block.restBetweenRoundsSeconds !== null && <>Repos après chaque tour : {block.restBetweenRoundsSeconds}s.</>}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
