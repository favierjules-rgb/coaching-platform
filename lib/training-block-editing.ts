import {
  deriveSessionType,
  moveBlockDown,
  moveBlockUp,
  renumberBlockPositions,
  toOrderedBlocks,
} from "@/lib/training-blocks";
import type {
  AdminExercise,
  AdminWorkoutSession,
  CardioTrainingBlock,
  DerivedSessionType,
  StrengthTrainingBlock,
  TrainingBlock,
  TrainingBlockCategory,
} from "@/types";

/**
 * Opérations d'état PURES du builder multi-blocs (chantier
 * feature/multi-block-training-sessions, Lot 4.1).
 *
 * PÉRIMÈTRE : fonctions PURES uniquement. Aucune de ces fonctions ne touche
 * Supabase, le DOM, React ou l'horloge (les ids sont fournis par une
 * `IdFactory` INJECTABLE, pour des tests déterministes). Elles constituent la
 * SEULE source de vérité de l'état du builder : après normalisation initiale,
 * le builder vit exclusivement en `blocks[]`. Les tableaux hérités
 * `session.exercises[]` / `session.cardioBlocks[]` ne sont PLUS lus ni écrits
 * par ces opérations (ils restent dans le type général pour la compatibilité
 * hors builder).
 *
 * Contrats structurants :
 *  - immuabilité stricte : aucune mutation en place, chaque opération renvoie
 *    de nouveaux objets/tableaux ; la source d'une duplication reste intacte ;
 *  - identifiants : un déplacement/une édition CONSERVE l'UUID réel ; une
 *    création/duplication génère un id temporaire STRICT `new-block:<uuid>` /
 *    `new-exercise:<uuid>` (jamais un `prefix-timestamp-counter`, jamais un
 *    UUID nu — que l'adaptateur canonique prendrait pour un id persisté) ;
 *  - positions : renormalisées 0..n-1 après CHAQUE opération, jamais de
 *    regroupement par catégorie ;
 *  - repos : `blocks.length === 0` ⇔ `isRestDay === true` ; l'état canonique ne
 *    conserve jamais un bloc avec `isRestDay=true` ni une séance vide avec
 *    `isRestDay=false` ;
 *  - type global : jamais saisi, toujours dérivé via `deriveSessionType`.
 */

/* ─────────────────────────── Couleurs de bloc ─────────────────────────── */

/**
 * Couleurs autorisées d'un bloc (miroir strict de `training_blocks.color_key`).
 * La couleur est une propriété INDÉPENDANTE du bloc, jamais de la catégorie :
 * deux blocs strength peuvent différer, un bloc cardio peut être gris, etc.
 * Toute valeur hors de cet ensemble est rejetée/normalisée AVANT l'appel RPC.
 */
export const BLOCK_COLOR_KEYS = ["gray", "red", "orange", "yellow", "green", "blue", "purple"] as const;
export type BlockColorKey = (typeof BLOCK_COLOR_KEYS)[number];

/** Couleur par défaut d'un nouveau bloc strength (miroir du défaut SQL `color_key = 'gray'`). */
export const DEFAULT_STRENGTH_COLOR_KEY: BlockColorKey = "gray";
/** Couleur par défaut d'un nouveau bloc cardio (valeur par défaut cohérente, distincte du strength). */
export const DEFAULT_CARDIO_COLOR_KEY: BlockColorKey = "blue";

/** `true` si `value` est une `colorKey` autorisée. */
export function isBlockColorKey(value: string): value is BlockColorKey {
  return (BLOCK_COLOR_KEYS as readonly string[]).includes(value);
}

/** Normalise une couleur entrante vers l'enum autorisé (valeur inconnue → `fallback`). */
export function normalizeColorKey(value: string | null | undefined, fallback: BlockColorKey = DEFAULT_STRENGTH_COLOR_KEY): BlockColorKey {
  return typeof value === "string" && isBlockColorKey(value) ? value : fallback;
}

