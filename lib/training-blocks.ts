import type {
  AdminCardioBlock,
  AdminWorkoutSession,
  CardioTrainingBlock,
  DerivedSessionType,
  StrengthTrainingBlock,
  TrainingBlock,
} from "@/types";

/**
 * Helpers du modèle « multi-blocs » (chantier
 * feature/multi-block-training-sessions, Lot 1 — juillet 2026).
 *
 * PÉRIMÈTRE LOT 1 : fonctions PURES uniquement (aucun accès Supabase, aucun
 * effet de bord, aucune dépendance UI). Elles posent le socle du modèle
 * `blocks[]` unifié :
 *   - `deriveSessionType`   : type global d'une séance, calculé depuis ses blocs ;
 *   - `toOrderedBlocks`     : projette une séance existante
 *     (`exercises[]` + `cardioBlocks[]`) vers la liste unique ordonnée
 *     `blocks[]`, SANS toucher aux données ni à la base ;
 *   - `renumberBlockPositions` / `moveBlockUp` / `moveBlockDown` :
 *     réordonnancement pur, avec renormalisation des `position` (1..n) après
 *     chaque opération, conformément au contrat demandé.
 *
 * La bascule réelle de la lecture/écriture Supabase et de l'interface arrive
 * dans les lots suivants — ce module ne fait qu'établir le vocabulaire.
 */

/** Couleur par défaut d'un bloc projeté depuis l'ancien modèle (miroir du défaut SQL `training_blocks.color_key = 'gray'`). Les vraies couleurs seront lues/écrites aux lots 2-3. */
const DEFAULT_BLOCK_COLOR_KEY = "gray";

/**
 * Préfixe de l'identifiant VIRTUEL du bloc musculation hérité (ancien modèle
 * à plat, exercices sans `block_id`). Ce n'est PAS un UUID de base : il ne
 * doit JAMAIS être envoyé dans une colonne UUID Supabase. À la première
 * sauvegarde, le moteur d'écriture (Lot 3) le détecte, crée une vraie ligne
 * `training_blocks` de catégorie `strength`, récupère son UUID réel et y
 * rattache les exercices existants (ids conservés). Après reload, plus aucun
 * `legacy-strength:*` ne subsiste.
 */
const LEGACY_STRENGTH_BLOCK_PREFIX = "legacy-strength:";

/** Construit l'id virtuel du bloc musculation hérité d'une séance. */
export function makeLegacyStrengthBlockId(sessionId: string): string {
  return `${LEGACY_STRENGTH_BLOCK_PREFIX}${sessionId}`;
}

/** `true` si l'id est un id virtuel de bloc musculation hérité (jamais un UUID persistable). */
export function isLegacyStrengthBlockId(id: string): boolean {
  return id.startsWith(LEGACY_STRENGTH_BLOCK_PREFIX);
}

/**
 * Type global d'une séance, TOUJOURS dérivé UNIQUEMENT des blocs — jamais
 * saisi, jamais influencé par un flag legacy :
 * - aucun bloc → "rest" ;
 * - uniquement des blocs "strength" → "strength" ;
 * - uniquement des blocs "cardio" → "cardio" ;
 * - au moins un "strength" ET un "cardio" → "mixed".
 *
 * `isRestDay` (ancien modèle) n'entre PAS dans ce calcul : le contenu réel
 * des blocs prime toujours. Une séance marquée `isRestDay=true` qui porte des
 * blocs est donc dérivée selon ses blocs (une divergence peut être
 * journalisée par l'appelant, mais ne modifie jamais le résultat métier).
 */
export function deriveSessionType(blocks: readonly TrainingBlock[]): DerivedSessionType {
  if (blocks.length === 0) return "rest";
  const hasStrength = blocks.some((b) => b.category === "strength");
  const hasCardio = blocks.some((b) => b.category === "cardio");
  if (hasStrength && hasCardio) return "mixed";
  return hasStrength ? "strength" : "cardio";
}

/**
 * Préfixe d'un identifiant de bloc NOUVEAU côté client, pour le chemin
 * canonique multi-blocs (Lot 3). Format strict `new-block:<uuid-client>` :
 * le suffixe doit être un UUID valide généré côté client. La RPC le convertit
 * en UUID serveur et retourne le mapping temporaire → réel. Les anciens ids
 * `prefix-timestamp-counter` (generateId) ne sont PAS acceptés sur ce chemin.
 */
