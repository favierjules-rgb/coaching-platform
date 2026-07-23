// Tests PURS de la carte de chaleur musculaire (Lot B). Aucun rendu React :
// on prouve l'agrégation séries/groupe et les seuils d'intensité, seule source
// = session.blocks[] (jamais session.exercises[]).

import assert from "node:assert/strict";

import {
  BODY_ZONES,
  calculateMuscleHeatmap,
  setsToHeatLevel,
  type BodyZone,
} from "@/lib/muscle-heatmap";
import type { CardioTrainingBlock, StrengthTrainingBlock } from "@/types";

type ExerciseSpec = { muscleGroup?: string; sets: number };

function strengthBlock(exercises: ExerciseSpec[], position = 0, id = `b${position}`): StrengthTrainingBlock {
  return {
    id,
    category: "strength",
    position,
    title: null,
    colorKey: "blue",
    exercises: exercises.map((ex, i) => ({
      id: `${id}-e${i}`,
      order: i,
      name: `Ex ${i}`,
      sets: ex.sets,
      reps: "8-10",
      restSeconds: 60,
      tempo: "2-0-1-0",
      recommendedLoad: "",
      videoUrl: "",
      notes: "",
      muscleGroup: ex.muscleGroup,
    })),
  };
}

function cardioBlock(position = 0): CardioTrainingBlock {
  return { id: `c${position}`, category: "cardio", position, title: null, colorKey: "red", cardioType: "easy_run", prescriptions: [] };
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
    console.error(error instanceof Error ? error.message : error);
  }
}

// ── Seuils centralisés : séries -> niveau 0..4 (0 / 1-3 / 4-7 / 8-11 / 12+) ──
test("setsToHeatLevel : bornes de chaque palier", () => {
  assert.equal(setsToHeatLevel(0), 0);
  assert.equal(setsToHeatLevel(1), 1);
  assert.equal(setsToHeatLevel(3), 1);
  assert.equal(setsToHeatLevel(4), 2);
  assert.equal(setsToHeatLevel(7), 2);
  assert.equal(setsToHeatLevel(8), 3);
  assert.equal(setsToHeatLevel(11), 3);
  assert.equal(setsToHeatLevel(12), 4);
  assert.equal(setsToHeatLevel(50), 4);
});

// ── Zéro exercice ──
test("aucun bloc -> toutes les zones à 0, aucune travaillée", () => {
  const h = calculateMuscleHeatmap([]);
  assert.equal(h.totalSets, 0);
  assert.equal(h.otherSets, 0);
  assert.equal(h.maxSets, 0);
  assert.equal(h.worked.length, 0);
  for (const zone of BODY_ZONES) {
    assert.equal(h.zones[zone].sets, 0);
    assert.equal(h.zones[zone].level, 0);
    assert.equal(h.zones[zone].share, 0);
  }
});

// ── Un seul groupe ──
test("pectoraux uniquement", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "Pectoraux", sets: 4 }])]);
  assert.equal(h.zones.pectoraux.sets, 4);
  assert.equal(h.zones.pectoraux.level, 2);
  assert.equal(h.zones.pectoraux.share, 1);
  assert.equal(h.totalSets, 4);
  assert.equal(h.worked.length, 1);
  assert.equal(h.worked[0].zone, "pectoraux");
});

test("dos uniquement", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "Dos", sets: 6 }])]);
  assert.equal(h.zones.dos.sets, 6);
  assert.equal(h.zones.pectoraux.sets, 0);
  assert.equal(h.worked.length, 1);
});

// ── Deux groupes ──
test("pectoraux + dos : parts et tri décroissant", () => {
  const h = calculateMuscleHeatmap([
    strengthBlock([{ muscleGroup: "Pectoraux", sets: 3 }]),
    strengthBlock([{ muscleGroup: "Dos", sets: 9 }], 1),
  ]);
  assert.equal(h.totalSets, 12);
  assert.equal(h.zones.pectoraux.share, 3 / 12);
  assert.equal(h.zones.dos.share, 9 / 12);
  assert.equal(h.worked.map((z) => z.zone).join(","), "dos,pectoraux");
  assert.equal(h.maxSets, 9);
});

// ── Exercice multi-groupes : compté pour chaque groupe ──
test("exercice « pectoraux, triceps » compte pour les deux", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "Pectoraux, triceps", sets: 4 }])]);
  assert.equal(h.zones.pectoraux.sets, 4);
  assert.equal(h.zones.triceps.sets, 4);
  assert.equal(h.totalSets, 8);
});

// ── Non classé : groupe vide ou hors schéma -> otherSets, jamais sur une zone ──
test("exercice sans groupe -> non localisé (otherSets)", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ sets: 5 }])]);
  assert.equal(h.totalSets, 0);
  assert.equal(h.otherSets, 5);
  assert.equal(h.worked.length, 0);
});

test("groupe hors schéma (full-body) -> non localisé", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "corps entier", sets: 3 }])]);
  assert.equal(h.totalSets, 0);
  assert.equal(h.otherSets, 3);
});

test("avant-bras et lombaires sont désormais LOCALISÉS (schéma redessiné)", () => {
  const h = calculateMuscleHeatmap([
    strengthBlock([{ muscleGroup: "avant-bras", sets: 3 }]),
    strengthBlock([{ muscleGroup: "lombaires", sets: 5 }], 1),
  ]);
  assert.equal(h.zones["avant-bras"].sets, 3);
  assert.equal(h.zones.lombaires.sets, 5);
  assert.equal(h.otherSets, 0);
  assert.equal(h.totalSets, 8);
});

