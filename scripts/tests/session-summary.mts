// Tests PURS du résumé de séance multi-blocs (Lot D). Source = TrainingBlock.

import assert from "node:assert/strict";

import { derivedSessionTypeLabel, summarizeBlock } from "@/lib/session-summary";
import type { AdminCardioSegment, CardioTrainingBlock, StrengthTrainingBlock } from "@/types";

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

function strength(names: string[]): StrengthTrainingBlock {
  return {
    id: "b",
    category: "strength",
    position: 0,
    title: null,
    colorKey: "blue",
    exercises: names.map((name, i) => ({
      id: `e${i}`,
      order: i,
      name,
      sets: 3,
      reps: "8-10",
      restSeconds: 60,
      tempo: "2-0-1-0",
      recommendedLoad: "",
      videoUrl: "",
      notes: "",
    })),
  };
}
function seg(durationSeconds?: number): AdminCardioSegment {
  return { id: `s${durationSeconds ?? 0}`, order: 0, segmentType: "single", title: "", intensityTargetType: "free", durationSeconds };
}
function cardio(prescriptions: AdminCardioSegment[]): CardioTrainingBlock {
  return { id: "c", category: "cardio", position: 0, title: null, colorKey: "red", cardioType: "easy_run", prescriptions };
}

test("strength : 0 exercice", () => {
  assert.equal(summarizeBlock(strength([])), "Aucun exercice");
});
test("strength : 1-2 exercices -> noms joints", () => {
  assert.equal(summarizeBlock(strength(["Rowing barre"])), "Rowing barre");
  assert.equal(summarizeBlock(strength(["Rowing barre", "Tractions"])), "Rowing barre · Tractions");
});
test("strength : 3+ exercices -> compte", () => {
  assert.equal(summarizeBlock(strength(["A", "B", "C", "D"])), "4 exercices");
});
test("cardio : durée connue -> minutes", () => {
  const s = summarizeBlock(cardio([seg(600), seg(600)])); // 20 min
  assert.match(s, /· 20 min$/);
  assert.ok(s.startsWith("Footing facile"));
});
test("cardio : sans durée -> nombre de segments", () => {
  const s = summarizeBlock(cardio([seg(), seg(), seg()]));
  assert.match(s, /· 3 segments$/);
});
test("cardio : aucune prescription -> type seul", () => {
  assert.equal(summarizeBlock(cardio([])), "Footing facile");
});
test("libellés de type dérivé", () => {
  assert.equal(derivedSessionTypeLabel("strength"), "Musculation");
  assert.equal(derivedSessionTypeLabel("cardio"), "Cardio");
  assert.equal(derivedSessionTypeLabel("mixed"), "Mixte");
  assert.equal(derivedSessionTypeLabel("rest"), "Repos");
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
