/**
 * Harnais — feat/nutrition-adaptive-recipes, PR 1, volet A.
 *
 * Macros quotidiennes d'un plan v2 : conversion calories → grammes, points de
 * base entiers, messages déterministes de déficit et de dépassement,
 * séparation stricte entre représentation de CALCUL (décimales conservées) et
 * représentation d'AFFICHAGE (arrondie, française).
 *
 * Lancement : npx tsx scripts/tests/nutrition-macro-targets.mts
 */
import assert from "node:assert/strict";

import {
  BASIS_POINTS_TOTAL,
  NBSP,
  describeBasisPointsBalance,
  formatBasisPointsBalanceMessage,
  formatBasisPointsPercent,
  formatDecimalFr,
  formatIntegerFr,
  isBasisPoints,
} from "../../lib/nutrition/basis-points";
import {
  DAILY_CALORIES_MAX,
  KCAL_PER_GRAM,
  computeCaloriesFromGrams,
  computeDailyMacroTargets,
  formatSplitBalanceMessage,
  hasAssignableCalories,
  isSplitComplete,
  toDisplayMacroTargets,
} from "../../lib/nutrition/macro-targets";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void) {
  try {
    fn();
    réussis += 1;
    console.log(`ok - ${nom}`);
  } catch (erreur) {
    échecs += 1;
    console.error(`ÉCHEC - ${nom}`);
    console.error(erreur);
  }
}

