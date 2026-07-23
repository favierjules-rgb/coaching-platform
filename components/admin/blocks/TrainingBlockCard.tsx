"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Activity, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Dumbbell, GripVertical, Trash2 } from "lucide-react";

import type { BlockColorKey } from "@/lib/training-block-editing";
import { normalizeColorKey } from "@/lib/training-block-editing";
import type { AdminExercise, CardioTrainingBlock, ExerciseLibraryItem, TrainingBlock } from "@/types";
import { BlockColorPicker } from "@/components/admin/blocks/BlockColorPicker";
import { CardioBlockEditor } from "@/components/admin/blocks/CardioBlockEditor";
import { StrengthBlockEditor } from "@/components/admin/blocks/StrengthBlockEditor";
import {
  BLOCK_COLOR_STYLES,
  blockActionAriaLabel,
  blockCategoryLabel,
  blockDisplayTitle,
  blockOrderLabel,
  canMoveBlockDown,
  canMoveBlockUp,
  dragHandleAriaLabel,
  isBlockEmpty,
} from "@/components/admin/blocks/block-view-model";

export interface TrainingBlockCardProps {
  block: TrainingBlock;
  displayIndex: number;
  blockCount: number;
  library: ExerciseLibraryItem[];
  otherStrengthBlocks: { id: string; label: string }[];
  autoFocus?: boolean;
  // Drag (Lot 4.3) — état/handlers fournis par SessionBlockList (déjà liés à block.id).
  isDragged: boolean;
  dropIndicator: "before" | "after" | null;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  // Demande de focus après un déplacement clavier (Monter/Descendre) — le `nonce`
  // garantit un déclenchement unique par déplacement.
  focusRequest: { direction: "up" | "down"; nonce: number } | null;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onTitleChange: (title: string | null) => void;
  onColorChange: (color: BlockColorKey) => void;
  onAddBlank: () => void;
  onAddFromLibrary: (fields: Partial<AdminExercise>) => void;
  onExerciseChange: (exerciseId: string, partial: Partial<AdminExercise>) => void;
  onExerciseRemove: (exerciseId: string) => void;
  onExerciseMove: (exerciseId: string, direction: "up" | "down") => void;
  onExerciseDuplicate: (exerciseId: string) => void;
  onMoveExerciseToBlock: (exerciseId: string, targetBlockId: string) => void;
  onCardioChange: (next: CardioTrainingBlock) => void;
}

