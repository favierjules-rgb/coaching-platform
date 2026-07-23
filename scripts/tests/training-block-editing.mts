// Tests unitaires PURS des opérations d'état du builder multi-blocs (chantier
// feature/multi-block-training-sessions, Lot 4.1). Aucun accès réseau, aucune
// base, aucun rendu React : uniquement lib/training-block-editing.ts.
//
// Prouve les contrats structurants : normalisation unique vers blocks[],
// immuabilité, ids temporaires stricts vs UUID conservés, positions 0-based,
// ordre libre (aucun regroupement par catégorie), repos dérivé, type global
// dérivé, couleurs normalisées.

import assert from "node:assert/strict";

import {
  addStrengthExercise,
  addTrainingBlock,
  BLOCK_COLOR_KEYS,
  deriveBuilderSessionState,
  duplicateStrengthExercise,
  duplicateTrainingBlock,
  getBlockDropPlacement,
  isBlockColorKey,
  moveExerciseBetweenStrengthBlocks,
  moveStrengthExercise,
  moveTrainingBlock,
  normalizeBuilderSession,
  normalizeColorKey,
  regenerateBlockIdsForDuplication,
  removeTrainingBlock,
  reorderStrengthExercises,
  strengthExercisesFromBlocks,
  reorderTrainingBlocks,
  reorderTrainingBlocksById,
  updateBlockColor,
  updateStrengthExercise,
  type BuilderWorkoutSession,
  type IdFactory,
} from "@/lib/training-block-editing";
import type {
  AdminCardioBlock,
  AdminExercise,
  AdminWorkoutSession,
  CardioTrainingBlock,
  StrengthTrainingBlock,
  TrainingBlock,
} from "@/types";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const P_BLOCK_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_BLOCK_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_EX_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const P_EX_2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

/** Fabrique d'ids déterministe (UUID v4 valides et croissants) pour des tests reproductibles. */
function makeGen(): IdFactory {
  let n = 0;
  return () => {
    n += 1;
    return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
  };
}

function adminEx(id: string, order: number, name = "Ex"): AdminExercise {
  return { id, order, name, sets: 3, reps: "8-10", restSeconds: 60, tempo: "2-0-1-0", recommendedLoad: "", videoUrl: "", notes: "" };
}

function strengthBlock(id: string, position: number, exercises: AdminExercise[] = [], colorKey = "gray"): StrengthTrainingBlock {
  return { id, category: "strength", position, title: null, colorKey, exercises };
}

function cardioBlock(id: string, position: number, colorKey = "blue"): CardioTrainingBlock {
  return { id, category: "cardio", position, title: null, colorKey, cardioType: "easy_run", prescriptions: [] };
}

function makeSession(blocks: TrainingBlock[] | undefined, extra?: Partial<AdminWorkoutSession>): AdminWorkoutSession {
  return {
    id: SESSION_UUID,
    programId: "prog",
    weekNumber: 1,
    day: "Lundi",
    isRestDay: blocks !== undefined && blocks.length === 0,
    name: "Séance",
    muscleGroup: "",
    durationMinutes: 60,
    warmup: "",
    coachNotes: "",
    exercises: [],
    cardioBlocks: [],
    blocks,
    ...extra,
  };
}

function builder(blocks: TrainingBlock[]): BuilderWorkoutSession {
  return normalizeBuilderSession(makeSession(blocks));
}

function categories(session: BuilderWorkoutSession): string[] {
  return session.blocks.map((b) => b.category);
}
function ids(session: BuilderWorkoutSession): string[] {
  return session.blocks.map((b) => b.id);
}
function positions(session: BuilderWorkoutSession): number[] {
  return session.blocks.map((b) => b.position);
}

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`❌ ${name}`);
    console.error(error);
  }
}