/** Couleur par défaut d'une catégorie donnée. */
function defaultColorForCategory(category: TrainingBlockCategory): BlockColorKey {
  return category === "cardio" ? DEFAULT_CARDIO_COLOR_KEY : DEFAULT_STRENGTH_COLOR_KEY;
}

/* ─────────────────────────── Génération d'ids ─────────────────────────── */

/** Fabrique d'UUID injectable (déterministe dans les tests, `crypto.randomUUID` en prod). */
export type IdFactory = () => string;

const defaultIdFactory: IdFactory = () => crypto.randomUUID();

/** Id temporaire STRICT d'un nouveau bloc client. */
function newBlockId(gen: IdFactory): string {
  return `new-block:${gen()}`;
}

/** Id temporaire STRICT d'un nouvel exercice client. */
function newExerciseId(gen: IdFactory): string {
  return `new-exercise:${gen()}`;
}

/* ───────────────────────── Type d'état du builder ─────────────────────── */

/**
 * Séance telle que la manipule le builder Lot 4 : `blocks[]` est OBLIGATOIRE et
 * constitue l'unique source de vérité (contrairement à `AdminWorkoutSession`,
 * où `blocks?` est optionnel/additif).
 */
export type BuilderWorkoutSession = Omit<AdminWorkoutSession, "blocks"> & { blocks: TrainingBlock[] };

/** État dérivé (lecture seule) présenté par l'interface — jamais stocké comme vérité. */
export interface BuilderSessionState {
  type: DerivedSessionType;
  isRestDay: boolean;
  blockCount: number;
}

/**
 * État dérivé d'une séance du builder. Le type global vient TOUJOURS de
 * `deriveSessionType(blocks)` (aucun bloc → rest ; strength seul → strength ;
 * cardio seul → cardio ; les deux → mixed) ; `mixed` n'est jamais une catégorie.
 */
export function deriveBuilderSessionState(session: BuilderWorkoutSession): BuilderSessionState {
  return {
    type: deriveSessionType(session.blocks),
    isRestDay: session.blocks.length === 0,
    blockCount: session.blocks.length,
  };
}

/* ───────────────────────────── Helpers internes ───────────────────────── */

function clampIndex(index: number, length: number): number {
  return Math.max(0, Math.min(index, length));
}

/** Réindexe l'`order` des exercices sur l'ordre du tableau (0-based). Non persisté (l'order_index est dérivé côté RPC), mais garde le modèle client cohérent. */
function reindexExercises(exercises: AdminExercise[]): AdminExercise[] {
  return exercises.map((exercise, index) => ({ ...exercise, order: index }));
}

/** Copie immuable d'un bloc (tableaux internes recopiés, jamais partagés avec la source). */
function cloneBlockDeep(block: TrainingBlock): TrainingBlock {
  if (block.category === "strength") {
    return { ...block, exercises: block.exercises.map((exercise) => ({ ...exercise })) };
  }
  return { ...block, prescriptions: block.prescriptions.map((prescription) => ({ ...prescription })) };
}

/**
 * Reconstruit une séance du builder après une opération : renormalise les
 * positions 0..n-1 et synchronise `isRestDay` avec la présence de blocs. C'est
 * l'unique fabrique de l'état canonique — toutes les opérations passent par là.
 */
function build(session: AdminWorkoutSession | BuilderWorkoutSession, blocks: TrainingBlock[]): BuilderWorkoutSession {
  const renumbered = renumberBlockPositions(blocks);
  return { ...session, blocks: renumbered, isRestDay: renumbered.length === 0 };
}

function mapBlock(
  session: BuilderWorkoutSession,
  blockId: string,
  fn: (block: TrainingBlock) => TrainingBlock,
): BuilderWorkoutSession {
  return build(session, session.blocks.map((block) => (block.id === blockId ? fn(block) : block)));
}

