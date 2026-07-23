"use client";

import { useRef, useState, type DragEvent } from "react";
import { Moon } from "lucide-react";

import {
  addStrengthExercise,
  addTrainingBlock,
  duplicateStrengthExercise,
  duplicateTrainingBlock,
  getBlockDropPlacement,
  moveExerciseBetweenStrengthBlocks,
  moveStrengthExercise,
  moveTrainingBlock,
  removeStrengthExercise,
  removeTrainingBlock,
  reorderTrainingBlocksById,
  replaceTrainingBlock,
  updateBlockColor,
  updateBlockTitle,
  updateStrengthExercise,
  type BlockColorKey,
  type BuilderWorkoutSession,
} from "@/lib/training-block-editing";
import type { AdminExercise, CardioTrainingBlock, ExerciseLibraryItem, StrengthTrainingBlock, TrainingBlockCategory } from "@/types";
import { AddTrainingBlockMenu } from "@/components/admin/blocks/AddTrainingBlockMenu";
import { TrainingBlockCard } from "@/components/admin/blocks/TrainingBlockCard";
import {
  blockDisplayTitle,
  blockOrderLabel,
  describeBlockMove,
  describeBlockMoveBlocked,
  describeExerciseMovedToBlock,
  describeExerciseReorder,
  dropIndicatorPlacement,
} from "@/components/admin/blocks/block-view-model";

/**
 * Pile ordonnée des blocs (Lot 4.2 + drag Lot 4.3). SEUL point d'application des
 * helpers PURS : chaque intention (drag, Monter/Descendre, édition) est traduite
 * en appel immuable puis remontée via `onSessionChange`. Lit uniquement
 * `session.blocks`. Le drag manipule les blocs par `block.id` ; la liste ne
 * change qu'au drop ; les positions sont renormalisées 0..n-1.
 */
