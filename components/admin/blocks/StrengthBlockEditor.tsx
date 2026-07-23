"use client";

import { Copy, Plus } from "lucide-react";

import { ExerciseRow, exerciseFromLibrary } from "@/components/admin/ProgramBuilder";
import { ExerciseSearchPicker } from "@/components/admin/ExerciseSearchPicker";
import type { AdminExercise, ExerciseLibraryItem, StrengthTrainingBlock } from "@/types";

/**
 * Éditeur d'un bloc strength (Lot 4.2). Édite EXCLUSIVEMENT `block.exercises` :
 * ne lit jamais `session.exercises`. Réutilise `ExerciseRow` (aucune
 * réécriture de l'éditeur d'exercice) et `ExerciseSearchPicker`. Émet des
 * intentions identifiées par l'id de l'exercice ; le conteneur applique les
 * helpers purs du Lot 4.1.
 *
 * Le drag des exercices arrive au Lot 4.3 : les poignées de `ExerciseRow`
 * reçoivent ici des handlers inertes, seuls Monter/Descendre sont actifs.
 */
export function StrengthBlockEditor({
  block,
  library,
  otherStrengthBlocks,
  onAddBlank,
  onAddFromLibrary,
  onExerciseChange,
  onExerciseRemove,
  onExerciseMove,
  onExerciseDuplicate,
  onMoveExerciseToBlock,
}: {
  block: StrengthTrainingBlock;
  library: ExerciseLibraryItem[];
  /** Autres blocs strength de la séance (pour « Déplacer vers »). */
  otherStrengthBlocks: { id: string; label: string }[];
  onAddBlank: () => void;
  onAddFromLibrary: (fields: Partial<AdminExercise>) => void;
  onExerciseChange: (exerciseId: string, partial: Partial<AdminExercise>) => void;
  onExerciseRemove: (exerciseId: string) => void;
  onExerciseMove: (exerciseId: string, direction: "up" | "down") => void;
  onExerciseDuplicate: (exerciseId: string) => void;
  onMoveExerciseToBlock: (exerciseId: string, targetBlockId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <ExerciseSearchPicker library={library} onPick={(item) => onAddFromLibrary(exerciseFromLibrary(0, item))} />

      {block.exercises.map((exercise, index) => (
        <div key={exercise.id} className="flex flex-col gap-1">
          <ExerciseRow
            // Numéro d'affichage 1-based pour l'humain, sans toucher au modèle.
            exercise={{ ...exercise, order: index + 1 }}
            onChange={(partial) => onExerciseChange(exercise.id, partial)}
            onRemove={() => onExerciseRemove(exercise.id)}
            onMove={(direction) => onExerciseMove(exercise.id, direction)}
            isFirst={index === 0}
            isLast={index === block.exercises.length - 1}
            // Drag reporté au Lot 4.3 : handlers inertes.
            onDragStart={() => {}}
            onDragOver={() => {}}
            onDrop={() => {}}
          />
          <div className="flex flex-wrap items-center gap-3 px-1">
            <button
              type="button"
              onClick={() => onExerciseDuplicate(exercise.id)}
              className="inline-flex min-h-11 items-center gap-1 px-1 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors duration-150 ease-out hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Copy size={12} />
              Dupliquer l&apos;exercice
            </button>
            {otherStrengthBlocks.length > 0 && (
              <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
                Déplacer vers
                <select
                  value=""
                  onChange={(event) => {
                    if (event.target.value) onMoveExerciseToBlock(exercise.id, event.target.value);
                  }}
                  aria-label={`Déplacer l'exercice ${exercise.name || "(sans nom)"} vers un autre bloc`}
                  className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] normal-case tracking-normal text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  <option value="">Choisir…</option>
                  {otherStrengthBlocks.map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={onAddBlank}
        className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors duration-150 ease-out hover:border-primary hover:text-primary active:scale-[0.99]"
      >
        <Plus size={14} />
        Ajouter un exercice vierge
      </button>
    </div>
  );
}