function mapStrengthBlock(
  session: BuilderWorkoutSession,
  blockId: string,
  fn: (block: StrengthTrainingBlock) => StrengthTrainingBlock,
): BuilderWorkoutSession {
  return build(
    session,
    session.blocks.map((block) => (block.id === blockId && block.category === "strength" ? fn(block) : block)),
  );
}

/* ───────────────────────── Fabriques de blocs neufs ───────────────────── */

function createStrengthBlock(gen: IdFactory): StrengthTrainingBlock {
  return { id: newBlockId(gen), category: "strength", position: 0, title: null, colorKey: DEFAULT_STRENGTH_COLOR_KEY, exercises: [] };
}

function createCardioBlock(gen: IdFactory): CardioTrainingBlock {
  return {
    id: newBlockId(gen),
    category: "cardio",
    position: 0,
    title: null,
    colorKey: DEFAULT_CARDIO_COLOR_KEY,
    cardioType: "continuous_run",
    prescriptions: [],
  };
}

/** Exercice strength neuf, valeurs par défaut miroir de `blankExercise` (composants), id temporaire strict. */
function createStrengthExercise(gen: IdFactory, order: number, fields?: Partial<AdminExercise>): AdminExercise {
  return {
    order,
    name: "",
    sets: 3,
    reps: "8-10",
    restSeconds: 60,
    tempo: "2-0-1-0",
    recommendedLoad: "",
    videoUrl: "",
    notes: "",
    ...fields,
    // `id` en dernier : un exercice neuf porte TOUJOURS un `new-exercise:<uuid>`,
    // jamais un id éventuellement fourni dans `fields`.
    id: newExerciseId(gen),
  };
}

/* ────────────────────────── Normalisation initiale ────────────────────── */

/**
 * Normalise une séance vers l'état canonique du builder, UNE SEULE FOIS à
 * l'entrée :
 *  - si `session.blocks` existe (même `[]`) → copie immuable triée par
 *    `position` ; c'est déjà la source canonique (lecture Lot 2) ;
 *  - sinon → `toOrderedBlocks(session)` projette l'ancien modèle
 *    (`exercises[]` + `cardioBlocks[]`) une seule fois.
 * Ensuite l'état est EXCLUSIVEMENT `blocks[]`. Les couleurs sont normalisées
 * vers l'enum autorisé, `isRestDay` synchronisé, les positions renormalisées.
 */
export function normalizeBuilderSession(
  session: AdminWorkoutSession,
  options?: { strengthBlockId?: string },
): BuilderWorkoutSession {
  const source: TrainingBlock[] =
    session.blocks !== undefined
      ? session.blocks
          .slice()
          .sort((a, b) => a.position - b.position)
          .map(cloneBlockDeep)
      : toOrderedBlocks(
          { id: session.id, exercises: session.exercises, cardioBlocks: session.cardioBlocks },
          options,
        ).map(cloneBlockDeep);

  const normalized = source.map((block) => ({
    ...block,
    colorKey: normalizeColorKey(block.colorKey, defaultColorForCategory(block.category)),
  }));

  return build(session, normalized);
}

/* ──────────────────────────── Opérations de blocs ─────────────────────── */

/**
 * Ajoute un bloc neuf (strength ou cardio) à `atIndex` (défaut : fin). Renvoie
 * la séance mise à jour ET l'id du nouveau bloc (pour déplacer le focus). Jamais
 * de catégorie `mixed` ni `rest`.
 */
export function addTrainingBlock(
  session: BuilderWorkoutSession,
  category: TrainingBlockCategory,
  options?: { atIndex?: number; idFactory?: IdFactory },
): { session: BuilderWorkoutSession; blockId: string } {
  const gen = options?.idFactory ?? defaultIdFactory;
  const block = category === "strength" ? createStrengthBlock(gen) : createCardioBlock(gen);
  const next = session.blocks.slice();
  next.splice(clampIndex(options?.atIndex ?? next.length, next.length), 0, block);
  return { session: build(session, next), blockId: block.id };
}

