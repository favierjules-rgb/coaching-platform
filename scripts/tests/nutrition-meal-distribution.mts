/**
 * Harnais — feat/nutrition-adaptive-recipes, PR 1, volets B et C.
 *
 * Répartition des macros par créneau de repas : sommes entières à 10 000,
 * dérivation des grammes SANS arrondi cumulatif, répartition automatique
 * déterministe du reste, verrouillage, et séparation brouillon / assignation.
 *
 * Lancement : npx tsx scripts/tests/nutrition-meal-distribution.mts
 */
import assert from "node:assert/strict";

import { NBSP } from "../../lib/nutrition/basis-points";
import { computeDailyMacroTargets } from "../../lib/nutrition/macro-targets";
import {
  MEAL_SLOT_KEYS,
  computeMealDistribution,
  createEmptyAllocations,
  describeMacroBalance,
  distributeRemainingEqually,
  formatMacroBalanceMessage,
  normalizeDisabledSlots,
  sumEnabledBasisPoints,
  type MealSlotAllocation,
} from "../../lib/nutrition/meal-distribution";
import {
  DEFAULT_PROFILE_KEY,
  NUTRITION_MODEL_VERSION_STRUCTURED,
  PLAN_V2_DISTRIBUTION_MESSAGE_FR,
  formatPlanV2AssignabilityMessage,
  validatePlanV2Assignable,
  validatePlanV2Draft,
  type NutritionPlanV2,
} from "../../lib/nutrition/plan-v2-validation";

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

const CIBLES = computeDailyMacroTargets({
  dailyCalories: 1700,
  proteinBp: 2800,
  carbBp: 4800,
  fatBp: 2400,
});

/** Répartition complète et déterministe des trois macros sur les six créneaux. */
function répartitionComplète(): MealSlotAllocation[] {
  let allocations = createEmptyAllocations();
  for (const macro of ["protein", "carb", "fat"] as const) {
    const résultat = distributeRemainingEqually(allocations, macro);
    assert.ok(résultat.ok);
    allocations = résultat.allocations;
  }
  return allocations;
}

function planDepuis(allocations: readonly MealSlotAllocation[]): NutritionPlanV2 {
  return {
    id: "plan-test",
    nutritionModelVersion: NUTRITION_MODEL_VERSION_STRUCTURED,
    name: "Plan de test",
    profiles: [
      {
        profileKey: DEFAULT_PROFILE_KEY,
        dailyCalories: 1700,
        proteinBp: 2800,
        carbBp: 4800,
        fatBp: 2400,
        slots: allocations,
      },
    ],
  };
}

/* ── 1-3. Chaque macro somme exactement à 10 000 ────────────────────────── */
for (const [index, macro] of (["protein", "carb", "fat"] as const).entries()) {
  test(`${index + 1}. la répartition des ${macro} sur les créneaux actifs vaut exactement 10 000`, () => {
    const allocations = répartitionComplète();
    assert.equal(sumEnabledBasisPoints(allocations, macro), 10000);
    assert.equal(describeMacroBalance(allocations, macro).status, "complete");
  });
}

/* ── 4. Reste ───────────────────────────────────────────────────────────── */
test("4. un reste non réparti est signalé avec son message français", () => {
  const allocations = createEmptyAllocations().map((a) =>
    a.slot === "breakfast" ? { ...a, proteinBp: 9200 } : a,
  );
  const balance = describeMacroBalance(allocations, "protein");
  assert.equal(balance.status, "deficit");
  assert.equal(balance.remainingBp, 800);
  assert.equal(
    formatMacroBalanceMessage(allocations, "protein"),
    `Il reste 800 points de base, soit 8${NBSP}%, à répartir.`,
  );
});

/* ── 5. Dépassement ─────────────────────────────────────────────────────── */
test("5. un dépassement est signalé avec son message français", () => {
  const allocations = createEmptyAllocations().map((a) =>
    a.slot === "breakfast" ? { ...a, carbBp: 10000 } : a.slot === "lunch" ? { ...a, carbBp: 600 } : a,
  );
  const balance = describeMacroBalance(allocations, "carb");
  assert.equal(balance.status, "overflow");
  assert.equal(balance.overflowBp, 600);
  assert.equal(
    formatMacroBalanceMessage(allocations, "carb"),
    `La répartition dépasse 100${NBSP}% de 600 points de base, soit 6${NBSP}%.`,
  );
});

