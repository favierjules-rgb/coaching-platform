// Tests unitaires PURS du modèle multi-blocs (chantier
// feature/multi-block-training-sessions, Lot 3A). Aucun accès réseau, aucune
// base : uniquement les helpers de lib/training-blocks.ts.
//
// Couvre ce que le harnais peut réellement prouver au niveau TypeScript :
// parsing STRICT des identifiants de blocs, dérivation du type de séance,
// renormalisation 0-based des positions, réordonnancement pur, et projection
// de lecture compatible. La preuve de l'atomicité / des cascades / des
// autorisations relève des tests d'intégration SQL (RPC), pas de ce fichier.

import assert from "node:assert/strict";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deriveSessionType,
  isUuid,
  makeLegacyStrengthBlockId,
  moveBlockDown,
  moveBlockUp,
  parseTrainingBlockId,
  parseTrainingExerciseId,
  renumberBlockPositions,
  toOrderedBlocks,
} from "@/lib/training-blocks";
import { saveTrainingSessionBlocks } from "@/lib/supabase/training-session-blocks";
import type { CardioTrainingBlock, StrengthTrainingBlock, TrainingBlock } from "@/types";
import type { Database } from "@/types/supabase";

const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const CLIENT_UUID = "33333333-3333-4333-8333-333333333333";

function strengthBlock(id: string, position: number): StrengthTrainingBlock {
  return { id, category: "strength", position, title: null, colorKey: "gray", exercises: [] };
}
function cardioBlock(id: string, position: number): CardioTrainingBlock {
  return { id, category: "cardio", position, title: null, colorKey: "blue", cardioType: "easy_run", prescriptions: [] };
}

let passed = 0;
let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`❌ ${name}`);
    console.error(error);
  }
}

// ── deriveSessionType (signature à un seul argument) ────────────────────
test("deriveSessionType — aucun bloc → rest", () => {
  assert.equal(deriveSessionType([]), "rest");
});
test("deriveSessionType — strength seul → strength", () => {
  assert.equal(deriveSessionType([strengthBlock("a", 0)]), "strength");
});
test("deriveSessionType — cardio seul → cardio", () => {
  assert.equal(deriveSessionType([cardioBlock("a", 0)]), "cardio");
});
test("deriveSessionType — strength + cardio → mixed", () => {
  assert.equal(deriveSessionType([cardioBlock("a", 0), strengthBlock("b", 1), cardioBlock("c", 2)]), "mixed");
});

// ── isUuid ──────────────────────────────────────────────────────────────
test("isUuid — vrai UUID / faux positifs rejetés", () => {
  assert.equal(isUuid(SESSION_UUID), true);
  assert.equal(isUuid("pas-un-uuid"), false);
  assert.equal(isUuid("blk-1721680000000-5"), false);
  assert.equal(isUuid(""), false);
});

// ── parseTrainingBlockId — format STRICT ────────────────────────────────
test("parseTrainingBlockId — UUID persisté", () => {
  assert.deepEqual(parseTrainingBlockId(SESSION_UUID, SESSION_UUID), { kind: "persisted", id: SESSION_UUID });
  // Un UUID quelconque est "persisted" au parsing ; l'appartenance réelle à
  // la séance est vérifiée par la RPC (le parseur ne connaît pas la base).
  assert.deepEqual(parseTrainingBlockId(OTHER_UUID, SESSION_UUID), { kind: "persisted", id: OTHER_UUID });
});
test("parseTrainingBlockId — legacy-strength valide", () => {
  assert.deepEqual(parseTrainingBlockId(makeLegacyStrengthBlockId(SESSION_UUID), SESSION_UUID), {
    kind: "legacy-strength",
    sessionId: SESSION_UUID,
  });
});
test("parseTrainingBlockId — legacy pour une AUTRE séance → rejet", () => {
  assert.throws(() => parseTrainingBlockId(makeLegacyStrengthBlockId(OTHER_UUID), SESSION_UUID), /autre séance/);
});
test("parseTrainingBlockId — legacy suffixe non-UUID → rejet", () => {
  assert.throws(() => parseTrainingBlockId("legacy-strength:pas-un-uuid", SESSION_UUID), /non-UUID/);
});
test("parseTrainingBlockId — new-block valide", () => {
  assert.deepEqual(parseTrainingBlockId(`new-block:${CLIENT_UUID}`, SESSION_UUID), { kind: "new", clientId: CLIENT_UUID });
});
test("parseTrainingBlockId — new-block suffixe non-UUID → rejet", () => {
  assert.throws(() => parseTrainingBlockId("new-block:123", SESSION_UUID), /non-UUID/);
});
test("parseTrainingBlockId — ancien format generateId → rejet", () => {
  assert.throws(() => parseTrainingBlockId("blk-1721680000000-5", SESSION_UUID), /non reconnu/);
});
test("parseTrainingBlockId — chaîne inconnue → rejet", () => {
  assert.throws(() => parseTrainingBlockId("nimporte quoi", SESSION_UUID), /non reconnu/);
});