/**
 * Duplique un bloc juste après la source, avec de NOUVEAUX ids temporaires
 * stricts (jamais les UUID persistés de la source) ; la source reste intacte.
 * Strength → bloc + tous ses exercices reçoivent de nouveaux ids (aucun feedback
 * copié : le modèle client d'exercice n'en porte pas). Cardio → bloc + copie des
 * prescriptions (recréées côté RPC). `colorKey` préservée.
 */
export function duplicateTrainingBlock(
  session: BuilderWorkoutSession,
  blockId: string,
  options?: { idFactory?: IdFactory },
): { session: BuilderWorkoutSession; blockId: string | null } {
  const gen = options?.idFactory ?? defaultIdFactory;
  const index = session.blocks.findIndex((block) => block.id === blockId);
  if (index === -1) return { session, blockId: null };
  const copy = duplicateBlock(session.blocks[index], gen);
  const next = session.blocks.slice();
  next.splice(index + 1, 0, copy);
  return { session: build(session, next), blockId: copy.id };
}

function duplicateBlock(block: TrainingBlock, gen: IdFactory): TrainingBlock {
  if (block.category === "strength") {
    return {
      ...block,
      id: newBlockId(gen),
      exercises: block.exercises.map((exercise, index) => ({ ...exercise, id: newExerciseId(gen), order: index })),
    };
  }
  return {
    ...block,
    id: newBlockId(gen),
    prescriptions: block.prescriptions.map((prescription, index) => ({ ...prescription, id: gen(), order: index })),
  };
}

/**
 * Régénère TOUS les ids (blocs + exercices) d'une liste de blocs vers de
 * nouveaux ids temporaires stricts — utilisé pour la duplication d'une séance
 * ou d'une semaine entière dans le builder. Aucun UUID source n'est réutilisé,
 * la source reste intacte (copie immuable), l'ordre et le contenu préservés.
 */
export function regenerateBlockIdsForDuplication(
  blocks: readonly TrainingBlock[],
  idFactory: IdFactory = defaultIdFactory,
): TrainingBlock[] {
  return renumberBlockPositions(blocks.map((block) => duplicateBlock(block, idFactory)));
}

/**
 * Aplati, dans l'ordre des blocs, les exercices de TOUS les blocs strength
 * d'une séance — pour l'analyse de charge (Lot 4.5, lecture seule). Lit
 * UNIQUEMENT `blocks[]`, jamais `session.exercises[]` ; ne recompose aucun
 * tableau legacy persistant.
 */
export function strengthExercisesFromBlocks(blocks: readonly TrainingBlock[]): AdminExercise[] {
  return blocks.flatMap((block) => (block.category === "strength" ? block.exercises : []));
}

/* ─────────────────── Sérialisation canonique de sauvegarde (Lot 4.4) ────── */

/**
 * Métadonnées éditables d'une séance, transmises à la RPC en `session_patch`
 * (miroir camelCase de `SessionPatch` de l'adaptateur).
 */
export interface CanonicalSessionPatch {
  day: string;
  name: string;
  muscleGroup: string;
  durationMinutes: number;
  warmup: string;
  coachNotes: string;
  bannerUrl: string | null;
}

/** Représentation canonique PURE d'une séance prête à persister (Lot 4.4). */
export interface CanonicalSessionSaveData {
  id: string;
  /** Version chargée (optimistic lock) — absente pour une séance non encore persistée. */
  updatedAt?: string;
  isRestDay: boolean;
  sessionType: DerivedSessionType;
  /** Blocs canoniques, positions renormalisées 0..n-1, ids conservés (UUID / new-*). */
  blocks: TrainingBlock[];
  sessionPatch: CanonicalSessionPatch;
}