export function TrainingBlockCard(props: TrainingBlockCardProps) {
  const { block, displayIndex, blockCount, autoFocus, isDragged, dropIndicator, focusRequest } = props;
  const [expanded, setExpanded] = useState(true);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const upRef = useRef<HTMLButtonElement>(null);
  const downRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (autoFocus) titleRef.current?.focus();
  }, [autoFocus]);

  // Après un déplacement clavier, garder le focus sur le bloc : le bouton de la
  // direction pressée s'il reste actif, sinon l'autre bouton actif (la `key`
  // du bloc étant stable, le composant n'est pas remonté).
  useEffect(() => {
    if (!focusRequest) return;
    const canUp = canMoveBlockUp(displayIndex);
    const canDown = canMoveBlockDown(displayIndex, blockCount);
    if (focusRequest.direction === "up" && canUp) upRef.current?.focus();
    else if (focusRequest.direction === "down" && canDown) downRef.current?.focus();
    else if (canUp) upRef.current?.focus();
    else if (canDown) downRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- déclenché une seule fois par déplacement via le nonce.
  }, [focusRequest?.nonce]);

  const colorKey = normalizeColorKey(block.colorKey, block.category === "cardio" ? "blue" : "gray");
  const color = BLOCK_COLOR_STYLES[colorKey];
  const isStrength = block.category === "strength";
  const CategoryIcon = isStrength ? Dumbbell : Activity;
  const contentId = `block-content-${block.id}`;
  // Zone tactile ~44px (Lot 4 dernière passe) sans grossir l'icône : min-h-11/min-w-11.
  const actionBtn =
    "inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-30";

  function handleDelete() {
    if (isBlockEmpty(block)) {
      props.onRemove();
      return;
    }
    setConfirmingDelete(true);
  }

  function handleDragStart(event: DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", block.id);
    // Image de drag = la carte entière (au lieu de la seule poignée).
    if (rootRef.current) event.dataTransfer.setDragImage(rootRef.current, 12, 12);
    props.onDragStart();
  }

  const draggedClasses = isDragged
    ? "opacity-60 border-border-strong shadow-lg motion-safe:scale-[0.99]"
    : "";

  return (
    <div>
      {/* Indicateur de drop — ligne + espacement (jamais couleur seule ; complété par aria-live). */}
      {dropIndicator === "before" && <div className="mb-1 h-0.5 rounded-full bg-primary" aria-hidden="true" />}

      <div
        ref={rootRef}
        onDragOver={props.onDragOver}
        onDrop={props.onDrop}
        onDragEnd={props.onDragEnd}
        className={`rounded-2xl border border-border border-l-2 ${color.borderLeft} ${color.softBg} transition duration-150 ease-out motion-reduce:transition-none ${draggedClasses}`}
      >
        {/* Ligne 1 — poignée de drag, numéro d'ordre, catégorie, titre éditable. */}
        <div className="flex items-center gap-2 px-2 pt-2">
          <button
            type="button"
            draggable
            onDragStart={handleDragStart}
            aria-label={dragHandleAriaLabel(block)}
            title="Glisser pour réordonner"
            className="inline-flex min-h-11 min-w-11 flex-shrink-0 cursor-grab items-center justify-center rounded-lg text-muted-foreground/70 transition-colors duration-150 ease-out hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:cursor-grabbing"
          >
            <GripVertical size={16} aria-hidden="true" />
          </button>
          <span className="flex-shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{blockOrderLabel(displayIndex)}</span>
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            <CategoryIcon size={12} aria-hidden="true" />
            {blockCategoryLabel(block.category)}
          </span>
          <input
            ref={titleRef}
            value={block.title ?? ""}
            onChange={(event) => props.onTitleChange(event.target.value ? event.target.value : null)}
            placeholder={blockDisplayTitle(block)}
            aria-label={`Titre du bloc ${blockOrderLabel(displayIndex)} (${blockCategoryLabel(block.category)})`}
            className="min-w-0 flex-1 rounded-lg bg-transparent px-2 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          />
        </div>

        {/* Ligne 2 — actions : zones tactiles ~40px, Monter/Descendre toujours visibles. */}
        <div className="flex flex-wrap items-center gap-0.5 px-2 pb-2">
          <BlockColorPicker value={colorKey} onChange={props.onColorChange} ariaLabel={blockActionAriaLabel("color", block)} />
          <button
            ref={upRef}
            type="button"
            onClick={() => props.onMove("up")}
            disabled={!canMoveBlockUp(displayIndex)}
            aria-label={blockActionAriaLabel("move-up", block)}
            className={actionBtn}
          >
            <ArrowUp size={16} />
          </button>
          <button
            ref={downRef}
            type="button"
            onClick={() => props.onMove("down")}
            disabled={!canMoveBlockDown(displayIndex, blockCount)}
            aria-label={blockActionAriaLabel("move-down", block)}
            className={actionBtn}
          >
            <ArrowDown size={16} />
          </button>
          <button type="button" onClick={props.onDuplicate} aria-label={blockActionAriaLabel("duplicate", block)} className={actionBtn}>
            <Copy size={16} />
          </button>
          <button
            type="button"
            onClick={handleDelete}
            aria-label={blockActionAriaLabel("delete", block)}
            className={`${actionBtn} text-red-400 hover:text-red-300`}
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={blockActionAriaLabel("toggle", block)}
            aria-expanded={expanded}
            aria-controls={contentId}
            className={`${actionBtn} ml-auto`}
          >
            {expanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        {confirmingDelete && (
          <div className="animate-fade-in flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
            <span>Supprimer ce bloc et son contenu ?</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false);
                  props.onRemove();
                }}
                className="font-bold uppercase tracking-widest text-red-400 transition-colors duration-150 ease-out hover:text-red-300"
              >
                Supprimer
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="uppercase tracking-widest transition-colors duration-150 ease-out hover:text-foreground"
              >
                Annuler
              </button>
            </div>
          </div>
        )}

        {expanded && (
          <div id={contentId} className="border-t border-border p-3">
            {block.category === "strength" ? (
              <StrengthBlockEditor
                block={block}
                library={props.library}
                otherStrengthBlocks={props.otherStrengthBlocks}
                onAddBlank={props.onAddBlank}
                onAddFromLibrary={props.onAddFromLibrary}
                onExerciseChange={props.onExerciseChange}
                onExerciseRemove={props.onExerciseRemove}
                onExerciseMove={props.onExerciseMove}
                onExerciseDuplicate={props.onExerciseDuplicate}
                onMoveExerciseToBlock={props.onMoveExerciseToBlock}
              />
            ) : (
              <CardioBlockEditor block={block} onChange={props.onCardioChange} />
            )}
          </div>
        )}
      </div>

      {dropIndicator === "after" && <div className="mt-1 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
    </div>
  );
}
