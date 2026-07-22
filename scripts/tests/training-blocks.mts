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
import {
  buildCanonicalSessionBlocksInput,
  buildLegacySessionBlocksInput,
  saveTrainingSessionBlocks,
} from "@/lib/supabase/training-session-blocks";
import { createProgram, updateProgram } from "@/lib/supabase/programs";
import { nextBuilderState, orchestrateBuilderSave } from "@/lib/admin-builder-save";
import type { ProgramBuilderData } from "@/components/admin/ProgramBuilder";
import type { AdminProgram } from "@/types";
import type {
  AdminCardioBlock,
  AdminExercise,
  AdminWorkoutSession,
  CardioTrainingBlock,
  StrengthTrainingBlock,
  TrainingBlock,
} from "@/types";
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

// ── Adaptateurs legacy / canonique (Lot 3B — source EXPLICITE) ────────────
function adminEx(id: string, order: number): AdminExercise {
  return { id, order, name: "Ex", sets: 4, reps: "8", restSeconds: 60, tempo: "", recommendedLoad: "", videoUrl: "", notes: "" };
}
function adminCardio(id: string, order: number): AdminCardioBlock {
  return { id, order, title: "", cardioType: "easy_run", segments: [] };
}
// Invariant central : la sortie de l'adaptateur est TOUJOURS acceptée par la
// validation stricte de la RPC (aucun format arbitraire ne fuit).
function assertAllIdsStrict(input: { sessionId: string; blocks: TrainingBlock[] }): void {
  for (const block of input.blocks) {
    parseTrainingBlockId(block.id, input.sessionId);
    if (block.category === "strength") for (const ex of block.exercises) parseTrainingExerciseId(ex.id);
  }
}

test("legacy — création : placeholders → new-block/new-exercise, muscu → legacy-strength", () => {
  const input = buildLegacySessionBlocksInput({
    session: { exercises: [adminEx("ex-1721-1", 0), adminEx("ex-1721-2", 1)], cardioBlocks: [adminCardio("cardio-1721-1", 0)] },
    sessionId: SESSION_UUID,
    expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
  });
  assert.equal(input.sessionId, SESSION_UUID);
  assert.equal(input.expectedUpdatedAt, "2020-01-01T00:00:00.000Z");
  assert.equal(input.blocks.length, 2);
  const [strength, cardio] = input.blocks;
  assert.equal(strength.id, makeLegacyStrengthBlockId(SESSION_UUID));
  assert.equal(strength.position, 0);
  assert.equal((strength as StrengthTrainingBlock).exercises.every((e) => e.id.startsWith("new-exercise:")), true);
  assert.equal((strength as StrengthTrainingBlock).exercises.every((e) => isUuid(e.id.slice("new-exercise:".length))), true);
  assert.equal(cardio.category, "cardio");
  assert.equal(cardio.position, 1);
  assert.equal(cardio.id.startsWith("new-block:"), true);
  assertAllIdsStrict(input);
});

test("legacy — mise à jour : UUID réels conservés + strengthBlockId + sessionPatch", () => {
  const input = buildLegacySessionBlocksInput({
    session: { exercises: [adminEx(OTHER_UUID, 0)], cardioBlocks: [adminCardio(CLIENT_UUID, 0)] },
    sessionId: SESSION_UUID,
    expectedUpdatedAt: "u0",
    strengthBlockId: CLIENT_UUID,
    sessionPatch: { name: "Séance A", muscleGroup: "dos" },
  });
  const strength = input.blocks[0] as StrengthTrainingBlock;
  const cardio = input.blocks[1] as CardioTrainingBlock;
  assert.equal(strength.id, CLIENT_UUID); // bloc muscu existant conservé (id fourni)
  assert.equal(strength.exercises[0].id, OTHER_UUID); // id d'exercice existant conservé
  assert.equal(cardio.id, CLIENT_UUID); // id de bloc cardio existant conservé
  assert.equal(input.expectedUpdatedAt, "u0"); // chaîne exacte du snapshot
  assert.equal(input.sessionPatch?.name, "Séance A");
  assertAllIdsStrict(input);
});