/**
 * Sérialise UNE séance du builder vers sa représentation canonique de
 * sauvegarde (Lot 4.4). Fonction PURE et immuable. `blocks[]` est la SEULE
 * source consultée — jamais `exercises[]` ni `cardioBlocks[]`. Les positions
 * sont renormalisées 0..n-1, l'ordre du tableau conservé, les UUID réels et les
 * ids temporaires stricts (`new-block:` / `new-exercise:`) préservés, le type
 * global et `isRestDay` dérivés des blocs.
 *
 * N.B. : le CHOIX du mode canonique est imposé par l'appelant (jamais déduit de
 * la présence de `blocks`). `session.blocks ?? []` est ici une simple sécurité
 * de type (une séance canonique porte toujours `blocks`, vide = repos), pas un
 * repli implicite vers le modèle legacy.
 */
export function toCanonicalSessionSaveData(session: AdminWorkoutSession): CanonicalSessionSaveData {
  const blocks = renumberBlockPositions(session.blocks ?? []);
  return {
    id: session.id,
    updatedAt: session.updatedAt,
    isRestDay: blocks.length === 0,
    sessionType: deriveSessionType(blocks),
    blocks,
    sessionPatch: {
      day: session.day,
      name: session.name,
      muscleGroup: session.muscleGroup,
      durationMinutes: session.durationMinutes,
      warmup: session.warmup,
      coachNotes: session.coachNotes,
      bannerUrl: session.bannerUrl ?? null,
    },
  };
}

/** Supprime un bloc ; si c'était le dernier, la séance redevient repos (`isRestDay=true`, type `rest`). */
export function removeTrainingBlock(session: BuilderWorkoutSession, blockId: string): BuilderWorkoutSession {
  return build(session, session.blocks.filter((block) => block.id !== blockId));
}

/** Déplace un bloc d'un cran (accessible Monter/Descendre), UUID conservés, positions renormalisées. No-op aux bornes. */
export function moveTrainingBlock(
  session: BuilderWorkoutSession,
  blockId: string,
  direction: "up" | "down",
): BuilderWorkoutSession {
  const blocks = direction === "up" ? moveBlockUp(session.blocks, blockId) : moveBlockDown(session.blocks, blockId);
  return build(session, blocks);
}

/** Réordonne un bloc de `fromIndex` vers `toIndex` (drag), UUID conservés, aucun regroupement par catégorie, aucune mutation en place. */
export function reorderTrainingBlocks(
  session: BuilderWorkoutSession,
  fromIndex: number,
  toIndex: number,
): BuilderWorkoutSession {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= session.blocks.length) return session;
  const next = session.blocks.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clampIndex(toIndex, next.length), 0, moved);
  return build(session, next);
}

/**
 * Placement d'un drop par rapport à une carte cible, calculé PUREMENT depuis la
 * géométrie (le composant lit `clientY` et le rectangle ; ce helper décide). Au
 * dessus du milieu → `before`, en dessous → `after`.
 */
export function getBlockDropPlacement(pointerY: number, rectTop: number, rectHeight: number): "before" | "after" {
  return pointerY < rectTop + rectHeight / 2 ? "before" : "after";
}

/**
 * Réordonnancement drag par IDENTIFIANTS stables (jamais par index de départ) :
 * retrouve les index courants à partir des ids, insère le bloc déplacé avant/
 * après la cible, conserve tous les UUID, renormalise les positions 0..n-1,
 * n'altère jamais le tableau source. No-op si drop sur soi-même, ids inconnus,
 * ou destination identique à l'origine.
 */
