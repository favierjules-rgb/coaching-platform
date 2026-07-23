// Tests PURS du view-model du détail de séance élève (correctif ordre
// canonique). Prouve : rendu = UNE liste ordonnée par position, exercices
// triés par `order` DANS chaque bloc, aucun mélange entre blocs, UUID/colorKey
// conservés, legacy normalisé une seule fois.

import assert from "node:assert/strict";

import { orderedStrengthExercises, orderedStudentSessionBlocks } from "@/lib/student-session-blocks";
import type {
  AdminCardioBlock,
  AdminCardioSegment,
  CardioTrainingBlock,
  Exercise,
  StrengthExercise,
  StrengthTrainingBlock,
  TrainingBlock,
} from "@/types";

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
    console.error(error instanceof Error ? error.message : error);
  }
}

function sx(id: string, order: number): StrengthExercise {
  return { id, order, name: `Ex ${id}`, sets: 3, reps: "8-10", restSeconds: 60, tempo: "2-0-1-0", recommendedLoad: "", videoUrl: "", notes: "" };
}
function strength(id: string, position: number, exercises: StrengthExercise[], colorKey = "gray"): StrengthTrainingBlock {
  return { id, category: "strength", position, title: null, colorKey, exercises };
}
function seg(id: string): AdminCardioSegment {
  return { id, order: 0, segmentType: "single", title: "", intensityTargetType: "free" };
}
function cardio(id: string, position: number, colorKey = "blue"): CardioTrainingBlock {
  return { id, category: "cardio", position, title: null, colorKey, cardioType: "easy_run", prescriptions: [seg(`${id}-s`)] };
}
function ids(views: ReturnType<typeof orderedStudentSessionBlocks>): string[] {
  return views.map((v) => v.id);
}
function exIds(view: ReturnType<typeof orderedStudentSessionBlocks>[number]): string[] {
  return view.kind === "strength" ? view.exercises.map((e) => e.id) : [];
}

// ── Exemple CRITIQUE : S(A) → Cardio → S(B), entrée volontairement désordonnée ──
test("S/C/S : ordre des blocs par position ET ordre interne des exercices par `order`", () => {
  const a = strength("strength-a", 0, [sx("a2", 1), sx("a1", 0)]);
  const c = cardio("cardio-a", 1);
  const b = strength("strength-b", 2, [sx("b2", 1), sx("b1", 0)]);
  // entrée mélangée : prouve le tri par position (pas l'ordre d'arrivée)
  const views = orderedStudentSessionBlocks({ blocks: [b, c, a] });
  assert.deepEqual(ids(views), ["strength-a", "cardio-a", "strength-b"]);
  assert.equal(views[0].kind, "strength");
  assert.deepEqual(exIds(views[0]), ["a1", "a2"]);
  assert.equal(views[1].kind, "cardio");
  assert.deepEqual(exIds(views[2]), ["b1", "b2"]);
});

test("C/S/C : cardio rendu à sa position, jamais forcé avant/après", () => {
  const views = orderedStudentSessionBlocks({
    blocks: [cardio("c1", 0), strength("s1", 1, [sx("e1", 0)]), cardio("c2", 2)],
  });
  assert.deepEqual(ids(views), ["c1", "s1", "c2"]);
  assert.deepEqual(
    views.map((v) => v.kind),
    ["cardio", "strength", "cardio"],
  );
});

test("deux Strength consécutifs : exercices JAMAIS concaténés entre blocs", () => {
  const views = orderedStudentSessionBlocks({
    blocks: [strength("sa", 0, [sx("a1", 0), sx("a2", 1)]), strength("sb", 1, [sx("b1", 0), sx("b2", 1)])],
  });
  assert.deepEqual(ids(views), ["sa", "sb"]);
  assert.deepEqual(exIds(views[0]), ["a1", "a2"]);
  assert.deepEqual(exIds(views[1]), ["b1", "b2"]);
  // aucun exercice de sb dans sa, ni l'inverse
  assert.ok(!exIds(views[0]).includes("b1"));
  assert.ok(!exIds(views[1]).includes("a1"));
});

