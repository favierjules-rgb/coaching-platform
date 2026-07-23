// Tests PURS du modèle de courbe de poids (Lot C). Aucun rendu React.

import assert from "node:assert/strict";

import { buildWeightChartModel, formatKg, DEFAULT_WEIGHT_LAYOUT, type WeightPointInput } from "@/lib/weight-chart";

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

const L = DEFAULT_WEIGHT_LAYOUT;
const plotTop = L.padTop;
const plotBottom = L.height - L.padBottom;
function m(kg: number, month = "01/01"): WeightPointInput {
  return { kg, month };
}

test("formatKg : français, 1 décimale, sans .0 superflu", () => {
  assert.equal(formatKg(72), "72");
  assert.equal(formatKg(72.4), "72,4");
  assert.equal(formatKg(72.45), "72,5");
  assert.equal(formatKg(Number.NaN), "—");
});

test("aucune mesure -> isEmpty", () => {
  const model = buildWeightChartModel([]);
  assert.equal(model.isEmpty, true);
  assert.equal(model.points.length, 0);
});

test("une seule mesure -> point centré, sans ligne, non collé en bas", () => {
  const model = buildWeightChartModel([m(72.4, "17/07")]);
  assert.equal(model.points.length, 1);
  assert.equal(model.linePath, "");
  const p = model.points[0];
  assert.ok(p.x > model.plot.left && p.x < model.plot.right, "x doit être centré");
  assert.ok(p.y > plotTop + 1 && p.y < plotBottom - 1, "y ne doit pas être collé aux bords");
  // domaine centré autour de la valeur (±1 kg)
  assert.equal(Math.round(model.domain.min), 71);
  assert.equal(Math.round(model.domain.max), 73);
});

test("deux mesures -> ligne tracée + 2 points", () => {
  const model = buildWeightChartModel([m(72, "17/07"), m(71, "19/07")]);
  assert.equal(model.points.length, 2);
  assert.ok(model.linePath.startsWith("M"));
  assert.ok(model.areaPath.endsWith("Z"));
});

test("plusieurs mesures -> n points, X croissant", () => {
  const model = buildWeightChartModel([m(70), m(71), m(72), m(71.5)]);
  assert.equal(model.points.length, 4);
  for (let i = 1; i < model.points.length; i += 1) {
    assert.ok(model.points[i].x > model.points[i - 1].x, "X doit croître avec l'index");
  }
});

test("valeurs identiques -> domaine ±1, points centrés (pas en bas)", () => {
  const model = buildWeightChartModel([m(70), m(70), m(70)]);
  assert.equal(Math.round(model.domain.min), 69);
  assert.equal(Math.round(model.domain.max), 71);
  for (const p of model.points) {
    assert.ok(Math.abs(p.y - (plotTop + plotBottom) / 2) < 1, "points centrés verticalement");
  }
});

test("micro-variation (0,2 kg) reste visible (y différents)", () => {
  const model = buildWeightChartModel([m(70.0), m(70.2)]);
  const dy = Math.abs(model.points[0].y - model.points[1].y);
  assert.ok(dy > 10, `l'écart vertical doit être lisible (dy=${dy.toFixed(1)}px)`);
});

test("poids invalide (NaN) ignoré, jamais affiché", () => {
  const model = buildWeightChartModel([m(70), { kg: Number.NaN, month: "x" }, m(72)]);
  assert.equal(model.points.length, 2);
  assert.deepEqual(
    model.points.map((p) => p.kg),
    [70, 72],
  );
});

test("données non triées -> rendues dans l'ordre fourni, sans plantage", () => {
  const model = buildWeightChartModel([m(72, "19/07"), m(70, "17/07"), m(71, "18/07")]);
  assert.equal(model.points.length, 3);
  assert.deepEqual(
    model.points.map((p) => p.label),
    ["19/07", "17/07", "18/07"],
  );
});

test("doublons de date -> deux points distincts", () => {
  const model = buildWeightChartModel([m(70, "17/07"), m(70.5, "17/07")]);
  assert.equal(model.points.length, 2);
  assert.notEqual(model.points[0].x, model.points[1].x);
});

test("4 graduations kg couvrant le domaine, étiquetées", () => {
  const model = buildWeightChartModel([m(68), m(74)]);
  assert.equal(model.yTicks.length, 4);
  assert.ok(model.yTicks[0].value >= model.domain.max - 0.01);
  assert.ok(model.yTicks[3].value <= model.domain.min + 0.01);
  for (const t of model.yTicks) assert.ok(t.label.length > 0);
});

test("domaine vertical ne commence pas à zéro (cadré autour des valeurs)", () => {
  const model = buildWeightChartModel([m(80), m(82)]);
  assert.ok(model.domain.min > 70, `domaine min doit être proche des valeurs (=${model.domain.min})`);
});

test("max en haut, min en bas (dans le cadre)", () => {
  const model = buildWeightChartModel([m(70), m(75), m(72)]);
  const yMax = model.points[1].y; // 75 kg
  const yMin = model.points[0].y; // 70 kg
  assert.ok(yMax < yMin, "le poids le plus élevé est plus haut (y plus petit)");
  for (const p of model.points) assert.ok(p.y >= plotTop && p.y <= plotBottom);
});

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed > 0) process.exit(1);