/* ── 6. Créneau désactivé obligatoirement à zéro ────────────────────────── */
test("6. un créneau désactivé porteur d'une allocation bloque l'assignation", () => {
  const allocations = répartitionComplète().map((a) =>
    a.slot === "dessert" ? { ...a, enabled: false } : a,
  );
  const résultat = validatePlanV2Assignable(planDepuis(allocations));
  assert.equal(résultat.ok, false);
  const codes = résultat.issues.map((i) => i.code);
  assert.ok(codes.includes("disabled_slot_with_allocation"));
  // Le créneau désactivé ne produit AUCUN gramme, même s'il porte une part.
  const distribution = computeMealDistribution(CIBLES, allocations);
  const dessert = distribution.slots.find((s) => s.slot === "dessert");
  assert.equal(dessert?.proteinGrams, 0);
  assert.equal(dessert?.calories, 0);
  // La remise à zéro est possible, mais UNIQUEMENT sur appel explicite.
  const nettoyées = normalizeDisabledSlots(allocations);
  assert.equal(nettoyées.find((a) => a.slot === "dessert")?.proteinBp, 0);
  assert.notEqual(allocations.find((a) => a.slot === "dessert")?.proteinBp, 0);
});

/* ── 7. Créneau actif à zéro : autorisé ─────────────────────────────────── */
test("7. un créneau actif à zéro est parfaitement valide", () => {
  let allocations = createEmptyAllocations();
  for (const macro of ["protein", "carb", "fat"] as const) {
    const résultat = distributeRemainingEqually(allocations, macro, {
      lockedSlots: ["dessert", "morning_snack"],
    });
    assert.ok(résultat.ok);
    allocations = résultat.allocations;
  }
  const dessert = allocations.find((a) => a.slot === "dessert");
  assert.equal(dessert?.enabled, true);
  assert.equal(dessert?.proteinBp, 0);
  const résultat = validatePlanV2Assignable(planDepuis(allocations));
  assert.equal(résultat.ok, true, JSON.stringify(résultat.issues));
});

/* ── 8. Grammes par créneau ─────────────────────────────────────────────── */
test("8. les grammes d'un créneau dérivent de l'objectif quotidien non arrondi", () => {
  const allocations = répartitionComplète();
  const distribution = computeMealDistribution(CIBLES, allocations);
  const petitDéjeuner = distribution.slots.find((s) => s.slot === "breakfast");
  const attendu = (119 * 1667) / 10000;
  assert.ok(Math.abs((petitDéjeuner?.proteinGrams ?? 0) - attendu) < 1e-12);
});

/* ── 9. Calories par créneau ────────────────────────────────────────────── */
test("9. les calories d'un créneau dérivent de ses propres grammes", () => {
  const allocations = createEmptyAllocations().map((a) =>
    a.slot === "lunch" ? { ...a, proteinBp: 10000, carbBp: 10000, fatBp: 10000 } : a,
  );
  const distribution = computeMealDistribution(CIBLES, allocations);
  const déjeuner = distribution.slots.find((s) => s.slot === "lunch");
  assert.ok(Math.abs((déjeuner?.calories ?? 0) - 1700) < 1e-9);
  const dîner = distribution.slots.find((s) => s.slot === "dinner");
  assert.equal(dîner?.calories, 0);
});

/* ── 10. Somme des repas = journée ──────────────────────────────────────── */
test("10. la somme des repas reconstitue exactement la journée", () => {
  const allocations = répartitionComplète();
  const distribution = computeMealDistribution(CIBLES, allocations);
  assert.ok(Math.abs(distribution.totals.proteinGrams - CIBLES.grams.proteinGrams) < 1e-9);
  assert.ok(Math.abs(distribution.totals.carbGrams - CIBLES.grams.carbGrams) < 1e-9);
  assert.ok(Math.abs(distribution.totals.fatGrams - CIBLES.grams.fatGrams) < 1e-9);
  assert.ok(Math.abs(distribution.totals.calories - 1700) < 1e-9);
});