// ─────────────────────────────── NORMALISATION ──────────────────────────
test("normalisation — blocks[] existant copié sans mutation (deep copy)", () => {
  const input = makeSession([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0)])]);
  const out = normalizeBuilderSession(input);
  assert.notEqual(out.blocks, input.blocks, "tableau blocks recopié");
  assert.notEqual(out.blocks[0], input.blocks![0], "bloc recopié");
  const outStrength = out.blocks[0] as StrengthTrainingBlock;
  const inStrength = input.blocks![0] as StrengthTrainingBlock;
  assert.notEqual(outStrength.exercises, inStrength.exercises, "exercices recopiés");
  assert.equal(outStrength.exercises[0].id, P_EX_1, "contenu conservé");
});

test("normalisation — ordre trié déterministe par position", () => {
  const out = builder([cardioBlock("00000000-0000-4000-8000-0000000000c2", 2), strengthBlock("00000000-0000-4000-8000-0000000000s0", 0), cardioBlock("00000000-0000-4000-8000-0000000000c1", 1)]);
  assert.deepEqual(positions(out), [0, 1, 2]);
  assert.deepEqual(categories(out), ["strength", "cardio", "cardio"]);
});

test("normalisation — séance legacy (sans blocks) projetée UNE fois via toOrderedBlocks", () => {
  const legacy = makeSession(undefined, {
    exercises: [adminEx(P_EX_1, 1), adminEx(P_EX_2, 2)],
    cardioBlocks: [{ id: P_BLOCK_B, order: 1, title: "Run", cardioType: "easy_run", segments: [] } as AdminCardioBlock],
  });
  const out = normalizeBuilderSession(legacy);
  assert.deepEqual(categories(out), ["strength", "cardio"], "muscu puis cardio depuis l'ancien modèle");
  // Re-normaliser le résultat NE reprojette PAS depuis exercises[] : blocks[] fait foi.
  const again = normalizeBuilderSession(out);
  assert.deepEqual(categories(again), ["strength", "cardio"]);
  assert.equal(again.blocks.length, 2, "aucune double projection");
});

test("normalisation — exercises[]/cardioBlocks[] ignorés après normalisation (jamais resynchronisés)", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0)])]);
  const gen = makeGen();
  const after = addTrainingBlock(start, "cardio", { idFactory: gen }).session;
  // Les tableaux hérités restent tels quels ; seule blocks[] évolue.
  assert.deepEqual(after.exercises, start.exercises, "exercises[] jamais réécrit");
  assert.deepEqual(after.cardioBlocks, start.cardioBlocks, "cardioBlocks[] jamais réécrit");
  assert.equal(after.blocks.length, 2, "blocks[] est la seule source modifiée");
});

test("normalisation — ordre libre C/S/C préservé", () => {
  const out = builder([cardioBlock(P_BLOCK_A, 0), strengthBlock(P_BLOCK_B, 1), cardioBlock("00000000-0000-4000-8000-0000000000c9", 2)]);
  assert.deepEqual(categories(out), ["cardio", "strength", "cardio"]);
});

// ──────────────────────────────────── AJOUT ─────────────────────────────
test("ajout — bloc strength : id new-block:<uuid>, catégorie strength", () => {
  const gen = makeGen();
  const { session, blockId } = addTrainingBlock(builder([]), "strength", { idFactory: gen });
  assert.match(blockId, /^new-block:[0-9a-f-]{36}$/);
  assert.equal(session.blocks[0].category, "strength");
  assert.equal(session.isRestDay, false, "un premier bloc lève le repos");
});

test("ajout — bloc cardio : id strict, catégorie cardio, prescriptions vides", () => {
  const gen = makeGen();
  const { session, blockId } = addTrainingBlock(builder([]), "cardio", { idFactory: gen });
  assert.match(blockId, /^new-block:/);
  const block = session.blocks[0] as CardioTrainingBlock;
  assert.equal(block.category, "cardio");
  assert.deepEqual(block.prescriptions, []);
});