export function reorderTrainingBlocksById(
  session: BuilderWorkoutSession,
  draggedBlockId: string,
  targetBlockId: string,
  placement: "before" | "after",
): BuilderWorkoutSession {
  if (draggedBlockId === targetBlockId) return session;
  const from = session.blocks.findIndex((block) => block.id === draggedBlockId);
  const targetIndex = session.blocks.findIndex((block) => block.id === targetBlockId);
  if (from === -1 || targetIndex === -1) return session;
  // Point d'insertion dans le tableau d'ORIGINE, puis ajustement après retrait
  // du bloc déplacé si celui-ci se trouve avant ce point.
  const insertionPoint = placement === "before" ? targetIndex : targetIndex + 1;
  const to = from < insertionPoint ? insertionPoint - 1 : insertionPoint;
  return reorderTrainingBlocks(session, from, to);
}

/** Met à jour le titre d'un bloc (id/catégorie inchangés). */
export function updateBlockTitle(session: BuilderWorkoutSession, blockId: string, title: string | null): BuilderWorkoutSession {
  return mapBlock(session, blockId, (block) => ({ ...block, title }));
}

/** Met à jour la couleur d'un bloc, normalisée vers l'enum autorisé (valeur inconnue → défaut de la catégorie). */
export function updateBlockColor(session: BuilderWorkoutSession, blockId: string, colorKey: string): BuilderWorkoutSession {
  return mapBlock(session, blockId, (block) => ({
    ...block,
    colorKey: normalizeColorKey(colorKey, defaultColorForCategory(block.category)),
  }));
}

/**
 * Remplace intégralement le contenu d'un bloc (utilisé par les éditeurs
 * spécialisés — p. ex. l'éditeur cardio qui renvoie un bloc complet mis à jour).
 * L'id ET la catégorie du bloc existant sont TOUJOURS préservés ; la couleur est
 * renormalisée. Aucun effet si la catégorie fournie diffère.
 */
export function replaceTrainingBlock(session: BuilderWorkoutSession, blockId: string, next: TrainingBlock): BuilderWorkoutSession {
  return mapBlock(session, blockId, (block) => {
    if (block.category !== next.category) return block;
    return { ...next, id: block.id, colorKey: normalizeColorKey(next.colorKey, defaultColorForCategory(block.category)) };
  });
}

/* ─────────────────────── Opérations d'exercices strength ──────────────── */

/** Ajoute un exercice neuf (id temporaire strict) à la fin d'un bloc strength. Renvoie la séance et l'id créé. */
export function addStrengthExercise(
  session: BuilderWorkoutSession,
  blockId: string,
  options?: { fields?: Partial<AdminExercise>; idFactory?: IdFactory },
): { session: BuilderWorkoutSession; exerciseId: string | null } {
  const gen = options?.idFactory ?? defaultIdFactory;
  let exerciseId: string | null = null;
  const nextSession = mapStrengthBlock(session, blockId, (block) => {
    const exercise = createStrengthExercise(gen, block.exercises.length, options?.fields);
    exerciseId = exercise.id;
    return { ...block, exercises: [...block.exercises, exercise] };
  });
  return { session: nextSession, exerciseId };
}

/** Duplique un exercice juste après la source dans son bloc, avec un NOUVEL id temporaire strict. */
export function duplicateStrengthExercise(
  session: BuilderWorkoutSession,
  blockId: string,
  exerciseId: string,
  options?: { idFactory?: IdFactory },
): { session: BuilderWorkoutSession; exerciseId: string | null } {
  const gen = options?.idFactory ?? defaultIdFactory;
  let created: string | null = null;
  const nextSession = mapStrengthBlock(session, blockId, (block) => {
    const index = block.exercises.findIndex((exercise) => exercise.id === exerciseId);
    if (index === -1) return block;
    const copy: AdminExercise = { ...block.exercises[index], id: newExerciseId(gen) };
    created = copy.id;
    const exercises = block.exercises.slice();
    exercises.splice(index + 1, 0, copy);
    return { ...block, exercises: reindexExercises(exercises) };
  });
  return { session: nextSession, exerciseId: created };
}