/* ── 11. Mise à jour après changement quotidien ─────────────────────────── */
test("11. changer la cible quotidienne recalcule tous les créneaux", () => {
  const allocations = répartitionComplète();
  const doublées = computeDailyMacroTargets({
    dailyCalories: 3400,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
  const avant = computeMealDistribution(CIBLES, allocations);
  const après = computeMealDistribution(doublées, allocations);
  assert.ok(Math.abs(après.totals.proteinGrams - avant.totals.proteinGrams * 2) < 1e-9);
  const petitDéjeunerAvant = avant.slots.find((s) => s.slot === "breakfast");
  const petitDéjeunerAprès = après.slots.find((s) => s.slot === "breakfast");
  assert.ok(
    Math.abs((petitDéjeunerAprès?.proteinGrams ?? 0) - (petitDéjeunerAvant?.proteinGrams ?? 0) * 2) <
      1e-9,
  );
});

/* ── 12. Répartition automatique du reste ───────────────────────────────── */
test("12. la répartition automatique complète exactement les 10 000 points", () => {
  const résultat = distributeRemainingEqually(createEmptyAllocations(), "protein");
  assert.ok(résultat.ok);
  assert.equal(résultat.distributedBp, 10000);
  assert.equal(
    résultat.allocations.reduce((s, a) => s + a.proteinBp, 0),
    10000,
  );
});

/* ── 13. Verrouillage ───────────────────────────────────────────────────── */
test("13. les créneaux verrouillés sont préservés à l'unité près", () => {
  const départ = createEmptyAllocations().map((a) =>
    a.slot === "breakfast" ? { ...a, proteinBp: 3000 } : a,
  );
  const résultat = distributeRemainingEqually(départ, "protein", { lockedSlots: ["breakfast"] });
  assert.ok(résultat.ok);
  const parSlot = new Map(résultat.allocations.map((a) => [a.slot, a.proteinBp]));
  assert.equal(parSlot.get("breakfast"), 3000);
  for (const slot of MEAL_SLOT_KEYS.filter((s) => s !== "breakfast")) {
    assert.equal(parSlot.get(slot), 1400);
  }
  assert.equal(
    résultat.allocations.reduce((s, a) => s + a.proteinBp, 0),
    10000,
  );
});

/* ── 14. Refus propre si les lignes verrouillées dépassent déjà 10 000 ──── */
test("14. la répartition refuse proprement si les lignes verrouillées dépassent 10 000", () => {
  const départ = createEmptyAllocations().map((a) =>
    a.slot === "breakfast" || a.slot === "lunch" ? { ...a, proteinBp: 6000 } : a,
  );
  const résultat = distributeRemainingEqually(départ, "protein", {
    lockedSlots: ["breakfast", "lunch"],
  });
  assert.equal(résultat.ok, false);
  if (!résultat.ok) {
    assert.equal(résultat.reason, "locked_exceeds_total");
    assert.equal(résultat.remainingBp, -2000);
  }
  // Aucune écriture : le tableau d'origine est intact.
  assert.equal(départ.find((a) => a.slot === "breakfast")?.proteinBp, 6000);
});

/* ── 15. Assignation refusée si incomplet ───────────────────────────────── */
test("15. un plan à la répartition incomplète ne peut pas être assigné", () => {
  const allocations = createEmptyAllocations();
  const résultat = validatePlanV2Assignable(planDepuis(allocations));
  assert.equal(résultat.ok, false);
  const codes = résultat.issues.map((i) => i.code);
  assert.ok(codes.includes("protein_distribution_incomplete"));
  assert.ok(codes.includes("carb_distribution_incomplete"));
  assert.ok(codes.includes("fat_distribution_incomplete"));
  // Erreurs STRUCTURÉES : écart en points de base exploitable par l'interface.
  const protéines = résultat.issues.find((i) => i.code === "protein_distribution_incomplete");
  assert.equal(protéines?.expectedBp, 10000);
  assert.equal(protéines?.actualBp, 0);
  assert.equal(protéines?.deltaBp, -10000);
  assert.equal(formatPlanV2AssignabilityMessage(résultat), PLAN_V2_DISTRIBUTION_MESSAGE_FR);
});

/* ── 16. Brouillon autorisé ─────────────────────────────────────────────── */
test("16. un brouillon incomplet reste enregistrable", () => {
  const brouillon = planDepuis(createEmptyAllocations());
  assert.equal(validatePlanV2Draft(brouillon).ok, true);
  assert.equal(validatePlanV2Assignable(brouillon).ok, false);
  // Une valeur hors domaine, elle, bloque même le brouillon.
  const invalide = planDepuis(
    createEmptyAllocations().map((a) => (a.slot === "lunch" ? { ...a, proteinBp: 20000 } : a)),
  );
  const brouillonInvalide = validatePlanV2Draft(invalide);
  assert.equal(brouillonInvalide.ok, false);
  assert.ok(brouillonInvalide.issues.some((i) => i.code === "value_out_of_range"));
});

/* ── 17. Aucun arrondi cumulatif ────────────────────────────────────────── */
test("17. les grammes ne subissent aucun arrondi cumulatif", () => {
  const allocations = répartitionComplète();
  const distribution = computeMealDistribution(CIBLES, allocations);
  const sommeExacte = distribution.slots.reduce((s, x) => s + x.proteinGrams, 0);
  const sommeArrondie = distribution.slots.reduce((s, x) => s + Math.round(x.proteinGrams), 0);
  assert.ok(Math.abs(sommeExacte - 119) < 1e-9, "la somme non arrondie doit valoir la journée");
  assert.equal(sommeArrondie, 120, "arrondir chaque repas ferait bien dériver le total");
  assert.notEqual(sommeArrondie, Math.round(sommeExacte));
});

/* ── 18. Répartition déterministe des points restants ───────────────────── */
test("18. les points restants sont attribués dans l'ordre d'affichage", () => {
  const résultat = distributeRemainingEqually(createEmptyAllocations(), "protein");
  assert.ok(résultat.ok);
  const parSlot = new Map(résultat.allocations.map((a) => [a.slot, a.proteinBp]));
  // 10 000 / 6 = 1 666 reste 4 ⇒ les QUATRE premiers créneaux prennent +1.
  assert.equal(parSlot.get("breakfast"), 1667);
  assert.equal(parSlot.get("morning_snack"), 1667);
  assert.equal(parSlot.get("lunch"), 1667);
  assert.equal(parSlot.get("afternoon_snack"), 1667);
  assert.equal(parSlot.get("dinner"), 1666);
  assert.equal(parSlot.get("dessert"), 1666);
  // Rejeu identique.
  const bis = distributeRemainingEqually(createEmptyAllocations(), "protein");
  assert.deepEqual(bis.ok && bis.allocations, résultat.allocations);
});

/* ── 19. Aucun créneau actif ────────────────────────────────────────────── */
test("19. un plan sans aucun créneau actif ne peut pas être assigné", () => {
  const allocations = createEmptyAllocations().map((a) => ({ ...a, enabled: false }));
  const résultat = validatePlanV2Assignable(planDepuis(allocations));
  assert.equal(résultat.ok, false);
  assert.ok(résultat.issues.some((i) => i.code === "no_enabled_slot"));
});

/* ── 20. Les plans v1 ne passent pas par la validation v2 ───────────────── */
test("20. un plan v1 est explicitement écarté de la validation v2", () => {
  const planV1: NutritionPlanV2 = { ...planDepuis(répartitionComplète()), nutritionModelVersion: 1 };
  const brouillon = validatePlanV2Draft(planV1);
  const assignable = validatePlanV2Assignable(planV1);
  assert.equal(brouillon.ok, false);
  assert.equal(brouillon.issues[0]?.code, "not_v2");
  assert.equal(assignable.ok, false);
  assert.equal(assignable.issues[0]?.code, "not_v2");
});

/* ── 21. Profil default absent ──────────────────────────────────────────── */
test("21. l'absence de profil « default » bloque l'assignation", () => {
  const plan: NutritionPlanV2 = {
    id: "plan-sans-profil",
    nutritionModelVersion: NUTRITION_MODEL_VERSION_STRUCTURED,
    name: "Sans profil",
    profiles: [],
  };
  const résultat = validatePlanV2Assignable(plan);
  assert.equal(résultat.ok, false);
  assert.equal(résultat.issues[0]?.code, "missing_default_profile");
  assert.equal(
    formatPlanV2AssignabilityMessage(résultat),
    "Le profil de répartition « default » est absent : ce plan ne peut pas être assigné.",
  );
});

/* ── 22. Calories nulles : brouillon accepté, assignation refusée ───────── */
test("22. des calories nulles n'empêchent pas le brouillon mais bloquent l'assignation", () => {
  const plan = planDepuis(répartitionComplète());
  const sansCalories: NutritionPlanV2 = {
    ...plan,
    profiles: [{ ...plan.profiles[0], dailyCalories: 0 }],
  };
  assert.equal(validatePlanV2Draft(sansCalories).ok, true);
  const assignable = validatePlanV2Assignable(sansCalories);
  assert.equal(assignable.ok, false);
  assert.ok(assignable.issues.some((i) => i.code === "calories_not_positive"));
});

/* ── 23. Aucune mutation des entrées ────────────────────────────────────── */
test("23. les fonctions de répartition ne modifient jamais leurs entrées", () => {
  const départ = createEmptyAllocations().map((a) => Object.freeze({ ...a }));
  Object.freeze(départ);
  const copie = départ.map((a) => ({ ...a }));
  const résultat = distributeRemainingEqually(départ, "protein");
  assert.ok(résultat.ok);
  assert.deepEqual(
    départ.map((a) => ({ ...a })),
    copie,
  );
  computeMealDistribution(CIBLES, départ);
  assert.deepEqual(
    départ.map((a) => ({ ...a })),
    copie,
  );
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