test("ajout — insertion début / milieu / fin, positions renormalisées 0..n-1", () => {
  const gen = makeGen();
  const start = builder([strengthBlock(P_BLOCK_A, 0), strengthBlock(P_BLOCK_B, 1)]);
  const atStart = addTrainingBlock(start, "cardio", { atIndex: 0, idFactory: gen }).session;
  assert.equal(atStart.blocks[0].category, "cardio");
  const atMiddle = addTrainingBlock(start, "cardio", { atIndex: 1, idFactory: gen }).session;
  assert.equal(atMiddle.blocks[1].category, "cardio");
  const atEnd = addTrainingBlock(start, "cardio", { idFactory: gen }).session;
  assert.equal(atEnd.blocks[2].category, "cardio");
  assert.deepEqual(positions(atMiddle), [0, 1, 2]);
});

// ────────────────────────────────── DUPLICATION ─────────────────────────
test("duplication — bloc strength : nouvel id bloc + nouveaux ids exercices, source intacte", () => {
  const gen = makeGen();
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0), adminEx(P_EX_2, 1)])]);
  const { session, blockId } = duplicateTrainingBlock(start, P_BLOCK_A, { idFactory: gen });
  assert.equal(session.blocks.length, 2);
  const copy = session.blocks[1] as StrengthTrainingBlock;
  assert.match(copy.id, /^new-block:/);
  assert.notEqual(copy.id, P_BLOCK_A);
  for (const ex of copy.exercises) assert.match(ex.id, /^new-exercise:/);
  assert.notEqual(copy.exercises[0].id, P_EX_1, "UUID persisté source jamais réutilisé");
  // source intacte
  const src = start.blocks[0] as StrengthTrainingBlock;
  assert.equal(src.exercises[0].id, P_EX_1);
  assert.equal(start.blocks.length, 1, "séance source non mutée");
  assert.equal(blockId, copy.id);
});

test("duplication — bloc cardio : nouvel id + prescriptions copiées, colorKey préservée", () => {
  const gen = makeGen();
  const src = cardioBlock(P_BLOCK_A, 0, "purple");
  src.prescriptions = [{ id: P_EX_1, order: 0, segmentType: "single", title: "Run", intensityTargetType: "free" }];
  const { session } = duplicateTrainingBlock(builder([src]), P_BLOCK_A, { idFactory: gen });
  const copy = session.blocks[1] as CardioTrainingBlock;
  assert.match(copy.id, /^new-block:/);
  assert.equal(copy.colorKey, "purple", "colorKey préservée à la duplication");
  assert.equal(copy.prescriptions.length, 1, "prescriptions copiées");
  assert.notEqual(copy.prescriptions[0].id, P_EX_1, "id de prescription régénéré (pas de partage)");
});

// ────────────────────────────── DÉPLACEMENT DE BLOCS ────────────────────
test("déplacement — Monter/Descendre conservent les UUID, positions 0-based", () => {
  const start = builder([cardioBlock(P_BLOCK_A, 0), strengthBlock(P_BLOCK_B, 1)]);
  const down = moveTrainingBlock(start, P_BLOCK_A, "down");
  assert.deepEqual(ids(down), [P_BLOCK_B, P_BLOCK_A], "ids conservés, ordre inversé");
  assert.deepEqual(positions(down), [0, 1]);
  const up = moveTrainingBlock(down, P_BLOCK_A, "up");
  assert.deepEqual(ids(up), [P_BLOCK_A, P_BLOCK_B]);
});

test("déplacement — reorder premier→dernier et dernier→premier", () => {
  const start = builder([cardioBlock("00000000-0000-4000-8000-000000000101", 0), strengthBlock("00000000-0000-4000-8000-000000000102", 1), cardioBlock("00000000-0000-4000-8000-000000000103", 2)]);
  const firstToLast = reorderTrainingBlocks(start, 0, 2);
  assert.deepEqual(categories(firstToLast), ["strength", "cardio", "cardio"]);
  const lastToFirst = reorderTrainingBlocks(start, 2, 0);
  assert.deepEqual(categories(lastToFirst), ["cardio", "cardio", "strength"]);
  assert.deepEqual(positions(lastToFirst), [0, 1, 2]);
});