// ── renumberBlockPositions — 0-based commun ─────────────────────────────
test("renumberBlockPositions — séquence 0..n-1 dans l'ordre du tableau", () => {
  const blocks: TrainingBlock[] = [cardioBlock("a", 7), strengthBlock("b", 3), cardioBlock("c", 99)];
  const renum = renumberBlockPositions(blocks);
  assert.deepEqual(
    renum.map((b) => b.position),
    [0, 1, 2],
  );
  // ordre préservé, seules les positions changent
  assert.deepEqual(
    renum.map((b) => b.id),
    ["a", "b", "c"],
  );
});

// ── moveBlockUp / moveBlockDown — pur, avec renormalisation ─────────────
test("moveBlockUp — déplace et renormalise (0-based)", () => {
  const blocks: TrainingBlock[] = [cardioBlock("run", 0), strengthBlock("press", 1), cardioBlock("ski", 2)];
  const moved = moveBlockUp(blocks, "press");
  assert.deepEqual(
    moved.map((b) => b.id),
    ["press", "run", "ski"],
  );
  assert.deepEqual(
    moved.map((b) => b.position),
    [0, 1, 2],
  );
});
test("moveBlockUp — premier bloc : no-op (positions renormalisées)", () => {
  const blocks: TrainingBlock[] = [cardioBlock("a", 5), strengthBlock("b", 9)];
  const moved = moveBlockUp(blocks, "a");
  assert.deepEqual(moved.map((b) => b.id), ["a", "b"]);
  assert.deepEqual(moved.map((b) => b.position), [0, 1]);
});
test("moveBlockDown — déplace et renormalise", () => {
  const blocks: TrainingBlock[] = [cardioBlock("a", 0), strengthBlock("b", 1), cardioBlock("c", 2)];
  const moved = moveBlockDown(blocks, "a");
  assert.deepEqual(moved.map((b) => b.id), ["b", "a", "c"]);
  assert.deepEqual(moved.map((b) => b.position), [0, 1, 2]);
});

// ── toOrderedBlocks — projection compatible (lecture) ───────────────────
test("toOrderedBlocks — muscu héritée → bloc legacy en tête, id conventionnel, 0-based", () => {
  const blocks = toOrderedBlocks({
    id: SESSION_UUID,
    exercises: [
      { id: "e2", order: 2, name: "B", sets: 3, reps: "8", restSeconds: 60, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" },
      { id: "e1", order: 1, name: "A", sets: 3, reps: "8", restSeconds: 60, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" },
    ],
    cardioBlocks: [],
  });
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].category, "strength");
  assert.equal(blocks[0].id, makeLegacyStrengthBlockId(SESSION_UUID));
  assert.equal(blocks[0].position, 0);
  // exercices triés par order
  assert.deepEqual((blocks[0] as StrengthTrainingBlock).exercises.map((e) => e.id), ["e1", "e2"]);
});
test("toOrderedBlocks — séance vide → aucun bloc (rest)", () => {
  const blocks = toOrderedBlocks({ id: SESSION_UUID, exercises: [], cardioBlocks: [] });
  assert.equal(blocks.length, 0);
  assert.equal(deriveSessionType(blocks), "rest");
});

// ── parseTrainingExerciseId ─────────────────────────────────────────────
test("parseTrainingExerciseId — UUID persisté", () => {
  assert.deepEqual(parseTrainingExerciseId(SESSION_UUID), { kind: "persisted", id: SESSION_UUID });
});
test("parseTrainingExerciseId — new-exercise valide", () => {
  assert.deepEqual(parseTrainingExerciseId(`new-exercise:${CLIENT_UUID}`), { kind: "new", clientId: CLIENT_UUID });
});
test("parseTrainingExerciseId — new-exercise suffixe non-UUID → rejet", () => {
  assert.throws(() => parseTrainingExerciseId("new-exercise:42"), /non-UUID/);
});
test("parseTrainingExerciseId — ancien format / chaîne inconnue → rejet", () => {
  assert.throws(() => parseTrainingExerciseId("ex-1721680000000-3"), /non reconnu/);
  assert.throws(() => parseTrainingExerciseId("new-block:" + CLIENT_UUID), /non reconnu/);
});