// RÉGRESSION (point 1) : un session.blocks OBSOLÈTE doit être IGNORÉ ; la sortie
// reflète exercises[]/cardioBlocks[] modifiés dans le builder.
test("legacy — IGNORE un session.blocks obsolète (source = exercises/cardioBlocks)", () => {
  const staleBlocks: TrainingBlock[] = [cardioBlock(OTHER_UUID, 0), cardioBlock(CLIENT_UUID, 1), cardioBlock(SESSION_UUID, 2)];
  const session: Pick<AdminWorkoutSession, "exercises" | "cardioBlocks" | "blocks"> = {
    exercises: [adminEx("ex-modifie-1", 0)], // édition legacy récente
    cardioBlocks: [],
    blocks: staleBlocks, // ancien blocks[] (3 cardio) — ne doit PAS être utilisé
  };
  const input = buildLegacySessionBlocksInput({ session, sessionId: SESSION_UUID, expectedUpdatedAt: "v" });
  assert.equal(input.blocks.length, 1); // 1 bloc muscu (depuis exercises), pas 3 cardio
  assert.equal(input.blocks[0].category, "strength");
  assert.equal((input.blocks[0] as StrengthTrainingBlock).exercises.length, 1);
  assertAllIdsStrict(input);
});

test("canonical (Lot 4) — utilise blocks[] directement, ids normalisés", () => {
  const input = buildCanonicalSessionBlocksInput({
    sessionId: SESSION_UUID,
    expectedUpdatedAt: "v",
    blocks: [cardioBlock(OTHER_UUID, 0), strengthBlock("placeholder-client-id", 1)],
  });
  assert.equal(input.blocks.length, 2);
  assert.equal(input.blocks[0].id, OTHER_UUID); // UUID réel conservé
  assert.equal(input.blocks[1].id.startsWith("new-block:"), true); // placeholder normalisé
  assertAllIdsStrict(input);
});