test("déplacement — deux blocs successifs de même catégorie autorisés (aucun regroupement)", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0), cardioBlock(P_BLOCK_B, 1), strengthBlock("00000000-0000-4000-8000-000000000201", 2)]);
  // Amener le cardio en tête → S/S adjacents conservés, jamais fusionnés.
  const moved = reorderTrainingBlocks(start, 1, 0);
  assert.deepEqual(categories(moved), ["cardio", "strength", "strength"]);
});

test("déplacement — S/C/S constructible et ré-ordonnable librement", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0), cardioBlock(P_BLOCK_B, 1), strengthBlock("00000000-0000-4000-8000-000000000301", 2)]);
  assert.deepEqual(categories(start), ["strength", "cardio", "strength"]);
  const moved = moveTrainingBlock(start, P_BLOCK_B, "up");
  assert.deepEqual(categories(moved), ["cardio", "strength", "strength"]);
});

// ──────────────────────────────────── EXERCICES ─────────────────────────
test("exercices — ajout dans un bloc strength (id new-exercise), order recalculé", () => {
  const gen = makeGen();
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0)])]);
  const { session, exerciseId } = addStrengthExercise(start, P_BLOCK_A, { idFactory: gen });
  assert.match(exerciseId!, /^new-exercise:/);
  const block = session.blocks[0] as StrengthTrainingBlock;
  assert.equal(block.exercises.length, 2);
  assert.equal(block.exercises[1].order, 1);
});

test("exercices — duplication avec nouvel id temporaire", () => {
  const gen = makeGen();
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0)])]);
  const { session, exerciseId } = duplicateStrengthExercise(start, P_BLOCK_A, P_EX_1, { idFactory: gen });
  const block = session.blocks[0] as StrengthTrainingBlock;
  assert.equal(block.exercises.length, 2);
  assert.match(exerciseId!, /^new-exercise:/);
  assert.notEqual(exerciseId, P_EX_1);
});

test("exercices — mise à jour d'un champ : id préservé, autres exercices intacts", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0, "Squat"), adminEx(P_EX_2, 1, "Rowing")])]);
  const out = updateStrengthExercise(start, P_BLOCK_A, P_EX_1, { reps: "5", sets: 5 });
  const block = out.blocks[0] as StrengthTrainingBlock;
  assert.equal(block.exercises[0].id, P_EX_1, "id conservé");
  assert.equal(block.exercises[0].reps, "5");
  assert.equal(block.exercises[0].sets, 5);
  assert.equal(block.exercises[1].name, "Rowing", "autre exercice intact");
});

test("exercices — réordonnancement dans le bloc", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0, "A"), adminEx(P_EX_2, 1, "B")])]);
  const moved = moveStrengthExercise(start, P_BLOCK_A, P_EX_2, "up");
  const block = moved.blocks[0] as StrengthTrainingBlock;
  assert.deepEqual(block.exercises.map((e) => e.id), [P_EX_2, P_EX_1]);
  assert.deepEqual(block.exercises.map((e) => e.order), [0, 1]);
});

test("exercices — déplacement inter-blocs strength : id conservé, order recalculé, blocs immuables", () => {
  const start = builder([
    strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0), adminEx(P_EX_2, 1)]),
    strengthBlock(P_BLOCK_B, 1, []),
  ]);
  const moved = moveExerciseBetweenStrengthBlocks(start, P_BLOCK_A, P_BLOCK_B, P_EX_1);
  const from = moved.blocks[0] as StrengthTrainingBlock;
  const to = moved.blocks[1] as StrengthTrainingBlock;
  assert.deepEqual(from.exercises.map((e) => e.id), [P_EX_2], "retiré du bloc source");
  assert.deepEqual(to.exercises.map((e) => e.id), [P_EX_1], "inséré dans le bloc cible");
  assert.equal(to.exercises[0].id, P_EX_1, "UUID de l'exercice CONSERVÉ (feedback non détaché)");
  assert.deepEqual(from.exercises.map((e) => e.order), [0], "order recalculé côté source");
  // immuabilité : la séance de départ est intacte
  const startFrom = start.blocks[0] as StrengthTrainingBlock;
  assert.equal(startFrom.exercises.length, 2, "bloc source d'origine non muté");
});