// ── AVANT-BRAS : 0 série neutre, localisation, intensités 1..4 ──
test("avant-bras : 0 série -> zone neutre (level 0), rien de localisé", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "avant-bras", sets: 0 }])]);
  assert.equal(h.zones["avant-bras"].sets, 0);
  assert.equal(h.zones["avant-bras"].level, 0);
  assert.equal(h.totalSets, 0);
  assert.equal(h.otherSets, 0);
});
test("avant-bras : intensités 1..4 selon les séries (1/4/8/12)", () => {
  const lvl = (sets: number) =>
    calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "avant-bras", sets }])]).zones["avant-bras"].level;
  assert.equal(lvl(1), 1);
  assert.equal(lvl(4), 2);
  assert.equal(lvl(8), 3);
  assert.equal(lvl(12), 4);
});

// ── LOMBAIRES : localisation, distincte du dos, intensités 1..4 ──
test("lombaires : séries -> zone localisée, DISTINCTE du dos", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "lombaires", sets: 4 }])]);
  assert.equal(h.zones.lombaires.sets, 4);
  assert.equal(h.zones.dos.sets, 0, "un exercice lombaires ne doit pas colorer le dos");
});
test("dos seul ne colore pas les lombaires (grand dorsal indépendant)", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "Dos", sets: 6 }])]);
  assert.equal(h.zones.dos.sets, 6);
  assert.equal(h.zones.lombaires.sets, 0, "le dos ne doit pas colorer les lombaires");
});
test("lombaires : intensités 1..4 selon les séries (1/4/8/12)", () => {
  const lvl = (sets: number) =>
    calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "lombaires", sets }])]).zones.lombaires.level;
  assert.equal(lvl(1), 1);
  assert.equal(lvl(4), 2);
  assert.equal(lvl(8), 3);
  assert.equal(lvl(12), 4);
});

// ── ANTI DOUBLE COMPTAGE (dos / lombaires) ──
test("un exercice lombaires ne compte qu'une seule fois", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "lombaires", sets: 4 }])]);
  assert.equal(h.zones.lombaires.sets, 4);
  assert.equal(h.totalSets, 4);
});
test("un exercice dos ne compte qu'une seule fois", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "Dos", sets: 4 }])]);
  assert.equal(h.zones.dos.sets, 4);
  assert.equal(h.totalSets, 4);
});
test("exercice multi-groupes « dos, lombaires » : chaque groupe compte les séries UNE fois (composé, sans duplication)", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "dos, lombaires", sets: 4 }])]);
  assert.equal(h.zones.dos.sets, 4);
  assert.equal(h.zones.lombaires.sets, 4);
  assert.equal(h.totalSets, 8); // 4 (dos) + 4 (lombaires) — règle composé existante, pas de double comptage
});

// ── Plusieurs blocs strength ──
test("plusieurs blocs strength s'additionnent par zone", () => {
  const h = calculateMuscleHeatmap([
    strengthBlock([{ muscleGroup: "Pectoraux", sets: 4 }]),
    strengthBlock([{ muscleGroup: "Pectoraux", sets: 4 }], 1),
    strengthBlock([{ muscleGroup: "Épaules", sets: 4 }], 2),
  ]);
  assert.equal(h.zones.pectoraux.sets, 8);
  assert.equal(h.zones.pectoraux.level, 3);
  assert.equal(h.zones["épaules"].sets, 4);
});

// ── Cardio ignoré pour la chaleur musculaire ──
test("les blocs cardio n'ajoutent aucune chaleur musculaire", () => {
  const h = calculateMuscleHeatmap([
    cardioBlock(0),
    strengthBlock([{ muscleGroup: "Quadriceps", sets: 5 }], 1),
    cardioBlock(2),
  ]);
  assert.equal(h.zones.quadriceps.sets, 5);
  assert.equal(h.totalSets, 5);
  assert.equal(h.otherSets, 0);
});

// ── Ordre des blocs sans effet sur les agrégats ──
test("l'ordre des blocs ne change pas les agrégats", () => {
  const a = calculateMuscleHeatmap([
    strengthBlock([{ muscleGroup: "Dos", sets: 6 }], 0),
    strengthBlock([{ muscleGroup: "Biceps", sets: 3 }], 1),
  ]);
  const b = calculateMuscleHeatmap([
    strengthBlock([{ muscleGroup: "Biceps", sets: 3 }], 0),
    strengthBlock([{ muscleGroup: "Dos", sets: 6 }], 1),
  ]);
  assert.deepEqual(
    BODY_ZONES.map((z) => a.zones[z].sets),
    BODY_ZONES.map((z) => b.zones[z].sets),
  );
});

// ── Séance très légère : 1 série ne devient jamais rouge vif (plafond) ──
test("1 série -> niveau faible (1), pas très élevé", () => {
  const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: "Mollets", sets: 1 }])]);
  assert.equal(h.zones.mollets.sets, 1);
  assert.equal(h.zones.mollets.level, 1);
});

const zonesTouchees: BodyZone[] = ["pectoraux", "dos", "lombaires", "épaules", "biceps", "triceps", "avant-bras", "abdos", "quadriceps", "ischios", "fessiers", "mollets"];
test("les 12 zones du schéma sont toutes adressables", () => {
  for (const zone of zonesTouchees) {
    const label = zone === "épaules" ? "Épaules" : zone;
    const h = calculateMuscleHeatmap([strengthBlock([{ muscleGroup: label, sets: 4 }])]);
    assert.equal(h.zones[zone].sets, 4, `zone ${zone}`);
  }
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
