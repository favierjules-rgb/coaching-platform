import { renumberBlockPositions, toOrderedBlocks } from "@/lib/training-blocks";
import { regenerateBlockIdsForDuplication, type IdFactory } from "@/lib/training-block-editing";
import type { AdminCardioBlock, AdminExercise, TrainingBlock } from "@/types";

/**
 * Contenu CANONIQUE d'un modèle de séance (dernière passe Lot 4) — stocké tel
 * quel dans le JSONB `session_templates.content`, SANS migration. Un modèle
 * canonique porte la source de vérité `blocks[]` (ordre libre, plusieurs blocs
 * strength/cardio), contrairement à l'ancienne forme plate
 * `exercises[]` + `cardioBlocks[]` incapable d'encoder un ordre multi-blocs.
 *
 * Le choix legacy vs canonique est TOUJOURS explicite (discriminant `format`),
 * jamais un repli `blocks ?? legacy`.
 */
export const CANONICAL_TEMPLATE_FORMAT = "canonical-blocks-v1" as const;

export interface CanonicalTemplateMetadata {
  name?: string;
  durationMinutes?: number | null;
  warmup?: string;
  coachNotes?: string;
  muscleGroup?: string;
}

export interface CanonicalSessionTemplateContent {
  format: typeof CANONICAL_TEMPLATE_FORMAT;
  metadata: CanonicalTemplateMetadata;
  blocks: TrainingBlock[];
}

/** Discriminant EXPLICITE : contenu canonique = `format` reconnu + `blocks[]`. */
export function isCanonicalTemplateContent(raw: unknown): raw is CanonicalSessionTemplateContent {
  return (
    !!raw &&
    typeof raw === "object" &&
    (raw as { format?: unknown }).format === CANONICAL_TEMPLATE_FORMAT &&
    Array.isArray((raw as { blocks?: unknown }).blocks)
  );
}

/**
 * Construit le contenu CANONIQUE d'un modèle depuis l'état du builder. Lit
 * EXCLUSIVEMENT `blocks[]` (jamais `exercises[]`/`cardioBlocks[]`), conserve
 * l'ordre (positions renormalisées 0..n-1), titres, couleurs, exercices et
 * prescriptions. Aucun feedback n'est stocké (le modèle client n'en porte pas).
 */
export function toCanonicalTemplateContent(source: {
  blocks: readonly TrainingBlock[];
  warmup: string;
  coachNotes: string;
  muscleGroup: string;
  durationMinutes: number;
  name?: string;
}): CanonicalSessionTemplateContent {
  return {
    format: CANONICAL_TEMPLATE_FORMAT,
    metadata: {
      name: source.name,
      durationMinutes: source.durationMinutes,
      warmup: source.warmup,
      coachNotes: source.coachNotes,
      muscleGroup: source.muscleGroup,
    },
    blocks: renumberBlockPositions(source.blocks),
  };
}

// UUID sentinelle pour l'id du bloc muscu synthétique d'un ANCIEN modèle legacy
// (jamais persisté : régénéré à l'application). N'a de sens que pour
// `makeLegacyStrengthBlockId` dans `toOrderedBlocks`.
const LEGACY_TEMPLATE_SENTINEL_ID = "00000000-0000-4000-8000-00000000ba5e";

/**
 * Extrait les blocs d'un contenu de modèle, discriminé EXPLICITEMENT :
 *  - canonique → `blocks[]` tels quels (ids du modèle) ;
 *  - legacy    → normalisé UNE seule fois via `toOrderedBlocks` depuis
 *    `exercises[]`/`cardioBlocks[]`.
 * Jamais de repli implicite `blocks ?? legacy`. Les ids retournés sont ceux du
 * modèle ; la régénération stricte a lieu à l'APPLICATION (`templateBlocksForApply`).
 */
export function templateBlocksFromContent(raw: unknown): TrainingBlock[] {
  if (isCanonicalTemplateContent(raw)) {
    return renumberBlockPositions(raw.blocks);
  }
  const legacy = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const exercises = Array.isArray(legacy.exercises) ? (legacy.exercises as AdminExercise[]) : [];
  const cardioBlocks = Array.isArray(legacy.cardioBlocks) ? (legacy.cardioBlocks as AdminCardioBlock[]) : [];
  return toOrderedBlocks({ id: LEGACY_TEMPLATE_SENTINEL_ID, exercises, cardioBlocks });
}

/**
 * Blocs prêts à APPLIQUER à une séance : nouveaux ids temporaires stricts
 * (`new-block:` / `new-exercise:`) pour chaque bloc et exercice, aucun UUID du
 * modèle réutilisé, ordre / couleurs / prescriptions conservés, source du
 * modèle inchangée.
 */
export function templateBlocksForApply(raw: unknown, idFactory?: IdFactory): TrainingBlock[] {
  return regenerateBlockIdsForDuplication(templateBlocksFromContent(raw), idFactory);
}

/**
 * Vue LEGACY (affichage uniquement) : reconstruit `cardioBlocks[]` depuis les
 * blocs cardio, pour les consommateurs existants qui affichent des compteurs
 * (p. ex. la banque de séances). N'est JAMAIS persisté — la source stockée reste
 * `blocks[]`.
 */
export function cardioBlocksFromBlocks(blocks: readonly TrainingBlock[]): AdminCardioBlock[] {
  return blocks.flatMap((block, index) =>
    block.category === "cardio"
      ? [
          {
            id: block.id,
            order: index,
            title: block.title ?? "",
            cardioType: block.cardioType,
            machineType: block.machineType,
            segments: block.prescriptions,
          } satisfies AdminCardioBlock,
        ]
      : [],
  );
}