test("exercices — déplacement vers un bloc cardio refusé (no-op)", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0)]), cardioBlock(P_BLOCK_B, 1)]);
  const out = moveExerciseBetweenStrengthBlocks(start, P_BLOCK_A, P_BLOCK_B, P_EX_1);
  assert.equal(out, start, "cible non-strength → aucune modification");
});

test("exercices — reorder par index (drag) sans mutation en place", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0), adminEx(P_EX_2, 1), adminEx("00000000-0000-4000-8000-0000000000e3", 2)])]);
  const out = reorderStrengthExercises(start, P_BLOCK_A, 0, 2);
  const block = out.blocks[0] as StrengthTrainingBlock;
  assert.deepEqual(block.exercises.map((e) => e.id), [P_EX_2, "00000000-0000-4000-8000-0000000000e3", P_EX_1]);
  const startBlock = start.blocks[0] as StrengthTrainingBlock;
  assert.equal(startBlock.exercises[0].id, P_EX_1, "source non mutée");
});

// ────────────────────────────── SUPPRESSION ET REPOS ────────────────────
test("suppression — un bloc parmi plusieurs, positions renormalisées", () => {
  const start = builder([cardioBlock(P_BLOCK_A, 0), strengthBlock(P_BLOCK_B, 1)]);
  const out = removeTrainingBlock(start, P_BLOCK_A);
  assert.deepEqual(ids(out), [P_BLOCK_B]);
  assert.deepEqual(positions(out), [0]);
  assert.equal(out.isRestDay, false);
});

test("suppression — dernier bloc → repos (type rest, isRestDay=true)", () => {
  const start = builder([strengthBlock(P_BLOCK_A, 0)]);
  const out = removeTrainingBlock(start, P_BLOCK_A);
  assert.equal(out.blocks.length, 0);
  assert.equal(out.isRestDay, true);
  assert.equal(deriveBuilderSessionState(out).type, "rest");
});

test("repos — ajout après repos : isRestDay=false, type recalculé", () => {
  const gen = makeGen();
  const rest = builder([]);
  assert.equal(rest.isRestDay, true);
  const out = addTrainingBlock(rest, "strength", { idFactory: gen }).session;
  assert.equal(out.isRestDay, false);
  assert.equal(deriveBuilderSessionState(out).type, "strength");
});

// ──────────────────────────────── TYPE GLOBAL ───────────────────────────
test("type global — strength / cardio / mixed / rest dérivés, jamais de catégorie mixed", () => {
  assert.equal(deriveBuilderSessionState(builder([strengthBlock(P_BLOCK_A, 0)])).type, "strength");
  assert.equal(deriveBuilderSessionState(builder([cardioBlock(P_BLOCK_A, 0)])).type, "cardio");
  assert.equal(deriveBuilderSessionState(builder([strengthBlock(P_BLOCK_A, 0), cardioBlock(P_BLOCK_B, 1)])).type, "mixed");
  assert.equal(deriveBuilderSessionState(builder([])).type, "rest");
  const cats = categories(builder([strengthBlock(P_BLOCK_A, 0), cardioBlock(P_BLOCK_B, 1)]));
  assert.ok(cats.every((c) => c === "strength" || c === "cardio"), "aucune catégorie mixed dans les blocs");
});

// ─────────────────────────────────── COULEURS ───────────────────────────
test("couleurs — chaque colorKey autorisée acceptée", () => {
  for (const key of BLOCK_COLOR_KEYS) {
    assert.equal(isBlockColorKey(key), true);
    const out = updateBlockColor(builder([strengthBlock(P_BLOCK_A, 0)]), P_BLOCK_A, key);
    assert.equal(out.blocks[0].colorKey, key);
  }
});