const NEW_BLOCK_ID_PREFIX = "new-block:";

/** UUID v1-v5 (canonique, insensible à la casse). */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** `true` si `value` est un UUID canonique. */
export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Résultat du parsing STRICT d'un identifiant de bloc entrant (Lot 3, chemin
 * canonique) :
 * - `persisted` : UUID réel, devant appartenir à la séance sauvegardée ;
 * - `legacy-strength` : bloc musculation hérité `legacy-strength:<session_uuid>` ;
 * - `new` : nouveau bloc client `new-block:<uuid-client>`.
 */
export type ParsedTrainingBlockId =
  | { kind: "persisted"; id: string }
  | { kind: "legacy-strength"; sessionId: string }
  | { kind: "new"; clientId: string };

/**
 * Parse STRICTEMENT un identifiant de bloc entrant. Trois formats seulement
 * sont acceptés (correction « format strict des ids ») ; toute autre chaîne
 * lève une erreur, afin de ne jamais masquer un payload corrompu :
 *   1. UUID réel                     → { kind: "persisted" }
 *   2. legacy-strength:<session_uuid> → { kind: "legacy-strength" }
 *   3. new-block:<uuid-client>        → { kind: "new" }
 *
 * Contraintes vérifiées ici :
 * - un id legacy doit porter EXACTEMENT l'UUID de la séance sauvegardée ;
 * - le suffixe d'un `new-block:` doit être un UUID client valide.
 * (L'unicité — un seul legacy, ids new/persisted non dupliqués — et la
 * cohérence de catégorie sont vérifiées au niveau du payload, pas ici.)
 */
export function parseTrainingBlockId(value: string, expectedSessionId: string): ParsedTrainingBlockId {
  if (isLegacyStrengthBlockId(value)) {
    const sessionId = value.slice(LEGACY_STRENGTH_BLOCK_PREFIX.length);
    if (!isUuid(sessionId)) {
      throw new Error(`Id de bloc legacy invalide (suffixe non-UUID) : "${value}".`);
    }
    if (sessionId !== expectedSessionId) {
      throw new Error(`Id de bloc legacy rattaché à une autre séance : "${value}" (séance attendue ${expectedSessionId}).`);
    }
    return { kind: "legacy-strength", sessionId };
  }

  if (value.startsWith(NEW_BLOCK_ID_PREFIX)) {
    const clientId = value.slice(NEW_BLOCK_ID_PREFIX.length);
    if (!isUuid(clientId)) {
      throw new Error(`Id de nouveau bloc invalide (suffixe non-UUID) : "${value}".`);
    }
    return { kind: "new", clientId };
  }

  if (isUuid(value)) {
    return { kind: "persisted", id: value };
  }

  throw new Error(`Format d'identifiant de bloc non reconnu : "${value}".`);
}

/**
 * Préfixe d'un identifiant d'exercice NOUVEAU côté client, chemin canonique
 * (Lot 3). Format strict `new-exercise:<uuid-client>`.
 */
const NEW_EXERCISE_ID_PREFIX = "new-exercise:";

/** Résultat du parsing strict d'un id d'exercice entrant. */
export type ParsedTrainingExerciseId = { kind: "persisted"; id: string } | { kind: "new"; clientId: string };

/**
 * Parse STRICTEMENT un id d'exercice entrant. Deux formats seulement :
 *   1. UUID réel                 → { kind: "persisted" }  (appartenance à la
 *      séance vérifiée côté RPC) ;
 *   2. new-exercise:<uuid-client> → { kind: "new" }.
 * Toute autre chaîne (dont l'ancien `prefix-timestamp-counter`) est rejetée.
 */
export function parseTrainingExerciseId(value: string): ParsedTrainingExerciseId {
  if (value.startsWith(NEW_EXERCISE_ID_PREFIX)) {
    const clientId = value.slice(NEW_EXERCISE_ID_PREFIX.length);
    if (!isUuid(clientId)) {
      throw new Error(`Id de nouvel exercice invalide (suffixe non-UUID) : "${value}".`);
    }
    return { kind: "new", clientId };
  }
  if (isUuid(value)) {
    return { kind: "persisted", id: value };
  }
  throw new Error(`Format d'identifiant d'exercice non reconnu : "${value}".`);
}