export function SessionBlockList({
  session,
  library,
  onSessionChange,
}: {
  session: BuilderWorkoutSession;
  library: ExerciseLibraryItem[];
  onSessionChange: (next: BuilderWorkoutSession) => void;
}) {
  const [focusBlockId, setFocusBlockId] = useState<string | null>(null);
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ blockId: string; placement: "before" | "after" } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusRequest, setFocusRequest] = useState<{ blockId: string; direction: "up" | "down"; nonce: number } | null>(null);
  const nonceRef = useRef(0);
  const blocks = session.blocks;

  function clearDrag() {
    setDraggedBlockId(null);
    setDragOver(null);
  }

  function handleAdd(category: TrainingBlockCategory) {
    const { session: next, blockId } = addTrainingBlock(session, category);
    onSessionChange(next);
    setFocusBlockId(blockId);
  }

  function handleMove(blockId: string, direction: "up" | "down") {
    const index = blocks.findIndex((b) => b.id === blockId);
    const canUp = index > 0;
    const canDown = index >= 0 && index < blocks.length - 1;
    if ((direction === "up" && !canUp) || (direction === "down" && !canDown)) {
      setAnnouncement(describeBlockMoveBlocked(direction));
      return;
    }
    const next = moveTrainingBlock(session, blockId, direction);
    onSessionChange(next);
    const newIndex = next.blocks.findIndex((b) => b.id === blockId);
    if (newIndex >= 0) setAnnouncement(describeBlockMove(next.blocks[newIndex], newIndex, next.blocks.length));
    nonceRef.current += 1;
    setFocusRequest({ blockId, direction, nonce: nonceRef.current });
  }

  function handleDrop(targetBlockId: string, event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (draggedBlockId && dragOver) {
      const next = reorderTrainingBlocksById(session, draggedBlockId, targetBlockId, dragOver.placement);
      if (next !== session) {
        onSessionChange(next);
        const newIndex = next.blocks.findIndex((b) => b.id === draggedBlockId);
        if (newIndex >= 0) setAnnouncement(describeBlockMove(next.blocks[newIndex], newIndex, next.blocks.length));
      }
    }
    clearDrag();
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Zone d'annonces accessibles — visuellement masquée, annonce après action terminée. */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </div>

      {blocks.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted-foreground">
          <Moon size={18} aria-hidden="true" />
          <p>Journée de repos — aucun bloc. Ajoute un bloc pour créer une séance.</p>
        </div>
      ) : (
        blocks.map((block, index) => {
          const otherStrengthBlocks = blocks
            .filter((candidate) => candidate.category === "strength" && candidate.id !== block.id)
            .map((candidate) => ({
              id: candidate.id,
              label: `${blockOrderLabel(blocks.indexOf(candidate))} · ${blockDisplayTitle(candidate)}`,
            }));

          return (
            <TrainingBlockCard
              key={block.id}
              block={block}
              displayIndex={index}
              blockCount={blocks.length}
              library={library}
              otherStrengthBlocks={otherStrengthBlocks}
              autoFocus={block.id === focusBlockId}
              isDragged={draggedBlockId === block.id}
              dropIndicator={dropIndicatorPlacement(block.id, dragOver?.blockId ?? null, dragOver?.placement ?? null)}
              focusRequest={focusRequest?.blockId === block.id ? { direction: focusRequest.direction, nonce: focusRequest.nonce } : null}
              onDragStart={() => setDraggedBlockId(block.id)}
              onDragOver={(event) => {
                if (!draggedBlockId || draggedBlockId === block.id) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const placement = getBlockDropPlacement(event.clientY, rect.top, rect.height);
                setDragOver((prev) => (prev?.blockId === block.id && prev.placement === placement ? prev : { blockId: block.id, placement }));
              }}
              onDrop={(event) => handleDrop(block.id, event)}
              onDragEnd={clearDrag}
              onMove={(direction) => handleMove(block.id, direction)}
              onDuplicate={() => {
                const { session: next, blockId } = duplicateTrainingBlock(session, block.id);
                onSessionChange(next);
                if (blockId) setFocusBlockId(blockId);
              }}
              onRemove={() => onSessionChange(removeTrainingBlock(session, block.id))}
              onTitleChange={(title) => onSessionChange(updateBlockTitle(session, block.id, title))}
              onColorChange={(color: BlockColorKey) => onSessionChange(updateBlockColor(session, block.id, color))}
              onAddBlank={() => {
                const { session: next } = addStrengthExercise(session, block.id);
                onSessionChange(next);
              }}
              onAddFromLibrary={(fields: Partial<AdminExercise>) => {
                const { session: next } = addStrengthExercise(session, block.id, { fields });
                onSessionChange(next);
              }}
              onExerciseChange={(exerciseId, partial) => onSessionChange(updateStrengthExercise(session, block.id, exerciseId, partial))}
              onExerciseRemove={(exerciseId) => onSessionChange(removeStrengthExercise(session, block.id, exerciseId))}
              onExerciseMove={(exerciseId, direction) => {
                const next = moveStrengthExercise(session, block.id, exerciseId, direction);
                onSessionChange(next);
                const updated = next.blocks.find((b) => b.id === block.id);
                if (updated && updated.category === "strength") {
                  const idx = updated.exercises.findIndex((e) => e.id === exerciseId);
                  if (idx >= 0) setAnnouncement(describeExerciseReorder(updated.exercises[idx].name, idx, updated.exercises.length));
                }
              }}
              onExerciseDuplicate={(exerciseId) => {
                const { session: next } = duplicateStrengthExercise(session, block.id, exerciseId);
                onSessionChange(next);
              }}
              onMoveExerciseToBlock={(exerciseId, targetBlockId) => {
                const sourceBlock = session.blocks.find((b) => b.id === block.id) as StrengthTrainingBlock | undefined;
                const exerciseName = sourceBlock?.exercises.find((e) => e.id === exerciseId)?.name ?? "";
                const next = moveExerciseBetweenStrengthBlocks(session, block.id, targetBlockId, exerciseId);
                onSessionChange(next);
                const targetBlock = next.blocks.find((b) => b.id === targetBlockId);
                if (targetBlock) setAnnouncement(describeExerciseMovedToBlock(exerciseName, targetBlock));
              }}
              onCardioChange={(next: CardioTrainingBlock) => onSessionChange(replaceTrainingBlock(session, block.id, next))}
            />
          );
        })
      )}

      <AddTrainingBlockMenu onAdd={handleAdd} />
    </div>
  );
}