test("couleurs — valeur non autorisée rejetée/normalisée avant RPC", () => {
  assert.equal(normalizeColorKey("hotpink"), "gray");
  assert.equal(normalizeColorKey("#ff0000"), "gray");
  assert.equal(normalizeColorKey(undefined), "gray");
  const out = updateBlockColor(builder([cardioBlock(P_BLOCK_A, 0)]), P_BLOCK_A, "not-a-color");
  assert.equal(out.blocks[0].colorKey, "blue", "cardio → défaut catégorie");
});

test("couleurs — colorKey conservée après duplication et après déplacement", () => {
  const gen = makeGen();
  const start = builder([strengthBlock(P_BLOCK_A, 0, [], "green"), cardioBlock(P_BLOCK_B, 1, "red")]);
  const dup = duplicateTrainingBlock(start, P_BLOCK_A, { idFactory: gen }).session;
  assert.equal(dup.blocks[1].colorKey, "green", "couleur conservée à la duplication");
  const moved = moveTrainingBlock(start, P_BLOCK_B, "up");
  assert.equal(moved.blocks[0].colorKey, "red", "couleur conservée au déplacement");
});

// ─────────────────── DUPLICATION SÉANCE / SEMAINE ENTIÈRE ───────────────
test("duplication séance — tous les ids régénérés, source intacte, contenu/ordre préservés", () => {
  const gen = makeGen();
  const source = builder([
    strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0, "Squat")]),
    cardioBlock(P_BLOCK_B, 1, "green"),
  ]);
  const clones = regenerateBlockIdsForDuplication(source.blocks, gen);
  // Tous les ids de blocs régénérés (aucun UUID source réutilisé).
  assert.match(clones[0].id, /^new-block:/);
  assert.match(clones[1].id, /^new-block:/);
  assert.notEqual(clones[0].id, P_BLOCK_A);
  assert.notEqual(clones[1].id, P_BLOCK_B);
  // Exercices régénérés.
  const clonedStrength = clones[0] as StrengthTrainingBlock;
  assert.match(clonedStrength.exercises[0].id, /^new-exercise:/);
  assert.equal(clonedStrength.exercises[0].name, "Squat", "contenu préservé");
  // Ordre + catégories préservés, positions 0-based.
  assert.deepEqual(clones.map((b) => b.category), ["strength", "cardio"]);
  assert.deepEqual(clones.map((b) => b.position), [0, 1]);
  assert.equal(clones[1].colorKey, "green", "couleur préservée");
  // Source intacte.
  assert.equal((source.blocks[0] as StrengthTrainingBlock).exercises[0].id, P_EX_1);
  assert.equal(source.blocks[0].id, P_BLOCK_A);
});

// ─────────────────────── DRAG — reorderTrainingBlocksById ───────────────
const ID_A = "00000000-0000-4000-8000-00000000000a";
const ID_B = "00000000-0000-4000-8000-00000000000b";
const ID_C = "00000000-0000-4000-8000-00000000000c";
const ID_D = "00000000-0000-4000-8000-00000000000d";
function abcd(): BuilderWorkoutSession {
  return builder([cardioBlock(ID_A, 0), strengthBlock(ID_B, 1), cardioBlock(ID_C, 2), strengthBlock(ID_D, 3)]);
}

