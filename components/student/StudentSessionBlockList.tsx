import { Fragment, type ReactNode } from "react";

import { StudentCardioBlockCard } from "@/components/student/StudentCardioBlockCard";
import { StudentStrengthBlockCard } from "@/components/student/StudentStrengthBlockCard";
import type { StudentSessionBlockView } from "@/lib/student-session-blocks";
import type { Exercise } from "@/types";

/**
 * Rend la SEULE liste ordonnée de blocs d'une séance élève. Les blocs sont
 * déjà normalisés/triés par `orderedStudentSessionBlocks` (helper pur) — ce
 * composant ne trie rien, il rend chaque bloc à sa position. Les exercices
 * d'un bloc strength sont rendus via `renderStrengthExercise` (le formulaire
 * de retour reste piloté par SessionFeedbackSection, qui possède l'état), avec
 * un index global stable pour la numérotation.
 */
export function StudentSessionBlockList({
  blocks,
  renderStrengthExercise,
}: {
  blocks: StudentSessionBlockView[];
  renderStrengthExercise: (exercise: Exercise, globalIndex: number) => ReactNode;
}) {
  // Décalage d'index (nombre d'exercices strength avant chaque bloc) —
  // précalculé pour éviter toute mutation pendant le rendu.
  const strengthOffsets: number[] = [];
  let seen = 0;
  for (const block of blocks) {
    strengthOffsets.push(seen);
    if (block.kind === "strength") seen += block.exercises.length;
  }

  return (
    <div className="flex flex-col gap-6">
      {blocks.map((block, blockIndex) =>
        block.kind === "strength" ? (
          <StudentStrengthBlockCard key={block.id} colorKey={block.colorKey} title={block.title}>
            {block.exercises.map((exercise, exerciseIndex) => (
              <Fragment key={exercise.id}>
                {renderStrengthExercise(exercise, strengthOffsets[blockIndex] + exerciseIndex)}
              </Fragment>
            ))}
          </StudentStrengthBlockCard>
        ) : (
          <StudentCardioBlockCard key={block.id} block={block} />
        ),
      )}
    </div>
  );
}
