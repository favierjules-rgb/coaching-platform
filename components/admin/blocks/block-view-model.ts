import type { BlockColorKey } from "@/lib/training-block-editing";
import { BLOCK_COLOR_KEYS } from "@/lib/training-block-editing";
import type { TrainingBlock, TrainingBlockCategory } from "@/types";

/**
 * View-model PUR des cartes de blocs (chantier multi-blocs, Lot 4.2). Aucune
 * dépendance React : uniquement des tables statiques et des helpers de libellé,
 * pour être réutilisés par les composants ET testés hors rendu.
 */

/**
 * Styles d'accent par `colorKey`, TABLE STATIQUE EXHAUSTIVE (une clé par couleur
 * autorisée). Les classes sont des littéraux COMPLETS : jamais construites
 * dynamiquement (`bg-${color}-500`), afin que le moteur Tailwind les détecte de
 * façon fiable. Accents DISCRETS (pastille + fine bordure latérale + fond très
 * léger) — jamais de remplissage fortement coloré, cohérent avec l'identité
 * monochrome du projet.
 */
export const BLOCK_COLOR_STYLES: Record<BlockColorKey, { dot: string; borderLeft: string; softBg: string; label: string }> = {
  gray: { dot: "bg-neutral-400", borderLeft: "border-l-neutral-400/70", softBg: "bg-neutral-400/5", label: "Gris" },
  red: { dot: "bg-red-500", borderLeft: "border-l-red-500/70", softBg: "bg-red-500/5", label: "Rouge" },
  orange: { dot: "bg-orange-500", borderLeft: "border-l-orange-500/70", softBg: "bg-orange-500/5", label: "Orange" },
  yellow: { dot: "bg-yellow-500", borderLeft: "border-l-yellow-500/70", softBg: "bg-yellow-500/5", label: "Jaune" },
  green: { dot: "bg-green-500", borderLeft: "border-l-green-500/70", softBg: "bg-green-500/5", label: "Vert" },
  blue: { dot: "bg-blue-500", borderLeft: "border-l-blue-500/70", softBg: "bg-blue-500/5", label: "Bleu" },
  purple: { dot: "bg-purple-500", borderLeft: "border-l-purple-500/70", softBg: "bg-purple-500/5", label: "Violet" },
};

/** Libellé humain d'une couleur (pour le sélecteur accessible). */
export function blockColorLabel(colorKey: BlockColorKey): string {
  return BLOCK_COLOR_STYLES[colorKey].label;
}

/** Ordre stable des couleurs pour le sélecteur (miroir de l'enum). */
export const BLOCK_COLOR_ORDER: readonly BlockColorKey[] = BLOCK_COLOR_KEYS;

/** Libellé de catégorie — INDÉPENDANT de la couleur (la catégorie reste lisible sans couleur). */
export function blockCategoryLabel(category: TrainingBlockCategory): string {
  return category === "strength" ? "Musculation" : "Cardio";
}

/** Numéro d'ordre affiché (01, 02, 03…) — dérivé de l'index d'affichage, jamais de `position` comme index. */
export function blockOrderLabel(displayIndex: number): string {
  return String(displayIndex + 1).padStart(2, "0");
}

/** Titre affiché d'un bloc, avec repli explicite si le titre est vide (jamais un libellé vide). */
export function blockDisplayTitle(block: TrainingBlock): string {
  const title = block.title?.trim();
  if (title) return title;
  return block.category === "strength" ? "Bloc musculation" : "Bloc cardio";
}

export type BlockAction = "move-up" | "move-down" | "duplicate" | "delete" | "color" | "toggle";

/**
 * `aria-label` contextualisé d'une action de bloc, TOUJOURS avec le titre du
 * bloc (ou son repli) — jamais un libellé vide. Ex. « Monter le bloc Running ».
 */
export function blockActionAriaLabel(action: BlockAction, block: TrainingBlock): string {
  const name = blockDisplayTitle(block);
  switch (action) {
    case "move-up":
      return `Monter le bloc ${name}`;
    case "move-down":
      return `Descendre le bloc ${name}`;
    case "duplicate":
      return `Dupliquer le bloc ${name}`;
    case "delete":
      return `Supprimer le bloc ${name}`;
    case "color":
      return `Changer la couleur du bloc ${name}`;
    case "toggle":
      return `Déplier ou replier le bloc ${name}`;
  }
}

/** Monter est possible sauf pour le premier bloc. */
export function canMoveBlockUp(displayIndex: number): boolean {
  return displayIndex > 0;
}

/** Descendre est possible sauf pour le dernier bloc. */
export function canMoveBlockDown(displayIndex: number, blockCount: number): boolean {
  return displayIndex < blockCount - 1;
}

/** Un bloc est « vide » (suppression directe autorisée, sans confirmation) s'il n'a aucun contenu. */
export function isBlockEmpty(block: TrainingBlock): boolean {
  return block.category === "strength" ? block.exercises.length === 0 : block.prescriptions.length === 0;
}

/* ───────────────────── Drag & annonces accessibles (Lot 4.3) ──────────── */

/** `aria-label` de la POIGNÉE de drag — contextualisé, jamais vide. Ex. « Réordonner le bloc Running ». */
export function dragHandleAriaLabel(block: TrainingBlock): string {
  return `Réordonner le bloc ${blockDisplayTitle(block)}`;
}

/**
 * Placement de l'INDICATEUR de drop pour un bloc donné : `before` / `after` si
 * ce bloc est la cible survolée, sinon `null` (aucun indicateur hors drag).
 */
export function dropIndicatorPlacement(
  blockId: string,
  dragOverBlockId: string | null,
  placement: "before" | "after" | null,
): "before" | "after" | null {
  return dragOverBlockId === blockId ? placement : null;
}

/** Annonce accessible après un déplacement de bloc terminé (position 1-based sur total). */
export function describeBlockMove(block: TrainingBlock, displayIndex: number, total: number): string {
  return `Bloc ${blockDisplayTitle(block)} déplacé en position ${displayIndex + 1} sur ${total}.`;
}

/** Annonce accessible quand un déplacement de bloc est impossible (borne). */
export function describeBlockMoveBlocked(direction: "up" | "down"): string {
  return direction === "up" ? "Impossible de monter le premier bloc." : "Impossible de descendre le dernier bloc.";
}

/** Annonce accessible après un réordonnancement d'exercice dans son bloc. */
export function describeExerciseReorder(exerciseName: string, displayIndex: number, total: number): string {
  const label = exerciseName.trim() || "(sans nom)";
  return `Exercice ${label} déplacé en position ${displayIndex + 1} sur ${total}.`;
}

/** Annonce accessible après un déplacement d'exercice vers un autre bloc. */
export function describeExerciseMovedToBlock(exerciseName: string, targetBlock: TrainingBlock): string {
  const label = exerciseName.trim() || "(sans nom)";
  return `Exercice ${label} déplacé vers le bloc ${blockDisplayTitle(targetBlock)}.`;
}