test("legacy — séance vide (repos) → aucun bloc", () => {
  const input = buildLegacySessionBlocksInput({ session: { exercises: [], cardioBlocks: [] }, sessionId: SESSION_UUID, expectedUpdatedAt: "v" });
  assert.equal(input.blocks.length, 0);
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

// ── Fake Supabase FIDÈLE : teste le VRAI code câblé (createProgram/updateProgram) ──
interface FakeWrite {
  table: string;
  op: "insert" | "update" | "delete";
}
function makeProgramsFake(opts?: { store?: Record<string, Record<string, unknown>[]>; rpcError?: string }) {
  const store: Record<string, Record<string, unknown>[]> = opts?.store ?? {};
  const writes: FakeWrite[] = [];
  const rpcPayloads: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  let clock = 0;
  const nextTs = () => `2026-07-22T10:00:${String(clock++).padStart(2, "0")}.000Z`;
  const rows = (t: string) => (store[t] ??= []);
  const matches = (row: Record<string, unknown>, filters: { type: string; col: string; val: unknown }[]) =>
    filters.every((f) => (f.type === "in" ? (f.val as unknown[]).includes(row[f.col]) : row[f.col] === f.val));

  class B {
    op: "select" | "insert" | "update" | "delete" | null = null;
    payload: Record<string, unknown> | null = null;
    filters: { type: "eq" | "in"; col: string; val: unknown }[] = [];
    isSingle = false;
    constructor(public table: string) {}
    select() {
      if (!this.op) this.op = "select";
      return this;
    }
    insert(p: Record<string, unknown>) {
      this.op = "insert";
      this.payload = p;
      return this;
    }
    update(p: Record<string, unknown>) {
      this.op = "update";
      this.payload = p;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push({ type: "eq", col, val });
      return this;
    }
    in(col: string, val: unknown[]) {
      this.filters.push({ type: "in", col, val });
      return this;
    }
    single() {
      this.isSingle = true;
      return this;
    }
    then(resolve: (v: unknown) => void) {
      resolve(this.run());
    }
    run() {
      if (this.op === "insert") {
        writes.push({ table: this.table, op: "insert" });
        const row = { id: crypto.randomUUID(), updated_at: nextTs(), ...this.payload };
        rows(this.table).push(row);
        return { data: this.isSingle ? row : [row], error: null };
      }
      if (this.op === "update") {
        writes.push({ table: this.table, op: "update" });
        for (const r of rows(this.table)) if (matches(r, this.filters)) Object.assign(r, this.payload);
        return { data: null, error: null };
      }
      if (this.op === "delete") {
        writes.push({ table: this.table, op: "delete" });
        store[this.table] = rows(this.table).filter((r) => !matches(r, this.filters));
        return { data: null, error: null };
      }
      const found = rows(this.table).filter((r) => matches(r, this.filters));
      return { data: this.isSingle ? (found[0] ?? null) : found, error: null };
    }
  }

  const db = {
    from: (table: string) => new B(table),
    // RPC simulée : mappe les ids temporaires → UUID, PERSISTE un minimum (pour
    // permettre le rechargement / la double sauvegarde) et bumpe updated_at.
    rpc: (_fn: string, args: { p_payload: Record<string, unknown> }) => {
      const payload = args.p_payload;
      rpcPayloads.push(payload);
      if (opts?.rpcError) return Promise.resolve({ data: null, error: { message: opts.rpcError } });
      const blocksMap: Record<string, string> = {};
      const exMap: Record<string, string> = {};
      const sid = payload.session_id as string;
      store.training_blocks = (store.training_blocks ?? []).filter((b) => b.session_id !== sid);
      store.workout_exercises = (store.workout_exercises ?? []).filter((e) => e.session_id !== sid);
      const payloadBlocks =
        (payload.blocks as { id: string; category: string; exercises?: { id: string; name?: string }[] }[]) ?? [];
      for (const b of payloadBlocks) {
        const bid = isUuid(b.id) ? b.id : (blocksMap[b.id] = crypto.randomUUID());
        (store.training_blocks ??= []).push({ id: bid, session_id: sid, block_type: b.category });
        for (const e of b.exercises ?? []) {
          const eid = isUuid(e.id) ? e.id : (exMap[e.id] = crypto.randomUUID());
          (store.workout_exercises ??= []).push({ id: eid, session_id: sid, block_id: bid, name: e.name });
        }
      }
      const ts = nextTs();
      const srow = (store.workout_sessions ?? []).find((s) => s.id === sid);
      if (srow) srow.updated_at = ts;
      return Promise.resolve({
        data: {
          session_id: sid,
          updated_at: ts,
          session_type: "mixed",
          blocks: [],
          id_mapping: { blocks: blocksMap, exercises: exMap },
          warnings: { detached_exercise_feedback_count: 0 },
        },
        error: null,
      });
    },
  };
  return { db: db as unknown as SupabaseClient<Database>, writes, rpcPayloads, store };
}
const CONTENT_TABLES = ["workout_exercises", "training_blocks", "training_prescriptions"];
const contentWrites = (writes: FakeWrite[]) => writes.filter((w) => CONTENT_TABLES.includes(w.table));

function adminSession(over: Partial<AdminWorkoutSession> & { weekNumber: number; day: string }): AdminWorkoutSession {
  return {
    id: over.id ?? "sess-1721-1",
    programId: "prog",
    weekNumber: over.weekNumber,
    day: over.day,
    isRestDay: over.isRestDay ?? false,
    name: over.name ?? "Séance",
    muscleGroup: over.muscleGroup ?? "",
    durationMinutes: over.durationMinutes ?? 0,
    warmup: over.warmup ?? "",
    coachNotes: over.coachNotes ?? "",
    exercises: over.exercises ?? [],
    sessionType: over.sessionType,
    cardioBlocks: over.cardioBlocks ?? [],
    bannerUrl: over.bannerUrl ?? null,
    updatedAt: over.updatedAt,
  };
}
const baseProgramData = (sessions: AdminWorkoutSession[]): ProgramBuilderData => ({
  name: "P",
  goal: "",
  level: "",
  durationWeeks: 1,
  description: "",
  status: "brouillon",
  sessions,
});
function prog(id: string, updatedAt: string): AdminProgram {
  return {
    id,
    name: "P",
    goal: "",
    level: "",
    durationWeeks: 1,
    description: "",
    status: "brouillon",
    assignedStudentIds: [],
    sessions: [],
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt,
  };
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

  // ── VRAI code câblé : createProgram / updateProgram (Lot 3B, corrections) ──
  await atest("createProgram — 1 rpc/séance à contenu, source legacy, 0 écriture directe, pas de session_patch", async () => {
    const { db, writes, rpcPayloads } = makeProgramsFake();
    const session = adminSession({ weekNumber: 1, day: "lundi", exercises: [adminEx("ex-1721-1", 0)] });
    const id = await createProgram(db, baseProgramData([session]));
    assert.ok(id, "programme créé");
    assert.equal(rpcPayloads.length, 1, "un seul rpc (séance à contenu)");
    assert.equal(contentWrites(writes).length, 0, "aucune écriture directe des tables de contenu");
    const p = rpcPayloads[0];
    assert.equal((p.blocks[0].id as string).startsWith("legacy-strength:"), true, "bloc muscu legacy EXPLICITE");
    assert.equal((p.blocks[0].exercises[0].id as string).startsWith("new-exercise:"), true);
    assert.equal(p.session_patch, undefined, "pas de session_patch en création");
    assert.equal(typeof p.expected_updated_at, "string");
  });

  await atest("updateProgram — lock SNAPSHOT, session_patch, AUCUN update préalable, 0 écriture de contenu", async () => {
    const store = {
      program_weeks: [{ id: "week-1", program_id: "prog", week_number: 1 }],
      workout_sessions: [{ id: "55555555-5555-4555-8555-555555555501", program_week_id: "week-1", day: "lundi", updated_at: "u0-snapshot" }],
      training_blocks: [{ id: "55555555-5555-4555-8555-5555555555b1", session_id: "55555555-5555-4555-8555-555555555501", block_type: "strength" }],
    };
    const { db, writes, rpcPayloads } = makeProgramsFake({ store });
    const session = adminSession({
      id: "55555555-5555-4555-8555-555555555501",
      weekNumber: 1,
      day: "lundi",
      updatedAt: "u0-snapshot",
      name: "Modifié",
      exercises: [adminEx(OTHER_UUID, 0)],
    });
    const ok = await updateProgram(db, "prog", baseProgramData([session]));
    assert.equal(ok, true);
    assert.equal(rpcPayloads.length, 1);
    const p = rpcPayloads[0];
    assert.equal(p.expected_updated_at, "u0-snapshot", "expectedUpdatedAt vient du SNAPSHOT (pas d'une relecture)");
    assert.ok(p.session_patch, "session_patch envoyé");
    assert.equal(p.session_patch.name, "Modifié");
    assert.equal(p.blocks[0].id, "55555555-5555-4555-8555-5555555555b1", "bloc muscu existant conservé");
    assert.equal(p.blocks[0].exercises[0].id, OTHER_UUID, "exercice existant conservé");
    assert.equal(contentWrites(writes).length, 0, "aucune écriture directe des tables de contenu");
    assert.equal(
      writes.some((w) => w.table === "workout_sessions" && w.op === "update"),
      false,
      "AUCUN UPDATE préalable de la séance existante (le verrou n'est pas neutralisé)",
    );
  });

  await atest("updateProgram — STALE propagé, écritures des séances suivantes stoppées", async () => {
    const store = {
      program_weeks: [{ id: "week-1", program_id: "prog", week_number: 1 }],
      workout_sessions: [
        { id: "55555555-5555-4555-8555-555555555501", program_week_id: "week-1", day: "lundi", updated_at: "u0" },
        { id: "55555555-5555-4555-8555-555555555502", program_week_id: "week-1", day: "mardi", updated_at: "u0" },
      ],
      training_blocks: [],
    };
    const { db, rpcPayloads } = makeProgramsFake({ store, rpcError: "STALE_TRAINING_SESSION" });
    const sessions = [
      adminSession({ id: "55555555-5555-4555-8555-555555555501", weekNumber: 1, day: "lundi", updatedAt: "u0", exercises: [adminEx("ex-x", 0)] }),
      adminSession({ id: "55555555-5555-4555-8555-555555555502", weekNumber: 1, day: "mardi", updatedAt: "u0", exercises: [adminEx("ex-y", 0)] }),
    ];
    await assert.rejects(() => updateProgram(db, "prog", baseProgramData(sessions)), /STALE_TRAINING_SESSION/);
    assert.equal(rpcPayloads.length, 1, "arrêt au premier STALE (2e séance non sauvegardée)");
  });

  await atest("updateProgram — double sauvegarde avec rechargement : ids stables, aucune recréation", async () => {
    const store = {
      program_weeks: [{ id: "week-1", program_id: "prog", week_number: 1 }],
      workout_sessions: [{ id: "55555555-5555-4555-8555-555555555501", program_week_id: "week-1", day: "lundi", updated_at: "u0" }],
      training_blocks: [],
    };
    const { db, rpcPayloads, store: st } = makeProgramsFake({ store });
    // save1 : exercice NOUVEAU (placeholder)
    await updateProgram(
      db,
      "prog",
      baseProgramData([adminSession({ id: "55555555-5555-4555-8555-555555555501", weekNumber: 1, day: "lundi", updatedAt: "u0", exercises: [adminEx("ex-1721-1", 0)] })]),
    );
    assert.equal((rpcPayloads[0].blocks[0].exercises[0].id as string).startsWith("new-exercise:"), true, "save1 : id temporaire");
    // rechargement : la RPC fake a persisté les ids réels + bumpé updated_at
    const persistedEx = st.workout_exercises!.find((e) => e.session_id === "55555555-5555-4555-8555-555555555501")!;
    const persistedBlock = st.training_blocks!.find((b) => b.session_id === "55555555-5555-4555-8555-555555555501")!;
    const freshUpdatedAt = st.workout_sessions!.find((s) => s.id === "55555555-5555-4555-8555-555555555501")!.updated_at as string;
    // save2 : depuis l'état RECHARGÉ (ids réels + nouvel updatedAt)
    await updateProgram(
      db,
      "prog",
      baseProgramData([
        adminSession({ id: "55555555-5555-4555-8555-555555555501", weekNumber: 1, day: "lundi", updatedAt: freshUpdatedAt, exercises: [adminEx(persistedEx.id as string, 0)] }),
      ]),
    );
    const p2 = rpcPayloads[1];
    assert.equal(p2.expected_updated_at, freshUpdatedAt, "save2 utilise le nouvel updatedAt (aucun STALE)");
    assert.equal(p2.blocks[0].id, persistedBlock.id, "save2 : bloc muscu réutilisé (pas recréé)");
    assert.equal(p2.blocks[0].exercises[0].id, persistedEx.id, "save2 : exercice réutilisé (id stable)");
    assert.equal((p2.blocks[0].exercises[0].id as string).startsWith("new-exercise:"), false, "aucun id temporaire au 2e save");
  });

  // ── Orchestrateur de remount du builder (page, Lot 3B correction) ─────────
  await atest("remount — SUCCÈS : refetch OK → snapshot frais + révision +1 (un seul remount)", async () => {
    const outcome = await orchestrateBuilderSave({
      save: async () => true,
      refetch: async () => prog("prog-1", "u1"),
    });
    assert.equal(outcome.kind, "success");
    const next = nextBuilderState({ program: prog("prog-1", "u0"), revision: 0 }, outcome);
    assert.equal(next.revision, 1, "révision incrémentée → remount");
    assert.equal(next.program.updatedAt, "u1", "snapshot remplacé par la version fraîche");
  });

  await atest("remount — REFETCH EN ÉCHEC : aucune révision, snapshot inchangé, pas de remount", async () => {
    const outcome = await orchestrateBuilderSave({
      save: async () => true,
      refetch: async () => null, // refetch échoue / aucune donnée
    });
    assert.equal(outcome.kind, "refetch-failed");
    const before = { program: prog("prog-1", "u0"), revision: 3 };
    const next = nextBuilderState(before, outcome);
    assert.equal(next.revision, 3, "révision inchangée");
    assert.equal(next.program, before.program, "snapshot inchangé (pas de remount avec données incomplètes)");
  });

  await atest("remount — STALE : aucune révision, snapshot local conservé, non-succès", async () => {
    let refetched = false;
    const outcome = await orchestrateBuilderSave({
      save: async () => {
        throw new Error("saveTrainingSessionBlocks : STALE_TRAINING_SESSION");
      },
      refetch: async () => {
        refetched = true;
        return prog("prog-1", "u9");
      },
    });
    assert.equal(outcome.kind, "stale");
    assert.equal(refetched, false, "refetch NON lancé sur STALE (sauvegarde échouée)");
    const before = { program: prog("prog-1", "u0"), revision: 5 };
    const next = nextBuilderState(before, outcome);
    assert.equal(next.revision, 5, "révision inchangée sur STALE");
    assert.equal(next.program, before.program, "état local (modifications non enregistrées) conservé");
  });

  await atest("remount — program.updatedAt INCHANGÉ : le remount se produit quand même via la révision", async () => {
    // La RPC bumpe workout_sessions.updated_at mais programs.updated_at peut
    // rester identique : le déclencheur est builderRevision, pas program.updatedAt.
    const outcome = await orchestrateBuilderSave({
      save: async () => true,
      refetch: async () => prog("prog-1", "u0"), // MÊME updatedAt programme
    });
    assert.equal(outcome.kind, "success");
    const next = nextBuilderState({ program: prog("prog-1", "u0"), revision: 0 }, outcome);
    assert.equal(next.revision, 1, "remount déclenché malgré program.updatedAt identique");
  });

  await atest("remount — échec de sauvegarde (false) : erreur, aucun remount", async () => {
    const outcome = await orchestrateBuilderSave({ save: async () => false, refetch: async () => prog("prog-1", "u1") });
    assert.equal(outcome.kind, "error");
    const before = { program: prog("prog-1", "u0"), revision: 2 };
    assert.equal(nextBuilderState(before, outcome).revision, 2, "aucun remount sur échec");
  });

  console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
  if (failed > 0) process.exit(1);
}

void runAsync();