/* ── 1. Cas de référence : 1 700 kcal réparties 28 / 48 / 24 ────────────── */
test("1. 1700 kcal à 28/48/24 donne 119 g de protéines, 204 g de glucides, 45,33 g de lipides", () => {
  const cibles = computeDailyMacroTargets({
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  assert.equal(cibles.grams.proteinGrams, 119);
  assert.equal(cibles.grams.carbGrams, 204);
  assert.equal(cibles.grams.fatGrams, 408 / 9);
  assert.equal(cibles.balance.status, "complete");
});

/* ── 2. Conversion kcal → grammes : 4 / 4 / 9 ───────────────────────────── */
test("2. la conversion applique 4 kcal/g pour P et G, 9 kcal/g pour L", () => {
  assert.equal(KCAL_PER_GRAM.protein, 4);
  assert.equal(KCAL_PER_GRAM.carb, 4);
  assert.equal(KCAL_PER_GRAM.fat, 9);
  const cibles = computeDailyMacroTargets({
    dailyCalories: 900,
    proteinBp: 0,
    carbBp: 0,
    fatBp: 10000,
  });
  // 900 kcal entièrement en lipides ⇒ 100 g exactement.
  assert.equal(cibles.grams.fatGrams, 100);
  assert.equal(cibles.grams.proteinGrams, 0);
});

/* ── 3. Somme exacte à 10 000, comparaison ENTIÈRE ──────────────────────── */
test("3. la répartition complète se teste par une égalité entière à 10 000", () => {
  assert.equal(BASIS_POINTS_TOTAL, 10000);
  assert.equal(isSplitComplete({ proteinBp: 2800, carbBp: 4800, fatBp: 2400 }), true);
  assert.equal(isSplitComplete({ proteinBp: 3333, carbBp: 3333, fatBp: 3334 }), true);
  assert.equal(isSplitComplete({ proteinBp: 3333, carbBp: 3333, fatBp: 3333 }), false);
  // Aucune tolérance flottante : 9 999 n'est pas « presque 100 % ».
  assert.equal(isSplitComplete({ proteinBp: 2800, carbBp: 4800, fatBp: 2399 }), false);
});

/* ── 4. Déficit : message déterministe ──────────────────────────────────── */
test("4. un déficit de 800 points de base produit le message attendu", () => {
  const message = formatSplitBalanceMessage({ proteinBp: 2800, carbBp: 4400, fatBp: 2000 });
  assert.equal(message, `Il reste 800 points de base, soit 8${NBSP}%, à répartir.`);
});

/* ── 5. Dépassement : message déterministe ──────────────────────────────── */
test("5. un dépassement de 600 points de base produit le message attendu", () => {
  const message = formatSplitBalanceMessage({ proteinBp: 2800, carbBp: 4800, fatBp: 3000 });
  assert.equal(
    message,
    `La répartition dépasse 100${NBSP}% de 600 points de base, soit 6${NBSP}%.`,
  );
});

/* ── 6. Zéro : calculable, mais non assignable ──────────────────────────── */
test("6. zéro calorie se calcule sans erreur mais n'est pas assignable", () => {
  const cibles = computeDailyMacroTargets({
    dailyCalories: 0,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  assert.equal(cibles.grams.proteinGrams, 0);
  assert.equal(cibles.grams.carbGrams, 0);
  assert.equal(cibles.grams.fatGrams, 0);
  assert.equal(cibles.calories.totalCalories, 0);
  assert.equal(hasAssignableCalories(0), false);
  assert.equal(hasAssignableCalories(1700), true);
  assert.equal(hasAssignableCalories(DAILY_CALORIES_MAX + 1), false);
});

/* ── 7. Valeurs négatives et hors domaine : refusées ────────────────────── */
test("7. calories négatives, points de base non entiers ou hors bornes : refusés", () => {
  assert.throws(
    () => computeDailyMacroTargets({ dailyCalories: -1, proteinBp: 0, carbBp: 0, fatBp: 0 }),
    RangeError,
  );
  assert.throws(
    () => computeDailyMacroTargets({ dailyCalories: 1700, proteinBp: -1, carbBp: 0, fatBp: 0 }),
    RangeError,
  );
  assert.throws(
    () => computeDailyMacroTargets({ dailyCalories: 1700, proteinBp: 10001, carbBp: 0, fatBp: 0 }),
    RangeError,
  );
  assert.throws(
    () => computeDailyMacroTargets({ dailyCalories: 1700, proteinBp: 2800.5, carbBp: 0, fatBp: 0 }),
    RangeError,
  );
  assert.throws(
    () => computeDailyMacroTargets({ dailyCalories: Number.NaN, proteinBp: 0, carbBp: 0, fatBp: 0 }),
    RangeError,
  );
  assert.equal(isBasisPoints(2800), true);
  assert.equal(isBasisPoints(2800.5), false);
  assert.equal(isBasisPoints(10001), false);
});

/* ── 8. Décimales conservées en interne ─────────────────────────────────── */
test("8. les décimales sont conservées dans la représentation de calcul", () => {
  const cibles = computeDailyMacroTargets({
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  assert.notEqual(cibles.grams.fatGrams, Math.round(cibles.grams.fatGrams));
  assert.ok(Math.abs(cibles.grams.fatGrams - 45.3333333) < 1e-6);
});

/* ── 9. Arrondi UNIQUEMENT à l'affichage ────────────────────────────────── */
test("9. l'arrondi n'intervient qu'à l'affichage, jamais dans le calcul", () => {
  const cibles = computeDailyMacroTargets({
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  const affichage = toDisplayMacroTargets(cibles);
  assert.equal(affichage.dailyCalories, `1${NBSP}700${NBSP}kcal`);
  assert.equal(affichage.proteinGrams, `119${NBSP}g`);
  assert.equal(affichage.carbGrams, `204${NBSP}g`);
  assert.equal(affichage.fatGrams, `45${NBSP}g`);
  assert.equal(affichage.proteinPercent, `28${NBSP}%`);
  assert.equal(affichage.fatPercent, `24${NBSP}%`);
  assert.equal(affichage.balanceMessage, null);
  // Deux décimales à la demande, virgule française, zéros de queue supprimés.
  const précis = toDisplayMacroTargets(cibles, { gramDecimals: 2 });
  assert.equal(précis.fatGrams, `45,33${NBSP}g`);
  assert.equal(précis.proteinGrams, `119${NBSP}g`);
  // 33,33 % : la représentation en points de base survit à l'affichage.
  assert.equal(formatBasisPointsPercent(3333), `33,33${NBSP}%`);
  assert.equal(formatIntegerFr(10000), `10${NBSP}000`);
  assert.equal(formatDecimalFr(45.3333, 1), "45,3");
});

/* ── 10. Changement de calories ─────────────────────────────────────────── */
test("10. changer les calories recalcule les grammes à répartition constante", () => {
  const split = { proteinBp: 2800, carbBp: 4800, fatBp: 2400 };
  const a = computeDailyMacroTargets({ dailyCalories: 1700, ...split });
  const b = computeDailyMacroTargets({ dailyCalories: 3400, ...split });
  assert.equal(b.grams.proteinGrams, a.grams.proteinGrams * 2);
  assert.equal(b.grams.carbGrams, a.grams.carbGrams * 2);
  assert.equal(b.grams.fatGrams, a.grams.fatGrams * 2);
});

/* ── 11. Changement de pourcentage ──────────────────────────────────────── */
test("11. changer la répartition recalcule les grammes à calories constantes", () => {
  const a = computeDailyMacroTargets({
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  const b = computeDailyMacroTargets({
    dailyCalories: 1700,
    proteinBp: 4000,
    carbBp: 3600,
    fatBp: 2400,
  });
  assert.equal(b.grams.proteinGrams, (1700 * 0.4) / 4);
  assert.equal(b.grams.fatGrams, a.grams.fatGrams);
  assert.notEqual(b.grams.carbGrams, a.grams.carbGrams);
  assert.equal(b.calories.totalCalories, 1700);
});

/* ── 12. Aucun NaN, aucun Infinity ──────────────────────────────────────── */
test("12. aucune entrée valide ne produit NaN ni Infinity", () => {
  const entrées = [
    { dailyCalories: 0, proteinBp: 0, carbBp: 0, fatBp: 0 },
    { dailyCalories: 1, proteinBp: 10000, carbBp: 0, fatBp: 0 },
    { dailyCalories: DAILY_CALORIES_MAX, proteinBp: 3333, carbBp: 3333, fatBp: 3334 },
    { dailyCalories: 1700, proteinBp: 0, carbBp: 0, fatBp: 10000 },
  ];
  for (const entrée of entrées) {
    const cibles = computeDailyMacroTargets(entrée);
    for (const valeur of [
      cibles.grams.proteinGrams,
      cibles.grams.carbGrams,
      cibles.grams.fatGrams,
      cibles.calories.totalCalories,
    ]) {
      assert.ok(Number.isFinite(valeur), `valeur non finie pour ${JSON.stringify(entrée)}`);
    }
  }
});

/* ── 13. Calories dérivées des grammes ──────────────────────────────────── */
test("13. les calories dérivées des grammes reconstituent la cible quotidienne", () => {
  const cibles = computeDailyMacroTargets({
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  const dérivées = computeCaloriesFromGrams(cibles.grams);
  assert.ok(Math.abs(dérivées.totalCalories - 1700) < 1e-9);
  assert.equal(dérivées.proteinCalories, 476);
  assert.equal(dérivées.carbCalories, 816);
  assert.ok(Math.abs(dérivées.fatCalories - 408) < 1e-9);
});

/* ── 14. Objet source intact ────────────────────────────────────────────── */
test("14. l'objet d'entrée n'est jamais modifié", () => {
  const entrée = Object.freeze({
    dailyCalories: 1700,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  const copie = { ...entrée };
  const cibles = computeDailyMacroTargets(entrée);
  assert.deepEqual({ ...entrée }, copie);
  // Le résultat ne partage aucune référence mutable avec l'entrée.
  assert.notEqual(cibles.split, entrée);
  assert.deepEqual(cibles.split, { proteinBp: 2800, carbBp: 4800, fatBp: 2400 });
});

/* ── 15. Équilibre : statut structuré, pas seulement un message ─────────── */
test("15. l'équilibre est retourné sous forme structurée", () => {
  const déficit = describeBasisPointsBalance([2800, 4400, 2000]);
  assert.deepEqual(déficit, { status: "deficit", totalBp: 9200, remainingBp: 800, overflowBp: 0 });
  const dépassement = describeBasisPointsBalance([2800, 4800, 3000]);
  assert.deepEqual(dépassement, {
    status: "overflow",
    totalBp: 10600,
    remainingBp: 0,
    overflowBp: 600,
  });
  assert.equal(formatBasisPointsBalanceMessage(describeBasisPointsBalance([10000])), null);
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
