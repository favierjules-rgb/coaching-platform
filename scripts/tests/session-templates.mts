// Tests PURS du portage canonique des modèles de séance (dernière passe Lot 4).
// Aucun accès réseau/base : uniquement lib/session-template-content.ts.

import assert from "node:assert/strict";

import {
  CANONICAL_TEMPLATE_FORMAT,
  isCanonicalTemplateContent,
  templateBlocksForApply,
  templateBlocksFromContent,
  toCanonicalTemplateContent,
} from "@/lib/session-template-content";
import type { IdFactory } from "@/lib/training-block-editing";
import type { AdminCardioBlock, AdminExercise, CardioTrainingBlock, StrengthTrainingBlock, TrainingBlock } from "@/types";

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
const P_S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const P_E = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

function cats(blocks: TrainingBlock[]): string[] {
  return blocks.map((b) => b.category);
}

test("enregistrement — C/S/C/S : format canonique, ordre, couleurs, positions, metadata", () => {
  const blocks = [
    cardioBlock("c1", 0, "blue"),
    strengthBlock("s1", 1, [adminEx("e1", 0)], "green"),
    cardioBlock("c2", 2, "orange"),
    strengthBlock("s2", 3, [], "red"),
  ];
  const content = toCanonicalTemplateContent({ blocks, warmup: "W", coachNotes: "N", muscleGroup: "jambes", durationMinutes: 45, name: "M" });
  assert.equal(content.format, CANONICAL_TEMPLATE_FORMAT);
  assert.deepEqual(cats(content.blocks), ["cardio", "strength", "cardio", "strength"], "ordre conservé");
  assert.deepEqual(content.blocks.map((b) => b.position), [0, 1, 2, 3], "positions 0..n-1");
  assert.deepEqual(content.blocks.map((b) => b.colorKey), ["blue", "green", "orange", "red"], "couleurs conservées");
  assert.equal(content.metadata.warmup, "W");
  assert.equal(content.metadata.muscleGroup, "jambes");
});

test("discriminant — isCanonicalTemplateContent vrai/faux (jamais blocks ?? legacy)", () => {
  assert.equal(isCanonicalTemplateContent({ format: CANONICAL_TEMPLATE_FORMAT, metadata: {}, blocks: [] }), true);
  assert.equal(isCanonicalTemplateContent({ warmup: "", coachNotes: "", exercises: [], cardioBlocks: [] }), false, "legacy");
  assert.equal(isCanonicalTemplateContent(undefined), false);
  assert.equal(isCanonicalTemplateContent({ format: "autre", blocks: [] }), false);
});

test("lecture — contenu canonique → blocks[] tels quels", () => {
  const content = { format: CANONICAL_TEMPLATE_FORMAT, metadata: {}, blocks: [strengthBlock(P_S, 0, [adminEx(P_E, 0)], "green"), cardioBlock(P_C, 1)] };
  const blocks = templateBlocksFromContent(content);
  assert.deepEqual(cats(blocks), ["strength", "cardio"]);
  assert.equal(blocks[0].id, P_S, "ids du modèle conservés (non régénérés à la lecture)");
  assert.equal((blocks[0] as StrengthTrainingBlock).exercises[0].id, P_E);
});

test("lecture — ANCIEN modèle legacy normalisé UNE fois (muscu puis cardio)", () => {
  const legacy = {
    warmup: "",
    coachNotes: "",
    exercises: [adminEx("le1", 0, "Squat")],
    cardioBlocks: [{ id: "lc1", order: 0, title: "Run", cardioType: "easy_run", segments: [] } as AdminCardioBlock],
  };
  const blocks = templateBlocksFromContent(legacy);
  assert.deepEqual(cats(blocks), ["strength", "cardio"], "toOrderedBlocks : bloc muscu en tête puis cardio");
  assert.equal((blocks[0] as StrengthTrainingBlock).exercises[0].name, "Squat");
});

test("application — canonique : nouveaux ids stricts, source intacte, ordre/couleurs conservés", () => {
  const content = {
    format: CANONICAL_TEMPLATE_FORMAT,
    metadata: {},
    blocks: [strengthBlock(P_S, 0, [adminEx(P_E, 0)], "green"), cardioBlock(P_C, 1, "orange")],
  };
  const applied = templateBlocksForApply(content, makeGen());
  assert.match(applied[0].id, /^new-block:/);
  assert.notEqual(applied[0].id, P_S, "UUID source jamais réutilisé");
  assert.match((applied[0] as StrengthTrainingBlock).exercises[0].id, /^new-exercise:/);
  assert.notEqual((applied[0] as StrengthTrainingBlock).exercises[0].id, P_E);
  assert.deepEqual(cats(applied), ["strength", "cardio"], "ordre conservé");
  assert.deepEqual(applied.map((b) => b.colorKey), ["green", "orange"], "couleurs conservées");
  // source du modèle intacte
  assert.equal(content.blocks[0].id, P_S);
  assert.equal((content.blocks[0] as StrengthTrainingBlock).exercises[0].id, P_E);
});

test("application — legacy : régénère aussi vers new-block/new-exercise stricts", () => {
  const legacy = { warmup: "", coachNotes: "", exercises: [adminEx("le1", 0)], cardioBlocks: [] as AdminCardioBlock[] };
  const applied = templateBlocksForApply(legacy, makeGen());
  assert.match(applied[0].id, /^new-block:/);
  assert.match((applied[0] as StrengthTrainingBlock).exercises[0].id, /^new-exercise:/);
});

test("plusieurs blocs de même catégorie conservés ; modèle vide → repos", () => {
  const content = {
    format: CANONICAL_TEMPLATE_FORMAT,
    metadata: {},
    blocks: [strengthBlock("s1", 0), strengthBlock("s2", 1), cardioBlock("c1", 2), cardioBlock("c2", 3)],
  };
  assert.deepEqual(cats(templateBlocksForApply(content, makeGen())), ["strength", "strength", "cardio", "cardio"]);
  assert.deepEqual(templateBlocksFromContent({ format: CANONICAL_TEMPLATE_FORMAT, metadata: {}, blocks: [] }), [], "modèle vide → aucun bloc (repos)");
});

console.log(`\n${passed} test(s) réussi(s), ${failed} échec(s).`);
if (failed > 0) process.exit(1);