/** Supprime un exercice d'un bloc strength ; les `order` sont recalculés. */
export function removeStrengthExercise(session: BuilderWorkoutSession, blockId: string, exerciseId: string): BuilderWorkoutSession {
  return mapStrengthBlock(session, blockId, (block) => ({
    ...block,
    exercises: reindexExercises(block.exercises.filter((exercise) => exercise.id !== exerciseId)),
  }));
}

/** Met à jour un exercice (l'id est toujours préservé, même si `partial` en fournit un). */
export function updateStrengthExercise(
  session: BuilderWorkoutSession,
  blockId: string,
  exerciseId: string,
  partial: Partial<AdminExercise>,
): BuilderWorkoutSession {
  return mapStrengthBlock(session, blockId, (block) => ({
    ...block,
    exercises: block.exercises.map((exercise) => (exercise.id === exerciseId ? { ...exercise, ...partial, id: exercise.id } : exercise)),
  }));
}

/** Déplace un exercice d'un cran dans son bloc (accessible Monter/Descendre). No-op aux bornes. */
export function moveStrengthExercise(
  session: BuilderWorkoutSession,
  blockId: string,
  exerciseId: string,
  direction: "up" | "down",
): BuilderWorkoutSession {
  return mapStrengthBlock(session, blockId, (block) => {
    const index = block.exercises.findIndex((exercise) => exercise.id === exerciseId);
    if (index === -1) return block;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= block.exercises.length) return block;
    const exercises = block.exercises.slice();
    [exercises[index], exercises[target]] = [exercises[target], exercises[index]];
    return { ...block, exercises: reindexExercises(exercises) };
  });
}

/** Réordonne un exercice dans son bloc (drag), aucune mutation en place. */
export function reorderStrengthExercises(
  session: BuilderWorkoutSession,
  blockId: string,
  fromIndex: number,
  toIndex: number,
): BuilderWorkoutSession {
  return mapStrengthBlock(session, blockId, (block) => {
    if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= block.exercises.length) return block;
    const exercises = block.exercises.slice();
    const [moved] = exercises.splice(fromIndex, 1);
    exercises.splice(clampIndex(toIndex, exercises.length), 0, moved);
    return { ...block, exercises: reindexExercises(exercises) };
  });
}

/**
 * Déplace un exercice d'un bloc strength vers un AUTRE bloc strength :
 *  - l'UUID de l'exercice est CONSERVÉ (déplacement, pas recréation) ;
 *  - blocs source et cible copiés immuablement ;
 *  - `order` recalculés dans les deux blocs.
 * No-op si l'un des blocs n'est pas strength, s'ils sont identiques, ou si
 * l'exercice est introuvable (le feedback n'est jamais détaché : l'id est
 * préservé, la RPC rattache le feedback par cet id).
 */
export function moveExerciseBetweenStrengthBlocks(
  session: BuilderWorkoutSession,
  fromBlockId: string,
  toBlockId: string,
  exerciseId: string,
  options?: { toIndex?: number },
): BuilderWorkoutSession {
  if (fromBlockId === toBlockId) return session;
  const fromBlock = session.blocks.find((block) => block.id === fromBlockId);
  const toBlock = session.blocks.find((block) => block.id === toBlockId);
  if (!fromBlock || !toBlock || fromBlock.category !== "strength" || toBlock.category !== "strength") return session;
  const exercise = fromBlock.exercises.find((candidate) => candidate.id === exerciseId);
  if (!exercise) return session;
  const toIndex = options?.toIndex ?? toBlock.exercises.length;

  const next = session.blocks.map((block) => {
    if (block.id === fromBlockId && block.category === "strength") {
      return { ...block, exercises: reindexExercises(block.exercises.filter((candidate) => candidate.id !== exerciseId)) };
    }
    if (block.id === toBlockId && block.category === "strength") {
      const exercises = block.exercises.slice();
      exercises.splice(clampIndex(toIndex, exercises.length), 0, { ...exercise });
      return { ...block, exercises: reindexExercises(exercises) };
    }
    return block;
  });
  return build(session, next);
}