test("drag — dépose AVANT une cible (source avant destination)", () => {
  const out = reorderTrainingBlocksById(abcd(), ID_A, ID_C, "before");
  assert.deepEqual(ids(out), [ID_B, ID_A, ID_C, ID_D]);
  assert.deepEqual(positions(out), [0, 1, 2, 3]);
});
test("drag — dépose APRÈS une cible (source avant destination)", () => {
  const out = reorderTrainingBlocksById(abcd(), ID_A, ID_C, "after");
  assert.deepEqual(ids(out), [ID_B, ID_C, ID_A, ID_D]);
});
test("drag — dépose AVANT une cible (source après destination)", () => {
  const out = reorderTrainingBlocksById(abcd(), ID_D, ID_B, "before");
  assert.deepEqual(ids(out), [ID_A, ID_D, ID_B, ID_C]);
});
test("drag — dépose APRÈS une cible (source après destination)", () => {
  const out = reorderTrainingBlocksById(abcd(), ID_D, ID_B, "after");
  assert.deepEqual(ids(out), [ID_A, ID_B, ID_D, ID_C]);
});
test("drag — drop sur soi-même : no-op", () => {
  const start = abcd();
  assert.equal(reorderTrainingBlocksById(start, ID_B, ID_B, "before"), start);
});
test("drag — id source inexistant : no-op", () => {
  const start = abcd();
  assert.equal(reorderTrainingBlocksById(start, "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz", ID_B, "before"), start);
});
test("drag — id cible inexistant : no-op", () => {
  const start = abcd();
  assert.equal(reorderTrainingBlocksById(start, ID_A, "zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz", "after"), start);
});
test("drag — premier vers dernier / dernier vers premier", () => {
  assert.deepEqual(ids(reorderTrainingBlocksById(abcd(), ID_A, ID_D, "after")), [ID_B, ID_C, ID_D, ID_A]);
  assert.deepEqual(ids(reorderTrainingBlocksById(abcd(), ID_D, ID_A, "before")), [ID_D, ID_A, ID_B, ID_C]);
});
test("drag — deux blocs de même catégorie adjacents, aucun regroupement", () => {
  const s = builder([strengthBlock(ID_A, 0), strengthBlock(ID_B, 1)]);
  const out = reorderTrainingBlocksById(s, ID_B, ID_A, "before");
  assert.deepEqual(ids(out), [ID_B, ID_A]);
  assert.deepEqual(categories(out), ["strength", "strength"]);
});
test("drag — C/S/C et S/C/S préservés (aucun tri par catégorie), UUID conservés", () => {
  const out = reorderTrainingBlocksById(abcd(), ID_C, ID_A, "before"); // C/S/C/S → C,C,S,S ? non : place C(id C) avant A
  assert.deepEqual(ids(out), [ID_C, ID_A, ID_B, ID_D], "ids conservés, ordre libre");
  assert.deepEqual(positions(out), [0, 1, 2, 3], "positions 0-based");
});
test("drag — tableau source inchangé (immuabilité)", () => {
  const start = abcd();
  const before = ids(start);
  reorderTrainingBlocksById(start, ID_A, ID_D, "after");
  assert.deepEqual(ids(start), before, "séance source non mutée");
});
test("drag — bornes : un seul bloc / liste vide", () => {
  const single = builder([cardioBlock(ID_A, 0)]);
  assert.equal(reorderTrainingBlocksById(single, ID_A, ID_A, "before"), single);
  const empty = builder([]);
  assert.equal(reorderTrainingBlocksById(empty, ID_A, ID_B, "after"), empty);
});

test("drag — getBlockDropPlacement : avant/après le milieu de la carte", () => {
  // rectTop=100, height=40 → milieu=120.
  assert.equal(getBlockDropPlacement(110, 100, 40), "before");
  assert.equal(getBlockDropPlacement(130, 100, 40), "after");
  assert.equal(getBlockDropPlacement(120, 100, 40), "after", "au milieu → after (>=)");
});

// ─────────────────── ANALYSE — strengthExercisesFromBlocks (Lot 4.5) ─────
test("analyse — aplati les exercices des blocs strength dans l'ordre, ignore le cardio", () => {
  const s = builder([
    strengthBlock(P_BLOCK_A, 0, [adminEx(P_EX_1, 0, "Squat")]),
    cardioBlock(P_BLOCK_B, 1),
    strengthBlock("00000000-0000-4000-8000-0000000000s9", 2, [adminEx(P_EX_2, 0, "Bench")]),
  ]);
  const ex = strengthExercisesFromBlocks(s.blocks);
  assert.deepEqual(ex.map((e) => e.name), ["Squat", "Bench"], "ordre des blocs, cardio ignoré, jamais session.exercises");
  assert.equal(strengthExercisesFromBlocks(builder([cardioBlock(P_BLOCK_A, 0)]).blocks).length, 0, "aucun bloc strength → vide");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
