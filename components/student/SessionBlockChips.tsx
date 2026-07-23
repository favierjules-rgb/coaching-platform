import { Activity, Dumbbell } from "lucide-react";

import { BLOCK_COLOR_STYLES, blockCategoryLabel, blockDisplayTitle } from "@/components/admin/blocks/block-view-model";
import { summarizeBlock } from "@/lib/session-summary";
import { normalizeColorKey } from "@/lib/training-block-editing";
import type { TrainingBlock } from "@/types";

/**
 * Pastilles COMPACTES des blocs d'une séance, dans leur ordre réel, pour les
 * cartes élève. Source = `blocks[]` (jamais exercises[]/cardioBlocks[]). La
 * catégorie n'est PAS transmise par la seule couleur : chaque pastille porte un
 * point coloré + une icône + le libellé « Musculation »/« Cardio ».
 */
export function SessionBlockChips({ blocks, max = 3 }: { blocks: readonly TrainingBlock[]; max?: number }) {
  if (blocks.length === 0) return null;
  const shown = blocks.slice(0, max);
  const overflow = blocks.length - shown.length;

  return (
    <ul className="flex flex-col gap-1.5">
      {shown.map((block) => {
        const color = BLOCK_COLOR_STYLES[normalizeColorKey(block.colorKey, block.category === "cardio" ? "blue" : "gray")];
        const Icon = block.category === "strength" ? Dumbbell : Activity;
        return (
          <li
            key={block.id}
            className={`flex items-center gap-2 rounded-lg border border-border border-l-2 ${color.borderLeft} ${color.softBg} px-2 py-1.5`}
          >
            <span className={`h-2 w-2 flex-shrink-0 rounded-full ${color.dot}`} aria-hidden="true" />
            <Icon size={13} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium leading-tight text-foreground">{blockDisplayTitle(block)}</span>
              <span className="block truncate text-[10px] leading-tight text-muted-foreground">
                {blockCategoryLabel(block.category)} · {summarizeBlock(block)}
              </span>
            </span>
          </li>
        );
      })}
      {overflow > 0 && (
        <li className="pl-1 text-[10px] text-muted-foreground">
          +{overflow} bloc{overflow > 1 ? "s" : ""}
        </li>
      )}
    </ul>
  );
}