/** Convertit un `AdminCardioBlock` (ancien modèle) en `CardioTrainingBlock` (modèle unifié), à la position fournie. */
function cardioBlockToTrainingBlock(block: AdminCardioBlock, position: number): CardioTrainingBlock {
  return {
    id: block.id,
    category: "cardio",
    position,
    title: block.title ? block.title : null,
    colorKey: DEFAULT_BLOCK_COLOR_KEY,
    cardioType: block.cardioType,
    machineType: block.machineType,
    prescriptions: block.segments.slice().sort((a, b) => a.order - b.order),
  };
}

/**
 * Projette une séance existante vers la liste unique et ordonnée `blocks[]`,
 * SANS modifier la séance ni la base (lecture compatible du Lot 1).
 *
 * L'ancien modèle ne peut produire qu'un ordre muscu-puis-cardio (c'est
 * précisément la limite à lever) : on place donc le bloc musculation en
 * premier s'il existe des exercices, puis les blocs cardio dans leur ordre.
 * L'ordre libre réel deviendra possible une fois les blocs persistés en base
 * avec leur `position` propre (lots suivants).
 *
 * `strengthBlockId` permet à l'appelant de fournir un id stable pour le bloc
 * musculation synthétique (sinon dérivé de l'id de séance).
 */
export function toOrderedBlocks(
  session: Pick<AdminWorkoutSession, "id" | "exercises" | "cardioBlocks">,
  options?: { strengthBlockId?: string },
): TrainingBlock[] {
  const blocks: TrainingBlock[] = [];

  const exercises = session.exercises ?? [];
  if (exercises.length > 0) {
    const strengthBlock: StrengthTrainingBlock = {
      id: options?.strengthBlockId ?? makeLegacyStrengthBlockId(session.id),
      category: "strength",
      position: 0,
      title: null,
      colorKey: DEFAULT_BLOCK_COLOR_KEY,
      exercises: exercises.slice().sort((a, b) => a.order - b.order),
    };
    blocks.push(strengthBlock);
  }

  const cardioBlocks = (session.cardioBlocks ?? []).slice().sort((a, b) => a.order - b.order);
  for (const cardio of cardioBlocks) {
    blocks.push(cardioBlockToTrainingBlock(cardio, blocks.length));
  }

  return renumberBlockPositions(blocks);
}

/**
 * Renormalise les `position` d'une liste de blocs en une séquence commune
 * 0-based (0, 1, 2, 3…) selon leur ordre actuel dans le tableau, sans les
 * réordonner. Tous les blocs d'une séance — strength ET cardio — partagent
 * cette unique séquence, c'est elle qui porte l'ordre d'exécution. À appeler
 * après toute opération de réordonnancement (contrat : « positions
 * renormalisées après chaque opération »).
 */
export function renumberBlockPositions(blocks: readonly TrainingBlock[]): TrainingBlock[] {
  return blocks.map((block, index) => ({ ...block, position: index }));
}

/** Déplace le bloc d'id `blockId` d'un cran vers le haut, puis renormalise les positions. No-op s'il est déjà en tête ou introuvable. */
export function moveBlockUp(blocks: readonly TrainingBlock[], blockId: string): TrainingBlock[] {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index <= 0) return renumberBlockPositions(blocks);
  const next = blocks.slice();
  [next[index - 1], next[index]] = [next[index], next[index - 1]];
  return renumberBlockPositions(next);
}

/** Déplace le bloc d'id `blockId` d'un cran vers le bas, puis renormalise les positions. No-op s'il est déjà en dernier ou introuvable. */
export function moveBlockDown(blocks: readonly TrainingBlock[], blockId: string): TrainingBlock[] {
  const index = blocks.findIndex((b) => b.id === blockId);
  if (index === -1 || index >= blocks.length - 1) return renumberBlockPositions(blocks);
  const next = blocks.slice();
  [next[index], next[index + 1]] = [next[index + 1], next[index]];
  return renumberBlockPositions(next);
}