test("deux Cardio consécutifs : pas de fusion automatique", () => {
  const views = orderedStudentSessionBlocks({ blocks: [cardio("c1", 0), cardio("c2", 1)] });
  assert.deepEqual(ids(views), ["c1", "c2"]);
});

test("Strength seul / Cardio seul / Repos", () => {
  assert.deepEqual(ids(orderedStudentSessionBlocks({ blocks: [strength("s", 0, [sx("e", 0)])] })), ["s"]);
  assert.deepEqual(ids(orderedStudentSessionBlocks({ blocks: [cardio("c", 0)] })), ["c"]);
  assert.deepEqual(orderedStudentSessionBlocks({ blocks: [] }), []);
  assert.deepEqual(orderedStudentSessionBlocks({}), []);
});

test("aucun exercice perdu ni dupliqué (cardinalité conservée)", () => {
  const views = orderedStudentSessionBlocks({
    blocks: [strength("sa", 0, [sx("a1", 0), sx("a2", 1), sx("a3", 2)]), strength("sb", 1, [sx("b1", 0)])],
  });
  const all = orderedStrengthExercises(views).map((e) => e.id);
  assert.deepEqual(all, ["a1", "a2", "a3", "b1"]);
  assert.equal(new Set(all).size, all.length); // pas de doublon
});

test("UUID des blocs et des exercices conservés à l'identique", () => {
  const views = orderedStudentSessionBlocks({ blocks: [strength("block-uuid-x", 0, [sx("ex-uuid-y", 0)])] });
  assert.equal(views[0].id, "block-uuid-x");
  assert.deepEqual(exIds(views[0]), ["ex-uuid-y"]);
});

test("colorKey conservé (jamais recalculé)", () => {
  const views = orderedStudentSessionBlocks({
    blocks: [strength("s", 0, [sx("e", 0)], "orange"), cardio("c", 1, "green")],
  });
  assert.equal(views[0].colorKey, "orange");
  assert.equal(views[1].colorKey, "green");
});

test("aucune mutation des props (entrée inchangée après appel)", () => {
  const exercises = [sx("a2", 1), sx("a1", 0)];
  const block = strength("s", 0, exercises);
  const blocks: TrainingBlock[] = [block];
  orderedStudentSessionBlocks({ blocks });
  // l'ordre d'entrée n'a pas bougé (le helper copie, ne trie pas en place)
  assert.deepEqual(exercises.map((e) => e.id), ["a2", "a1"]);
  assert.deepEqual(blocks.map((b) => b.id), ["s"]);
});

test("legacy (aucun blocks[]) : normalisé UNE fois — strength puis cardio", () => {
  const legacyExercises: Exercise[] = [
    { id: "l1", name: "A", sets: 3, reps: "8", restSeconds: 60, tempo: "2010", recommendedLoad: "", videoUrl: "" },
    { id: "l2", name: "B", sets: 3, reps: "8", restSeconds: 60, tempo: "2010", recommendedLoad: "", videoUrl: "" },
  ];
  const legacyCardio: AdminCardioBlock[] = [
    { id: "lc", order: 0, title: "", cardioType: "easy_run", segments: [seg("lc-s")] },
  ];
  const views = orderedStudentSessionBlocks({ exercises: legacyExercises, cardioBlocks: legacyCardio });
  assert.deepEqual(
    views.map((v) => v.kind),
    ["strength", "cardio"],
  );
  assert.deepEqual(exIds(views[0]), ["l1", "l2"]); // ordre d'entrée préservé
  assert.equal(views[1].id, "lc");
});

test("blocks[] a priorité absolue sur le legacy (jamais de mélange)", () => {
  const views = orderedStudentSessionBlocks({
    blocks: [strength("canonical", 0, [sx("c1", 0)])],
    exercises: [{ id: "legacy-should-be-ignored", name: "X", sets: 1, reps: "1", restSeconds: 0, tempo: "", recommendedLoad: "", videoUrl: "" }],
  });
  assert.deepEqual(ids(views), ["canonical"]);
  assert.deepEqual(exIds(views[0]), ["c1"]);
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