// ── Wrapper saveTrainingSessionBlocks — un seul .rpc, aucun .from ────────
type RpcCall = { fn: string; args: Record<string, unknown> };
function makeFakeSupabase(opts: { result?: unknown; error?: { message: string } | null }) {
  const calls: { rpc: RpcCall[]; from: number } = { rpc: [], from: 0 };
  const fake = {
    rpc(fn: string, args: Record<string, unknown>) {
      calls.rpc.push({ fn, args });
      return Promise.resolve({ data: opts.result ?? null, error: opts.error ?? null });
    },
    from() {
      calls.from += 1;
      throw new Error("le wrapper ne doit JAMAIS appeler .from()");
    },
  };
  return { db: fake as unknown as SupabaseClient<Database>, calls };
}

const RPC_OK = {
  session_id: SESSION_UUID,
  updated_at: "2026-07-22T10:00:00.000Z",
  session_type: "mixed",
  blocks: [],
  id_mapping: { blocks: { [`new-block:${CLIENT_UUID}`]: OTHER_UUID }, exercises: {} },
  warnings: { detached_exercise_feedback_count: 2 },
};

async function atest(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    console.error(`❌ ${name}`);
    console.error(error);
  }
}

async function runAsync() {
  await atest("wrapper — happy path : 1 seul .rpc, aucun .from, résultat mappé", async () => {
    const { db, calls } = makeFakeSupabase({ result: RPC_OK });
    const res = await saveTrainingSessionBlocks(db, {
      sessionId: SESSION_UUID,
      expectedUpdatedAt: "2026-07-22T09:00:00.000Z",
      blocks: [cardioBlock(OTHER_UUID, 0), strengthBlock(`new-block:${CLIENT_UUID}`, 1)],
    });
    assert.equal(calls.rpc.length, 1, "exactement un appel .rpc");
    assert.equal(calls.from, 0, "aucun appel .from");
    assert.equal(calls.rpc[0].fn, "save_training_session_blocks");
    const payload = calls.rpc[0].args.p_payload as Record<string, unknown>;
    assert.equal(payload.session_id, SESSION_UUID);
    assert.equal(payload.expected_updated_at, "2026-07-22T09:00:00.000Z");
    assert.ok(Array.isArray(payload.blocks));
    // résultat correctement lu
    assert.equal(res.updatedAt, "2026-07-22T10:00:00.000Z");
    assert.equal(res.sessionType, "mixed");
    assert.equal(res.warnings.detachedExerciseFeedbackCount, 2);
    assert.equal(res.idMapping.blocks[`new-block:${CLIENT_UUID}`], OTHER_UUID);
  });

  await atest("wrapper — expectedUpdatedAt manquant → rejet AVANT tout appel réseau", async () => {
    const { db, calls } = makeFakeSupabase({ result: RPC_OK });
    await assert.rejects(
      () => saveTrainingSessionBlocks(db, { sessionId: SESSION_UUID, expectedUpdatedAt: "", blocks: [] }),
      /obligatoire/,
    );
    assert.equal(calls.rpc.length, 0, "aucun appel réseau si le payload est invalide");
  });

  await atest("wrapper — id de bloc mal formé → rejet avant .rpc", async () => {
    const { db, calls } = makeFakeSupabase({ result: RPC_OK });
    await assert.rejects(
      () =>
        saveTrainingSessionBlocks(db, {
          sessionId: SESSION_UUID,
          expectedUpdatedAt: "v",
          blocks: [strengthBlock("blk-1721680000000-5", 0)],
        }),
      /non reconnu/,
    );
    assert.equal(calls.rpc.length, 0);
  });

  await atest("wrapper — id de bloc en double → rejet", async () => {
    const { db } = makeFakeSupabase({ result: RPC_OK });
    await assert.rejects(
      () =>
        saveTrainingSessionBlocks(db, {
          sessionId: SESSION_UUID,
          expectedUpdatedAt: "v",
          blocks: [cardioBlock(OTHER_UUID, 0), cardioBlock(OTHER_UUID, 1)],
        }),
      /en double/,
    );
  });

  await atest("wrapper — erreur RPC (ex. STALE) propagée", async () => {
    const { db } = makeFakeSupabase({ error: { message: "STALE_TRAINING_SESSION" } });
    await assert.rejects(
      () => saveTrainingSessionBlocks(db, { sessionId: SESSION_UUID, expectedUpdatedAt: "v", blocks: [] }),
      /STALE_TRAINING_SESSION/,
    );
  });

  console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
  if (failed > 0) process.exit(1);
}

void runAsync();
