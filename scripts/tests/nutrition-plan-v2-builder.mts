/**
 * Harnais — feat/nutrition-plan-v2-builder (PR 2).
 *
 * Constructeur admin du modèle nutrition v2 : cohabitation v1/v2, conversion
 * explicite, points de base, créneaux, trois répartitions indépendantes,
 * récapitulatif, brouillon vs assignable, sauvegarde par RPC, garde
 * d'assignation, lecture canonique, structure responsive et accessibilité.
 *
 * Lancement : npx tsx scripts/tests/nutrition-plan-v2-builder.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { verifierManifesteDesMigrations } from "./contrat-migrations.mjs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { BASIS_POINTS_TOTAL } from "../../lib/nutrition/basis-points";
import {
  MEAL_SLOT_KEYS,
  describeMacroBalance,
} from "../../lib/nutrition/meal-distribution";
import {
  prefillFromLegacyDailyTarget,
  repartirAuProrata,
  CONVERSION_CONFIRMATION_MESSAGE_FR,
} from "../../lib/nutrition/plan-v2-conversion";
import {
  buildRecap,
  createBlankFormState,
  setDailyCalories,
  createFormStateFromPrefill,
  distributeRestForMacro,
  formatPercentInput,
  isSlotLocked,
  parsePercentInput,
  setDailyMacroBp,
  setSlotEnabled,
  setSlotMacroBp,
  slotBasisPointsFor,
  toSaveInput,
  toValidationPlan,
  toggleSlotLock,
  type PlanV2FormState,
} from "../../lib/nutrition/plan-v2-form";
import {
  NUTRITION_MODEL_VERSION_STRUCTURED,
  validatePlanV2Assignable,
  validatePlanV2Draft,
  PLAN_V2_DISTRIBUTION_MESSAGE_FR,
} from "../../lib/nutrition/plan-v2-validation";
import {
  applyDayMacroPreset,
  createBlankWeek,
  creneauxActifs,
  findDay,
  initializeAllDays,
  presetApplicable,
  setDayCalories,
  setDayMacroBp,
  setDaySlotEnabled,
  setDaySlotMacroBp,
  toggleDaySlotLock,
  type WeekFormState,
} from "../../lib/nutrition/plan-v2-week-form";
import {
  HORAIRES_ENTRAINEMENT,
  NOMBRES_DE_REPAS_COUVERTS,
  PRESETS_MACROS,
  type HoraireEntrainement,
  type NombreDeRepasCouvert,
} from "../../lib/nutrition/macro-presets";
import { MEAL_SLOT_LABELS_FR } from "../../lib/nutrition/meal-distribution";
import { toDuplicateWeekPayload, toWeekSavePayload } from "../../lib/nutrition/plan-v2-week-form";
import { ConfirmActionModal, DeleteConfirmationModal } from "../../components/admin/LifecycleActions";
import {
  describeHidingFromStudent,
  describePlanDeletionBlock,
  describePlanDeletionSideEffects,
  duplicateName,
  hidesPlanFromAssignedStudent,
  planLifecycleActions,
  planStatusAfter,
  PLAN_ACTION_LABELS_FR,
  DELETE_ACTION_LABEL_FR,
} from "../../lib/nutrition/lifecycle";
import { evaluateLegacyWrite } from "../../lib/nutrition/plan-v2-guards";
import { guardNutritionAssignment } from "../../lib/supabase/nutrition-assignment-guard";
import { NutritionPlanV2Builder } from "../../components/admin/NutritionPlanV2Builder";

let réussis = 0;
let échecs = 0;
function test(nom: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      réussis += 1;
      console.log(`ok - ${nom}`);
    })
    .catch((erreur) => {
      échecs += 1;
      console.error(`ÉCHEC - ${nom}`);
      console.error(erreur);
    });
}

function lire(chemin: string): string {
  return readFileSync(new URL(chemin, import.meta.url), "utf8");
}
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const PAGE_PLAN = lire("../../app/admin/nutrition/[planId]/page.tsx");
const PAGE_LISTE = lire("../../app/admin/nutrition/page.tsx");
const BUILDER = lire("../../components/admin/NutritionPlanV2Builder.tsx");
const PANNEAU = lire("../../components/admin/NutritionMacroDistributionPanel.tsx");
const LOADER = lire("../../hooks/useNutritionPlanV2.ts");
const PAGE_NOUVEAU = lire("../../app/admin/nutrition/nouveau/page.tsx");
const PAGE_ELEVE = lire("../../app/admin/eleves/[studentId]/page.tsx");
const PAGE_ELEVES = lire("../../app/admin/eleves/page.tsx");
const COUCHE_NUTRITION = lire("../../lib/supabase/nutrition.ts");
const MIGRATION_V2 = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
const MIGRATION_HEBDO = lire("../../supabase/migrations/20260805090000_nutrition_plan_v2_weekly_target.sql");

const META = {
  planId: "plan-1",
  name: "Plan de test",
  goalType: "maintien",
  status: "brouillon",
  coachNotes: "",
  hydrationTip: "",
};

/** État complet et valide : 1 700 kcal, 28/48/24, six créneaux à 100 %. */
function étatComplet(): PlanV2FormState {
  let s = createFormStateFromPrefill(
    prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }),
    META,
  );
  for (const slot of MEAL_SLOT_KEYS) {
    s = setSlotEnabled(s, slot, true);
  }
  s = setDailyMacroBp(setDailyMacroBp(setDailyMacroBp(s, "protein", 2800), "carb", 4800), "fat", 2400);
  for (const macro of ["protein", "carb", "fat"] as const) {
    const r = distributeRestForMacro(s, macro);
    assert.ok(r.ok);
    s = r.state;
  }
  return s;
}

/**
 * Semaine complète et valide : sept jours à 2 000 kcal, 28/48/24, six
 * créneaux répartis à 100 %. Depuis la refonte « semaine d'abord », c'est
 * elle — et non plus l'objectif global — qui rend un plan assignable.
 */
function semaineComplète(): WeekFormState {
  return initializeAllDays(createBlankWeek(), {
    dailyCalories: 2000,
    proteinBp: 2800,
    carbBp: 4800,
    fatBp: 2400,
  });
}

function rendre(
  state: PlanV2FormState,
  options: { serverError?: string | null; week?: WeekFormState } = {},
): string {
  return renderToString(
    createElement(NutritionPlanV2Builder, {
      state,
      onChange: () => {},
      onSave: () => {},
      saving: false,
      serverError: options.serverError ?? null,
      week: options.week ?? semaineComplète(),
      onWeekChange: () => {},
    }),
  );
}

/* ══════════ Cohabitation v1 / v2 ══════════ */

await test("1. il n'existe PLUS d'ancien éditeur : la cohabitation v1/v2 est terminée", () => {
  // PR C — le modèle v1 a disparu (migration 20260811090000, contrainte
  // `nutrition_model_version = 2`). Ce test affirmait l'inverse ; il affirme
  // maintenant la nouvelle garantie, plutôt que d'être supprimé pour obtenir
  // du vert.
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(!src.includes("editing && !isV2"), "plus aucun branchement sur !isV2");
  assert.ok(!src.includes("<NutritionPlanBuilder"), "le constructeur v1 n'est plus monté");
  assert.ok(!src.includes("updateNutritionPlanSupabase("), "l'écriture v1 n'a plus d'appelant");
  assert.ok(src.includes("<NutritionPlanV2Builder"), "il ne reste qu'un constructeur");
});

await test("2. aucune conversion au chargement", () => {
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(!src.includes("useEffect"), "aucun effet ne doit dériver d'état au chargement");
  // Le loader canonique n'est activé QUE pour un plan déjà v2.
  assert.ok(src.includes("Boolean(isV2 && isSupabasePlansActive)"));
  // Le préremplissage n'est appelé QUE depuis l'action de conversion.
  assert.equal(src.split("prefillFromLegacyDailyTarget(").length - 1, 1);
  assert.ok(src.includes("function ouvrirConversion()"));
});

await test("3. la conversion exige une confirmation explicite", () => {
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(src.includes("setConversionDialogOpen(true)"), "le bouton ouvre la modale");
  assert.ok(src.includes("onContinue={ouvrirConversion}"), "la conversion part de « Continuer »");
  assert.ok(src.includes("Activer la répartition avancée"));
  const dialogue = lire("../../components/admin/NutritionPlanV2ConversionDialog.tsx");
  assert.ok(dialogue.includes("CONVERSION_CONFIRMATION_MESSAGE_FR"));
  assert.ok(dialogue.includes("Annuler") && dialogue.includes("Continuer vers le constructeur"));
  assert.ok(CONVERSION_CONFIRMATION_MESSAGE_FR.includes("devra être complétée manuellement"));
});

/* ══════════ Préremplissage de la conversion ══════════ */

await test("4. les calories sont préremplies depuis daily_target", () => {
  const p = prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 });
  assert.equal(p.dailyCalories, 1700);
  // À défaut de calories saisies, celles reconstituées depuis les grammes.
  const sansCal = prefillFromLegacyDailyTarget({ protein: 100, carbs: 100, fat: 100 });
  assert.equal(sansCal.dailyCalories, Math.round(100 * 4 + 100 * 4 + 100 * 9));
});

await test("5. les points de base sont dérivés des grammes de façon déterministe", () => {
  const p = prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 });
  // 476 / 816 / 405 kcal ⇒ 1697 kcal au total.
  assert.ok(Math.abs(p.caloriesFromGrams - 1697) < 1e-9);
  assert.equal(p.derivedFromGrams, true);
  const bis = prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 });
  assert.deepEqual(bis, p, "deux appels identiques donnent un résultat identique");
});

await test("6. le total des points de base après conversion vaut exactement 10 000", () => {
  const cas = [
    { calories: 1700, protein: 119, carbs: 204, fat: 45 },
    { calories: 2000, protein: 150, carbs: 200, fat: 60 },
    { calories: 1234, protein: 33, carbs: 77, fat: 11 },
    { calories: 999, protein: 1, carbs: 1, fat: 1 },
  ];
  for (const c of cas) {
    const p = prefillFromLegacyDailyTarget(c);
    assert.equal(p.proteinBp + p.carbBp + p.fatBp, 10000, JSON.stringify(c));
    for (const bp of [p.proteinBp, p.carbBp, p.fatBp]) {
      assert.ok(Number.isInteger(bp) && bp >= 0 && bp <= 10000);
    }
  }
  // Aucune donnée exploitable ⇒ aucune répartition inventée, aucun NaN.
  const vide = prefillFromLegacyDailyTarget(null);
  assert.deepEqual([vide.proteinBp, vide.carbBp, vide.fatBp], [0, 0, 0]);
  assert.equal(vide.derivedFromGrams, false);
  assert.equal(Number.isNaN(vide.dailyCalories), false);
  // Règle de résidu documentée : plus grande partie fractionnaire d'abord.
  const r = repartirAuProrata({ protein: 1, carb: 1, fat: 1 });
  assert.equal(r.bp.protein + r.bp.carb + r.bp.fat, 10000);
  assert.equal(r.residualBp, 1);
  assert.equal(r.bp.protein, 3334, "le résidu va au premier dans l'ordre canonique");
});

await test("7. les distributions par repas partent à zéro", () => {
  const p = prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 });
  assert.equal(p.slots.length, 6);
  for (const s of p.slots) {
    assert.equal(s.proteinBp, 0);
    assert.equal(s.carbBp, 0);
    assert.equal(s.fatBp, 0);
  }
});

await test("8. aucun créneau n'est activé d'office", () => {
  const p = prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 });
  assert.equal(p.slots.filter((s) => s.enabled).length, 0);
  assert.deepEqual(p.slots.map((s) => s.slot), [...MEAL_SLOT_KEYS]);
});

/* ══════════ Objectif quotidien ══════════ */

await test("9. le slider quotidien est piloté par les points de base", () => {
  const html = rendre(étatComplet());
  assert.ok(html.includes('type="range"'));
  assert.ok(html.includes('aria-valuemin="0"'));
  assert.ok(html.includes('aria-valuemax="100"'));
  assert.ok(html.includes('aria-valuenow="28"'), "28 % ⇔ 2 800 bp");
  assert.ok(html.includes('aria-valuenow="48"'));
  assert.ok(html.includes('aria-valuenow="24"'));
});

await test("10. le champ numérique et les points de base sont réversibles", () => {
  assert.deepEqual(parsePercentInput("28"), { ok: true, bp: 2800 });
  assert.deepEqual(parsePercentInput("33,33"), { ok: true, bp: 3333 });
  assert.deepEqual(parsePercentInput("100"), { ok: true, bp: 10000 });
  assert.deepEqual(parsePercentInput(""), { ok: true, bp: 0 });
  assert.equal(formatPercentInput(3333), "33,33");
  assert.equal(formatPercentInput(2800), "28");
  // AUCUN écrêtage silencieux : hors bornes ⇒ refus explicite, état inchangé.
  const trop = parsePercentInput("120");
  assert.equal(trop.ok, false);
  const negatif = parsePercentInput("-5");
  assert.equal(negatif.ok, false);
  const illisible = parsePercentInput("abc");
  assert.equal(illisible.ok, false);
  const s = étatComplet();
  assert.equal(setDailyMacroBp(s, "protein", 20000), s, "une valeur hors domaine ne change rien");
});

await test("11. un jour dont les macros ne totalisent pas 100 % est signalé", () => {
  // RÉÉCRIT PAR LA REFONTE « SEMAINE D'ABORD ». Ce contrôle vérifiait le
  // message de déficit de l'objectif quotidien GLOBAL, qui n'existe plus :
  // chaque jour porte le sien. Un jour vierge (0 / 0 / 0) est le seul état
  // incomplet encore atteignable, puisque les curseurs sont solidaires.
  const html = rendre(étatComplet(), { week: createBlankWeek() });
  assert.ok(
    html.includes("doivent totaliser exactement 100"),
    "le jour ouvert signale son total incomplet",
  );
  // Et un jour complet ne dit rien.
  assert.ok(!rendre(étatComplet()).includes("doivent totaliser exactement 100"));
});

await test("12. les curseurs solidaires rendent tout dépassement IMPOSSIBLE", () => {
  // RÉÉCRIT. Le message de dépassement quotidien n'a plus de raison d'être :
  // la solidarité des trois curseurs garantit un total de 100 % à chaque
  // mouvement. On vérifie la garantie qui l'a remplacé, pas le message.
  let s = createBlankWeek();
  for (const [macro, valeur] of [
    ["protein", 9000],
    ["carb", 8000],
    ["fat", 7000],
  ] as const) {
    s = setDayCalories(s, "monday", 2000);
    const t = setDayMacroBp(s, "monday", macro, valeur);
    const jour = t.days.find((d) => d.day === "monday")!;
    assert.equal(
      jour.proteinBp + jour.carbBp + jour.fatBp,
      BASIS_POINTS_TOTAL,
      `${macro} porté à ${valeur} bp`,
    );
    s = t;
  }
  // Aucun message de dépassement n'est donc rendu.
  assert.ok(!rendre(étatComplet(), { week: s }).includes("dépasse 100"));
});

/* ══════════ Créneaux ══════════ */

await test("13. activer un créneau le rend disponible à la répartition", () => {
  let s = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), META);
  assert.equal(s.slots.filter((x) => x.enabled).length, 0);
  s = setSlotEnabled(s, "breakfast", true);
  assert.equal(s.slots.filter((x) => x.enabled).length, 1);
  assert.equal(s.slots.find((x) => x.slot === "breakfast")?.enabled, true);
});

await test("14. désactiver un créneau remet immédiatement P/G/L à zéro", () => {
  let s = étatComplet();
  const avant = s.slots.find((x) => x.slot === "dessert");
  assert.ok((avant?.proteinBp ?? 0) > 0);
  s = setSlotEnabled(s, "dessert", false);
  const après = s.slots.find((x) => x.slot === "dessert");
  assert.equal(après?.enabled, false);
  assert.equal(après?.proteinBp, 0);
  assert.equal(après?.carbBp, 0);
  assert.equal(après?.fatBp, 0);
  // Il reste dans le payload, avec enabled=false et trois zéros.
  const payload = toSaveInput(s);
  assert.equal(payload.slots.length, 6);
  const dessert = payload.slots.find((x) => x.slot === "dessert");
  assert.equal(dessert?.enabled, false);
  assert.equal(dessert?.proteinBp, 0);
  // Et il ne compte plus dans les totaux.
  assert.equal(describeMacroBalance(s.slots, "protein").totalBp < 10000, true);
});

await test("15. un créneau actif à zéro est autorisé", () => {
  let s = étatComplet();
  s = setSlotMacroBp(s, "dessert", "protein", 0);
  const restant = 10000 - describeMacroBalance(s.slots, "protein").totalBp;
  s = setSlotMacroBp(s, "breakfast", "protein", slotBasisPointsFor(s, "breakfast", "protein") + restant);
  assert.equal(describeMacroBalance(s.slots, "protein").totalBp, 10000);
  assert.equal(s.slots.find((x) => x.slot === "dessert")?.enabled, true);
  assert.equal(validatePlanV2Assignable(toValidationPlan(s)).ok, true);
});

/* ══════════ Indépendance des trois répartitions ══════════ */

await test("16. les protéines sont indépendantes des glucides", () => {
  let s = étatComplet();
  const glucidesAvant = s.slots.map((x) => x.carbBp);
  s = setSlotMacroBp(s, "breakfast", "protein", 5000);
  assert.deepEqual(s.slots.map((x) => x.carbBp), glucidesAvant);
  assert.equal(slotBasisPointsFor(s, "breakfast", "protein"), 5000);
});

await test("17. les glucides sont indépendants des lipides", () => {
  let s = étatComplet();
  const lipidesAvant = s.slots.map((x) => x.fatBp);
  s = setSlotMacroBp(s, "lunch", "carb", 2000);
  assert.deepEqual(s.slots.map((x) => x.fatBp), lipidesAvant);
  // Un même repas peut porter trois parts totalement différentes.
  let t = étatComplet();
  t = setSlotMacroBp(t, "breakfast", "protein", 5000);
  t = setSlotMacroBp(t, "breakfast", "carb", 2000);
  t = setSlotMacroBp(t, "breakfast", "fat", 3000);
  assert.equal(slotBasisPointsFor(t, "breakfast", "protein"), 5000);
  assert.equal(slotBasisPointsFor(t, "breakfast", "carb"), 2000);
  assert.equal(slotBasisPointsFor(t, "breakfast", "fat"), 3000);
});

/* ══════════ Répartir le reste ══════════ */

await test("18. « répartir le reste » complète exactement 10 000", () => {
  let s = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), META);
  for (const slot of MEAL_SLOT_KEYS) s = setSlotEnabled(s, slot, true);
  const r = distributeRestForMacro(s, "protein");
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(describeMacroBalance(r.state.slots, "protein").totalBp, 10000);
    // Les autres macros ne bougent pas.
    assert.deepEqual(r.state.slots.map((x) => x.carbBp), s.slots.map((x) => x.carbBp));
  }
});

await test("19. les lignes verrouillées sont préservées", () => {
  let s = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), META);
  for (const slot of MEAL_SLOT_KEYS) s = setSlotEnabled(s, slot, true);
  s = setSlotMacroBp(s, "breakfast", "protein", 3000);
  s = toggleSlotLock(s, "protein", "breakfast");
  assert.equal(isSlotLocked(s, "protein", "breakfast"), true);
  const r = distributeRestForMacro(s, "protein");
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(slotBasisPointsFor(r.state, "breakfast", "protein"), 3000);
    assert.equal(describeMacroBalance(r.state.slots, "protein").totalBp, 10000);
  }
  // Verrous dépassant déjà 100 % ⇒ refus propre, aucune écriture.
  let t = s;
  t = setSlotMacroBp(t, "lunch", "protein", 8000);
  t = toggleSlotLock(t, "protein", "lunch");
  const refus = distributeRestForMacro(t, "protein");
  assert.equal(refus.ok, false);
  if (!refus.ok) assert.equal(refus.reason, "locked_exceeds_total");
});

await test("20. le résidu est attribué de manière déterministe, par ordre d'affichage", () => {
  let s = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), META);
  for (const slot of MEAL_SLOT_KEYS) s = setSlotEnabled(s, slot, true);
  const r = distributeRestForMacro(s, "protein");
  assert.ok(r.ok);
  if (!r.ok) return;
  const parSlot = new Map(r.state.slots.map((x) => [x.slot, x.proteinBp]));
  assert.equal(parSlot.get("breakfast"), 1667);
  assert.equal(parSlot.get("morning_snack"), 1667);
  assert.equal(parSlot.get("lunch"), 1667);
  assert.equal(parSlot.get("afternoon_snack"), 1667);
  assert.equal(parSlot.get("dinner"), 1666);
  assert.equal(parSlot.get("dessert"), 1666);
  const bis = distributeRestForMacro(s, "protein");
  assert.deepEqual(bis.ok && bis.state.slots, r.state.slots);
});

/* ══════════ Récapitulatif ══════════ */

await test("21. le récapitulatif donne les grammes par repas", () => {
  const s = étatComplet();
  const recap = buildRecap(s);
  const petitDej = recap.rows.find((r) => r.slot === "breakfast");
  assert.ok(Math.abs((petitDej?.proteinGrams ?? 0) - (119 * 1667) / 10000) < 1e-9);
  assert.ok(Math.abs(recap.totals.proteinGrams - 119) < 1e-9);
  assert.ok(Math.abs(recap.totals.carbGrams - 204) < 1e-9);
});

await test("22. le récapitulatif donne les calories par repas et le total", () => {
  const s = étatComplet();
  const recap = buildRecap(s);
  const petitDej = recap.rows.find((r) => r.slot === "breakfast");
  const attendu =
    (petitDej?.proteinGrams ?? 0) * 4 + (petitDej?.carbGrams ?? 0) * 4 + (petitDej?.fatGrams ?? 0) * 9;
  assert.ok(Math.abs((petitDej?.calories ?? 0) - attendu) < 1e-9);
  assert.ok(Math.abs(recap.totals.calories - 1700) < 1e-6);
  assert.equal(recap.requestedCalories, 1700);
  assert.ok(Math.abs(recap.displayGapCalories) < 1e-6, "aucun écart réel ici");
});

await test("23. aucun arrondi cumulatif dans le récapitulatif", () => {
  const s = étatComplet();
  const recap = buildRecap(s);
  const actifs = recap.rows.filter((r) => r.enabled);
  const sommeExacte = actifs.reduce((acc, r) => acc + r.proteinGrams, 0);
  const sommeArrondie = actifs.reduce((acc, r) => acc + Math.round(r.proteinGrams), 0);
  assert.ok(Math.abs(sommeExacte - 119) < 1e-9);
  assert.equal(sommeArrondie, 120, "arrondir chaque repas ferait bien dériver le total");
});

/* ══════════ Brouillon et assignable ══════════ */

await test("24. un brouillon incomplet reste enregistrable", () => {
  const s = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 0 }), META);
  assert.equal(validatePlanV2Draft(toValidationPlan(s)).ok, true);
  const payload = toSaveInput(s);
  assert.equal(payload.slots.length, 6, "le payload reste structurellement valide pour la RPC");
  for (const slot of payload.slots) {
    assert.equal(slot.proteinBp, 0);
    assert.equal(slot.enabled, false);
  }
});

await test("25. un plan incomplet ne peut pas être assigné", () => {
  const s = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), META);
  const v = validatePlanV2Assignable(toValidationPlan(s));
  assert.equal(v.ok, false);
  const codes = v.issues.map((i) => i.code);
  assert.ok(codes.includes("no_enabled_slot"));
  const html = rendre(s);
  assert.ok(html.includes("Enregistrer et rendre assignable"));
});

await test("26. un plan complet est assignable", () => {
  const s = étatComplet();
  const v = validatePlanV2Assignable(toValidationPlan(s));
  assert.equal(v.ok, true, JSON.stringify(v.issues));
  assert.ok(rendre(s).includes("Assignable"));
});

/* ══════════ Sauvegarde ══════════ */

await test("27. la sauvegarde v2 passe EXCLUSIVEMENT par la RPC", () => {
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(src.includes("saveNutritionPlanV2(supabase,"), "la RPC est le seul chemin d'écriture v2");
  // DEUX appels depuis la PR D — l'enregistrement et la duplication — mais un
  // seul chemin : le second passe par la MÊME fonction, avec `planId: null`.
  // Ce qui compte n'est donc plus le nombre d'appels mais l'absence de tout
  // autre chemin d'écriture, vérifiée juste après et au contrôle 28.
  assert.equal(src.split("saveNutritionPlanV2(").length - 1, 2);
  assert.ok(src.includes("planId: null,"), "la duplication crée un plan par la même RPC");
  assert.ok(
    !/\.from\(\s*"nutrition_plans"\s*\)[\s\S]{0,80}\.(insert|update|upsert|delete)\(/.test(src),
    "aucune écriture directe dans nutrition_plans depuis la page",
  );
  const wrapper = sansCommentaires(lire("../../lib/supabase/nutrition-v2.ts"));
  assert.ok(wrapper.includes('rpc("save_nutrition_plan_v2"'), "le wrapper appelle bien la RPC");
});

await test("28. aucune écriture directe dans les tables enfants", () => {
  const sources = [PAGE_PLAN, PAGE_LISTE, BUILDER, PANNEAU].map(sansCommentaires).join("\n");
  for (const table of ["nutrition_plan_profiles", "nutrition_meal_slot_targets"]) {
    assert.ok(!sources.includes(table), `${table} ne doit être touchée que par la RPC`);
  }
  for (const verbe of [".insert(", ".upsert(", ".delete("]) {
    assert.ok(!sources.includes(verbe), `écriture directe interdite dans les vues : ${verbe}`);
  }
});

await test("29. une erreur RPC conserve le formulaire et ses valeurs", () => {
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(src.includes("setV2Error(resultat.message);"));
  // Sur échec : on sort AVANT de remplacer l'état local.
  const bloc = src.slice(src.indexOf("if (!resultat.ok)"), src.indexOf("createFormStateFromCanonical(\n        resultat.plan"));
  assert.ok(bloc.includes("return;"), "l'échec sort avant toute réinitialisation");
  assert.ok(!bloc.includes("setConversionMode(false)"), "l'éditeur ne se referme pas sur échec");
  const html = rendre(étatComplet(), { serverError: "INVALID_PAYLOAD: profile manquant" });
  assert.ok(html.includes("INVALID_PAYLOAD: profile manquant"));
  // Le « Récapitulatif » global a disparu avec l'objectif quotidien global :
  // c'est la semaine qui prouve désormais que le formulaire est resté ouvert.
  assert.ok(html.includes("Semaine alimentaire"), "le formulaire reste affiché");
});

await test("30. un succès recharge le retour canonique de la RPC", () => {
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(src.includes("createFormStateFromCanonical(\n        resultat.plan"));
  assert.ok(src.includes("await canonique.refetch();"));
  assert.ok(src.includes("await supabaseNutritionPlans.refetch();"));
});

await test("31. updateNutritionPlan n'a plus AUCUN appelant dans l'écran de plan", () => {
  const src = sansCommentaires(PAGE_PLAN);
  // Le chemin d'écriture v1 a été retiré avec l'éditeur v1 : il n'y a plus
  // un seul appel à contenir, il n'y en a plus du tout.
  assert.equal(src.split("updateNutritionPlanSupabase(").length - 1, 0);
  assert.ok(src.includes("saveNutritionPlanV2("), "la RPC v2 est le seul chemin d'écriture");
  // Et la garde de la PR 1 refuse toujours au niveau de la couche d'accès.
  assert.equal(evaluateLegacyWrite(NUTRITION_MODEL_VERSION_STRUCTURED).allowed, false);
});

await test("32. l'ancienne fonction reste utilisable pour un plan v1", () => {
  assert.equal(evaluateLegacyWrite(1).allowed, true);
  assert.equal(evaluateLegacyWrite(null).allowed, true);
});

/* ══════════ Assignation ══════════ */

/** Double de client Supabase qui compte les requêtes émises. */
function clientDouble(plan: Record<string, unknown> | null, profils: unknown[], creneaux: unknown[], journal: string[]) {
  const chaine = (table: string, data: unknown) => {
    const api = {
      select: () => api,
      eq: () => api,
      in: () => api,
      order: () => api,
      maybeSingle: async () => ({ data: Array.isArray(data) ? data[0] ?? null : data, error: null }),
      then: undefined,
    };
    void table;
    return api;
  };
  return {
    from(table: string) {
      journal.push(table);
      if (table === "nutrition_plans") return chaine(table, plan);
      if (table === "nutrition_plan_profiles") return { ...chaine(table, profils), then: undefined };
      return chaine(table, creneaux);
    },
  };
}

await test("33. l'assignation d'un plan v1 n'est pas régressée", async () => {
  const journal: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = await guardNutritionAssignment(clientDouble(null, [], [], journal) as any, "plan-1", true, 1);
  assert.equal(d.allowed, true);
  assert.deepEqual(journal, [], "aucune requête quand la version est déjà connue");
  // Un retrait passe toujours, quelle que soit la version.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const retrait = await guardNutritionAssignment(clientDouble(null, [], [], journal) as any, "plan-1", false, 2);
  assert.equal(retrait.allowed, true);
});

await test("34. un plan v2 invalide est refusé AVANT toute écriture", () => {
  const hook = sansCommentaires(lire("../../hooks/useGuardedNutritionAssignment.ts"));
  const indexGarde = hook.indexOf("const decision = await guardNutritionAssignment");
  const indexRefus = hook.indexOf("return false;");
  // Depuis fix/nutrition-single-assigned-plan, l'écriture est awaitée pour
  // pouvoir afficher un refus venu de la base : le point d'écriture reste
  // `base(...)`, toujours APRÈS le refus.
  const indexBase = hook.indexOf("await base(studentId, contentType, contentId, assigned);", indexRefus);
  assert.ok(indexGarde < indexRefus && indexRefus < indexBase, "le refus précède l'appel d'écriture");
  assert.ok(hook.includes('if (contentType !== "nutrition")'), "programmes et documents non impactés");
  // La garde est branchée sur les DEUX points d'entrée admin.
  assert.ok(sansCommentaires(PAGE_PLAN).includes("guarded.setAssignment"));
  assert.ok(sansCommentaires(PAGE_LISTE).includes("guarded.setAssignment"));
  assert.ok(PLAN_V2_DISTRIBUTION_MESSAGE_FR.startsWith("Complète la répartition"));
});

await test("35. la lecture canonique n'émet aucun N+1", () => {
  const src = sansCommentaires(lire("../../lib/supabase/nutrition-v2.ts"));
  const lecture = src.slice(src.indexOf("export async function readNutritionPlanV2"), src.indexOf("export interface SaveNutritionPlanV2Input"));
  assert.equal(lecture.split(".from(").length - 1, 3, "exactement trois requêtes groupées");
  assert.ok(lecture.includes('.in(\n      "profile_id"'), "les créneaux sont lus en une seule requête");
  assert.ok(!/for\s*\(/.test(lecture), "aucune requête dans une boucle");
  assert.ok(sansCommentaires(LOADER).includes("readNutritionPlanV2(supabase, planId)"));
});

await test("36. le suivi nutritionnel élève est inchangé", () => {
  const logs = lire("../../lib/supabase/nutrition-logs.ts");
  assert.ok(!logs.includes("nutrition_model_version"));
  assert.ok(!logs.includes("save_nutrition_plan_v2"));
  // Aucun composant élève ne connaît le modèle v2.
  for (const fichier of [
    "../../components/student/NutritionPlanCard.tsx",
    "../../components/student/NutritionPlanWorkspace.tsx",
  ]) {
    const src = lire(fichier);
    assert.ok(!src.includes("nutritionModelVersion"), fichier);
    assert.ok(!src.includes("plan-v2"), fichier);
  }
});

/* ══════════ Accessibilité, responsive, thèmes ══════════ */

await test("37. les sliders sont accessibles", () => {
  const html = rendre(étatComplet());
  const sliders = html.split('type="range"').length - 1;
  // MIS À JOUR PAR LA REFONTE « SEMAINE D'ABORD ». La page rendait
  // 3 + 6 × 3 = 21 curseurs : l'objectif global, puis les trois listes de
  // créneaux empilées. C'était précisément la surcharge à supprimer. Un seul
  // jour est désormais ouvert, et une seule macro à la fois : 3 curseurs de
  // macros + 6 créneaux de l'onglet actif = 9. Moins de curseurs à l'écran,
  // exactement les mêmes garanties d'accessibilité sur chacun.
  assert.equal(sliders, 3 + 6, `attendu 9 curseurs pour le jour ouvert, obtenu ${sliders}`);
  assert.ok(html.includes("aria-valuemin"));
  assert.ok(html.includes("aria-valuemax"));
  assert.ok(html.includes("aria-valuenow"));
  assert.ok(html.includes("aria-valuetext"));
  // Chaque slider porte un label relié, et les cadenas un nom accessible.
  assert.ok(PANNEAU.includes('htmlFor={sliderId}'));
  assert.ok(PANNEAU.includes("aria-pressed={locked}"));
  assert.ok(PANNEAU.includes("aria-label={"));
  // Erreurs annoncées.
  assert.ok(PANNEAU.includes('role="alert"'));
  assert.ok(BUILDER.includes('role="alert"'));
  assert.ok(BUILDER.includes('role="status"'));
  // Sections nommées pour les lecteurs d'écran.
  assert.ok(html.includes("aria-labelledby"));
});

await test("38. la structure mobile évite tout débordement horizontal", () => {
  const html = rendre(étatComplet());
  // RÉÉCRIT. Le récapitulatif « cartes sous md, tableau au-delà » a disparu
  // avec l'objectif quotidien global qu'il agrégeait. Ce qui défile
  // horizontalement sur mobile, désormais, c'est la BARRE DE JOURS — et elle
  // seule, avec accrochage, jamais la page.
  const onglets = lire("../../components/admin/NutritionDayTabs.tsx");
  assert.ok(onglets.includes("overflow-x-auto"), "la barre de jours défile");
  assert.ok(onglets.includes("snap-x") && onglets.includes("snap-start"), "avec accrochage");
  assert.ok(onglets.includes("sm:overflow-visible"), "et cesse de défiler dès sm");
  // Sliders pleine largeur, jamais de largeur fixe en pixels.
  assert.ok(PANNEAU.includes("w-full min-w-0 flex-1"));
  assert.ok(!/\bw-\[\d+px\]/.test(BUILDER + PANNEAU), "aucune largeur figée en pixels");
  // Zones tactiles ≥ 44 px sur tous les contrôles interactifs.
  assert.ok(PANNEAU.includes("h-11"));
  const boutons = BUILDER.split("<button").length - 1;
  const cibles = BUILDER.split("min-h-[44px]").length - 1;
  assert.ok(cibles >= boutons - 1, `${cibles} cibles ≥ 44px pour ${boutons} boutons`);
  assert.ok(html.includes("min-h-[44px]"));
});

await test("39. la structure tablette empile puis dégroupe", () => {
  assert.ok(BUILDER.includes("sm:grid-cols-2"), "les champs passent sur deux colonnes dès sm");
  assert.ok(BUILDER.includes("sm:flex-row"), "les actions passent en ligne dès sm");
  assert.ok(BUILDER.includes("p-4 shadow-soft sm:p-6"), "le rembourrage s'adapte");
  assert.ok(PANNEAU.includes("sm:flex-nowrap"));
});

await test("40. la structure desktop reste lisible et bornée", () => {
  assert.ok(BUILDER.includes("max-w-4xl"), "la colonne de lecture est bornée");
  // RÉÉCRIT : le couple md:hidden / md:block servait le tableau du
  // récapitulatif supprimé. Sur desktop, les sept jours tiennent maintenant
  // sur une rangée d'onglets, et les créneaux sur deux colonnes.
  const onglets = lire("../../components/admin/NutritionDayTabs.tsx");
  assert.ok(onglets.includes("sm:flex-wrap") && onglets.includes("sm:flex-1"));
  const repartition = lire("../../components/admin/NutritionDaySlotDistribution.tsx");
  assert.ok(repartition.includes("sm:grid-cols-2"));
});

await test("41. aucune couleur codée en dur : uniquement des tokens", () => {
  for (const [nom, src] of [
    ["NutritionPlanV2Builder", BUILDER],
    ["NutritionMacroDistributionPanel", PANNEAU],
    ["NutritionPlanV2ConversionDialog", lire("../../components/admin/NutritionPlanV2ConversionDialog.tsx")],
  ] as const) {
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src), `${nom} : couleur hexadécimale codée en dur`);
    assert.ok(!/\brgba?\(/.test(src), `${nom} : couleur rgb() codée en dur`);
    assert.ok(!/\bhsla?\(/.test(src), `${nom} : couleur hsl() codée en dur`);
  }
  // Les classes utilisées sont bien celles du thème (clair/sombre gérés en amont).
  for (const token of ["text-foreground", "text-muted-foreground", "border-border", "bg-card", "text-destructive"]) {
    assert.ok(BUILDER.includes(token), `token manquant : ${token}`);
  }
  assert.ok(BUILDER.includes("accent-primary") || PANNEAU.includes("accent-primary"));
});


/* ══════════ Création directe d'un plan v2 (ajout post-audit) ══════════ */

await test("42. /nouveau n'offre plus AUCUN choix de format", () => {
  // PR C — « Il ne doit exister qu'un seul bouton et un seul parcours ».
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(!src.includes("Plan classique"), "le format classique a disparu");
  assert.ok(!src.includes('useState<Mode>'), "il n'y a plus d'état de mode");
  assert.ok(!src.includes("<NutritionPlanBuilder"), "le constructeur v1 n'est plus monté");
  assert.ok(src.includes("<NutritionPlanV2Builder"), "un seul constructeur reste");
  // Le formulaire est prêt dès l'ouverture, sans étape de sélection.
  assert.ok(src.includes("createBlankFormState({"));
});

await test("43. le chemin de création v1 a été RETIRÉ, pas neutralisé", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(!src.includes("<NutritionPlanBuilder"), "le constructeur v1 n'est plus monté");
  assert.ok(!src.includes("createNutritionPlanSupabase("), "l'écriture v1 n'a plus d'appelant");
  assert.ok(!src.includes("handleSave"), "le handler v1 a disparu");
});

await test("44. ouvrir /nouveau ne crée AUCUNE ligne", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  // Le formulaire est initialisé dans un `useState` paresseux : aucun accès
  // Supabase, aucun `await`, tant que le coach n'a pas cliqué.
  const debut = src.indexOf("useState<PlanV2FormState | null>(() =>");
  assert.ok(debut !== -1, "l'état est initialisé paresseusement");
  // On borne la tranche à l'initialiseur lui-même : `),\n  );` le referme.
  const fin = src.indexOf("  );", debut);
  const bloc = src.slice(debut, fin);
  assert.ok(!bloc.includes("supabase"), "aucun accès Supabase à l'ouverture");
  assert.ok(!bloc.includes("await"), "aucune écriture à l'ouverture");
  // L'état neuf n'a pas d'identifiant de plan : rien n'existe encore en base.
  const neuf = createBlankFormState({ name: "", goalType: "maintien", status: "brouillon" });
  assert.equal(neuf.planId, null);
});

await test("45. le formulaire neuf porte les six créneaux, désactivés et à zéro", () => {
  const neuf = createBlankFormState({ name: "", goalType: "maintien", status: "brouillon" });
  assert.equal(neuf.slots.length, 6);
  assert.deepEqual(neuf.slots.map((s) => s.slot), [...MEAL_SLOT_KEYS]);
  for (const slot of neuf.slots) {
    assert.equal(slot.enabled, false);
    assert.equal(slot.proteinBp, 0);
    assert.equal(slot.carbBp, 0);
    assert.equal(slot.fatBp, 0);
  }
  assert.equal(neuf.dailyCalories, 0);
  assert.equal(neuf.proteinBp + neuf.carbBp + neuf.fatBp, 0);
});

await test("46. la première sauvegarde passe uniquement par la RPC v2", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(src.includes("planId: null,"), "planId null ⇒ création par la RPC");
  assert.equal(src.split("saveNutritionPlanV2(").length - 1, 1, "un seul appel");
  // La semaine part dans la MÊME transaction.
  assert.ok(src.includes("week: semaine,"), "les sept jours accompagnent la création");
});

await test("47. createNutritionPlan n'est plus utilisée NULLE PART", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(!src.includes("createNutritionPlanSupabase"), "l'import a disparu avec son appel");
  const debutV2 = src.indexOf("async function handleCreateV2()");
  assert.ok(debutV2 !== -1, "le seul handler de création est le v2");
  assert.ok(!src.slice(debutV2).includes("createNutritionPlan("));
});

await test("48. updateNutritionPlan n'est jamais utilisée pour un plan v2", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(!src.includes("updateNutritionPlan"), "la page de création n'y touche pas du tout");
  const fiche = sansCommentaires(PAGE_PLAN);
  const blocV2 = fiche.slice(fiche.indexOf("async function handleSaveV2()"));
  assert.ok(!blocV2.includes("updateNutritionPlanSupabase"));
});

await test("49. un succès redirige vers l'URL canonique du plan créé", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(src.includes("router.push(`/admin/nutrition/${resultat.plan.id}`)"));
  // …et seulement APRÈS le succès.
  const indexEchec = src.indexOf("if (!resultat.ok)");
  const indexRedirection = src.indexOf("router.push(`/admin/nutrition/${resultat.plan.id}`)");
  assert.ok(indexEchec < indexRedirection);
  const blocEchec = src.slice(indexEchec, indexRedirection);
  assert.ok(blocEchec.includes("return;"), "l'échec sort avant la redirection");
});

await test("50. une erreur de la RPC conserve le formulaire", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(src.includes("setV2Error(resultat.message);"));
  const blocEchec = src.slice(src.indexOf("if (!resultat.ok)"), src.indexOf("await supabaseNutritionPlans.refetch();\n    setSavingV2(false);"));
  assert.ok(!blocEchec.includes("setFormState"), "l'état local n'est jamais réinitialisé sur échec");
  assert.ok(!blocEchec.includes('setMode("choix")'), "on ne revient pas au choix");
  const html = rendre(étatComplet(), { serverError: "INVALID_PAYLOAD: profile manquant" });
  assert.ok(html.includes("INVALID_PAYLOAD: profile manquant"));
  assert.ok(html.includes("Semaine alimentaire"));
});

await test("51. une erreur de la RPC ne laisse aucun état partiel", () => {
  // L'atomicité est garantie par la transaction unique de la RPC ; la page
  // n'écrit jamais rien en dehors d'elle.
  const src = sansCommentaires(PAGE_NOUVEAU);
  for (const verbe of [".insert(", ".upsert(", ".delete(", ".update("]) {
    assert.ok(!src.includes(verbe), `écriture directe interdite : ${verbe}`);
  }
  for (const table of ["nutrition_plan_profiles", "nutrition_meal_slot_targets"]) {
    assert.ok(!src.includes(table));
  }
  const migration = lire("../../supabase/migrations/20260804090000_nutrition_plan_profiles_v2.sql");
  assert.ok(migration.includes("returning id into v_plan_id"), "la RPC crée bien le plan elle-même");
});

/* ══════════ Garde d'assignation sur TOUS les points d'entrée ══════════ */

await test("52. un plan v2 incomplet n'est pas assignable depuis la liste", () => {
  const src = sansCommentaires(PAGE_LISTE);
  assert.ok(src.includes("useGuardedNutritionAssignment(baseSetAssignment, versionsById)"));
  assert.ok(src.includes("onSetAssignment={handleSetAssignment}"));
  assert.ok(src.includes("guarded.refusal"), "le refus est affiché");
  const plan = toValidationPlan(createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), META));
  assert.equal(validatePlanV2Assignable(plan).ok, false);
});

await test("53. un plan v2 incomplet n'est pas assignable depuis la fiche élève", () => {
  const src = sansCommentaires(PAGE_ELEVE);
  assert.ok(src.includes("useGuardedNutritionAssignment(baseSetAssignment, nutritionVersionsById)"));
  assert.ok(src.includes("const handleSetAssignment = guardedNutrition.setAssignment;"));
  assert.ok(src.includes("guardedNutrition.refusal"), "le refus est affiché sur la fiche");
  // La modale « Attribuer un contenu » reçoit bien le handler GARDÉ.
  assert.ok(src.includes("onSetAssignment={handleSetAssignment}"));
});

await test("54. la garde couvre TOUS les points d'entrée réels", () => {
  const points = [
    ["app/admin/nutrition/page.tsx", PAGE_LISTE],
    ["app/admin/nutrition/[planId]/page.tsx", PAGE_PLAN],
    ["app/admin/nutrition/nouveau/page.tsx", PAGE_NOUVEAU],
    ["app/admin/eleves/[studentId]/page.tsx", PAGE_ELEVE],
    ["app/admin/eleves/page.tsx", PAGE_ELEVES],
  ] as const;
  for (const [nom, src] of points) {
    assert.ok(src.includes("useGuardedNutritionAssignment"), `${nom} : garde absente`);
  }
  // Aucun autre écran n'assigne de la nutrition sans passer par la garde :
  // les pages programmes/documents n'utilisent pas le type "nutrition".
  const hook = sansCommentaires(lire("../../hooks/useContentAssignment.ts"));
  assert.ok(hook.includes("nutrition: setNutritionAssignment"), "le writer reste unique");
  assert.ok(!hook.includes("guardNutritionAssignment"), "le hook partagé reste neutre");
});

await test("55. aucune assignation existante n'est retirée avant validation", () => {
  const hook = sansCommentaires(lire("../../hooks/useGuardedNutritionAssignment.ts"));
  const indexGarde = hook.indexOf("await guardNutritionAssignment");
  const indexRefus = hook.indexOf("return false;");
  const indexEcriture = hook.indexOf("await base(studentId, contentType, contentId, assigned);", indexRefus);
  assert.ok(indexGarde < indexRefus && indexRefus < indexEcriture, "aucune écriture avant le refus");
  // Et désormais, le retrait de l'ancien plan n'est plus fait par le client
  // du tout : il appartient à la transaction de la RPC.
  const couche = sansCommentaires(lire("../../lib/supabase/nutrition.ts"));
  assert.ok(!/\.update\(\{\s*student_id/.test(couche), "plus aucune écriture directe de student_id");
  // Le retrait n'est JAMAIS bloqué.
  const garde = sansCommentaires(lire("../../lib/supabase/nutrition-assignment-guard.ts"));
  assert.ok(garde.includes("if (!assigned) {\n    return { allowed: true };\n  }"));
});

/* ══════════ Non-régression v1 et forme canonique ══════════ */

await test("56. la création v1 a été RETIRÉE, y compris son repli local", () => {
  const src = sansCommentaires(PAGE_NOUVEAU);
  assert.ok(!src.includes("createNutritionPlanSupabase"), "plus d'écriture v1");
  assert.ok(!src.includes("weeklyTargetCalories: 15400"), "plus de valeurs par défaut v1");
  assert.ok(!src.includes("createNutritionPlan({"), "plus de repli mock v1");
  assert.ok(src.includes("handleCreateV2"), "un seul chemin de création subsiste");
});

await test("57. la conversion v1 → v2 reste fonctionnelle", () => {
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(src.includes("Activer la répartition avancée"));
  assert.ok(src.includes("onContinue={ouvrirConversion}"));
  assert.ok(src.includes("createFormStateFromPrefill("));
});

await test("58. création directe et conversion produisent la MÊME forme canonique", () => {
  const meta = { name: "Plan", description: "", goalType: "maintien", status: "brouillon", coachNotes: "", hydrationTip: "" };
  let direct = createBlankFormState(meta);
  let converti = createFormStateFromPrefill(prefillFromLegacyDailyTarget({ calories: 1700, protein: 119, carbs: 204, fat: 45 }), { ...meta, planId: "plan-1" });
  // On amène les deux au même contenu métier. Le formulaire neuf part
  // VIDE (0 kcal) là où la conversion préremplit : c'est précisément la
  // différence attendue, on la comble explicitement.
  assert.equal(direct.dailyCalories, 0);
  assert.equal(converti.dailyCalories, 1700);
  direct = setDailyCalories(direct, 1700);
  direct = setDailyMacroBp(setDailyMacroBp(setDailyMacroBp(direct, "protein", 2800), "carb", 4800), "fat", 2400);
  converti = setDailyMacroBp(setDailyMacroBp(setDailyMacroBp(converti, "protein", 2800), "carb", 4800), "fat", 2400);
  for (const slot of MEAL_SLOT_KEYS) {
    direct = setSlotEnabled(direct, slot, true);
    converti = setSlotEnabled(converti, slot, true);
  }
  for (const macro of ["protein", "carb", "fat"] as const) {
    const a = distributeRestForMacro(direct, macro);
    const b = distributeRestForMacro(converti, macro);
    assert.ok(a.ok && b.ok);
    if (a.ok) direct = a.state;
    if (b.ok) converti = b.state;
  }
  const payloadDirect = toSaveInput(direct);
  const payloadConverti = toSaveInput(converti);
  assert.deepEqual(Object.keys(payloadDirect).sort(), Object.keys(payloadConverti).sort());
  assert.deepEqual(payloadDirect.slots, payloadConverti.slots);
  assert.equal(payloadDirect.planId, null, "création : aucun id");
  assert.equal(payloadConverti.planId, "plan-1", "conversion : l'id du plan existant");
  const { planId: _a, ...resteDirect } = payloadDirect;
  const { planId: _b, ...resteConverti } = payloadConverti;
  void _a; void _b;
  assert.deepEqual(resteDirect, resteConverti, "hors identifiant, les deux payloads sont identiques");
});

await test("59. la BASE est la source de vérité de l'objectif hebdomadaire", () => {
  // La RPC recréée écrit elle-même la colonne : ce n'est plus un repli de
  // lecture qui corrige un NULL, c'est la base qui porte la valeur.
  assert.ok(MIGRATION_HEBDO.includes("v_weekly_target := case when v_daily_calories_raw is null then null"));
  assert.ok(MIGRATION_HEBDO.includes("else v_daily_calories_raw * 7 end;"));
  // La version PRÉCÉDENTE de la RPC, elle, ne portait pas ce champ.
  assert.ok(!MIGRATION_V2.includes("weekly_target_calories"));
  // Le repli TypeScript subsiste, mais explicitement comme filet défensif.
  const src = COUCHE_NUTRITION;
  assert.ok(src.includes("la BASE fait autorité"), "le commentaire doit dire que la base fait autorité");
  assert.ok(src.includes("FILET\n    // DÉFENSIF") || src.includes("FILET DÉFENSIF") || src.includes("FILET"), "le repli est présenté comme défensif");
  assert.ok(src.includes("row.weekly_target_calories ??"), "le filet est conservé");
});

await test("60. la migration 20260805090000 recrée UNIQUEMENT la fonction", () => {
  // Aucune table, colonne, policy, index, contrainte ni privilège de table.
  for (const motif of [/create table/i, /alter table/i, /create policy/i, /create index/i, /add constraint/i, /enable row level security/i]) {
    assert.ok(!motif.test(MIGRATION_HEBDO), `la migration ne doit pas contenir : ${motif}`);
  }
  assert.equal(MIGRATION_HEBDO.split("create or replace function").length - 1, 1, "une seule fonction recréée");
  assert.ok(MIGRATION_HEBDO.includes("create or replace function public.save_nutrition_plan_v2(p_payload jsonb)"));
  // Aucune migration antérieure n'est modifiée : la précédente reste intacte.
  assert.ok(MIGRATION_V2.includes("create or replace function public.save_nutrition_plan_v2(p_payload jsonb)"));
});

await test("61. la valeur est écrite à la CRÉATION et à la MODIFICATION", () => {
  const corps = MIGRATION_HEBDO.slice(MIGRATION_HEBDO.indexOf("create or replace function"));
  // Création : la colonne fait partie de l'INSERT.
  const insert = corps.slice(corps.indexOf("insert into public.nutrition_plans ("), corps.indexOf("returning id into v_plan_id;"));
  assert.ok(insert.includes("nutrition_model_version, daily_target, weekly_target_calories"));
  assert.ok(insert.includes("v_weekly_target"));
  // Modification : la colonne fait partie de l'UPDATE, avant le where.
  const update = corps.slice(corps.indexOf("update public.nutrition_plans np set"), corps.indexOf("where np.id = v_plan_id;"));
  assert.ok(update.includes("weekly_target_calories = v_weekly_target,"));
  assert.ok(update.includes("daily_target = v_daily_target,"), "daily_target reste écrit dans la même instruction");
});

await test("62. aucune valeur inventée pour un brouillon sans calories", () => {
  const corps = MIGRATION_HEBDO.slice(MIGRATION_HEBDO.indexOf("create or replace function"));
  // La valeur BRUTE du payload est conservée pour distinguer absent de zéro.
  assert.ok(corps.includes("v_daily_calories_raw := (v_profile->>'daily_calories')::numeric;"));
  assert.ok(corps.includes("v_daily_calories := coalesce(v_daily_calories_raw, 0);"));
  assert.ok(corps.includes("case when v_daily_calories_raw is null then null"));
  // Et le reste du calcul continue de travailler sur la valeur coalescée.
  assert.ok(corps.includes("v_protein_g := v_daily_calories * v_protein_bp / 10000.0 / 4.0;"));
});

await test("63. toutes les garanties de sécurité sont reconduites", () => {
  const corps = MIGRATION_HEBDO.slice(MIGRATION_HEBDO.indexOf("create or replace function"));
  assert.ok(corps.includes("returns jsonb"), "signature de retour inchangée");
  assert.ok(corps.includes("(p_payload jsonb)"), "signature d'entrée inchangée");
  assert.ok(corps.includes("language plpgsql"));
  assert.ok(corps.includes("security invoker"));
  assert.ok(corps.includes("set search_path = ''"));
  assert.ok(corps.includes("if not public.is_coach_or_admin() then"));
  assert.ok(MIGRATION_HEBDO.includes("revoke all on function public.save_nutrition_plan_v2(jsonb) from public;"));
  assert.ok(MIGRATION_HEBDO.includes("revoke execute on function public.save_nutrition_plan_v2(jsonb) from anon;"));
  assert.ok(MIGRATION_HEBDO.includes("grant execute on function public.save_nutrition_plan_v2(jsonb) to authenticated;"));
  assert.ok(!/grant execute on function public\.save_nutrition_plan_v2\(jsonb\) to (public|anon)/i.test(MIGRATION_HEBDO));
  // Validations, retour canonique, profil et six créneaux : toujours là.
  assert.ok(corps.includes("INVALID_PAYLOAD: les six créneaux sont obligatoires"));
  assert.ok(corps.includes("on conflict (plan_id, profile_key) do update set"));
  assert.ok(corps.includes("on conflict (profile_id, slot) do update set"));
  assert.ok(corps.includes("'daily_target', v_plan_row.daily_target"));
  assert.ok(corps.includes("PLAN_NOT_FOUND_OR_FORBIDDEN"));
});

await test("64. la migration est déclarée au manifeste et comptée", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  // 35 depuis 20260828090000_web_push_notifications.sql (socle Web Push).
  // ⚠️ COMPTEUR FIGÉ REMPLACÉ EN C4.1 — LIRE AVANT DE RÉÉCRIRE UN NOMBRE ICI.
  //
  // Cette ligne disait `assert.equal(attendues.length, 53)`. Le même nombre
  // était recopié dans DOUZE fichiers de tests, et chacun vérifiait en plus le
  // TEXTE de `security-hardening.mts` pour s'assurer que les copies suivaient.
  //
  // Le montage a fini par cacher ce qu'il devait montrer : mesuré le
  // 17/08/2026, **C2 et C3 n'étaient pas déclarées au manifeste** et aucun des
  // douze compteurs ne l'a signalé — ils comptaient 53, ce qui était juste,
  // pour une liste incomplète.
  //
  // On vérifie donc la PROPRIÉTÉ, pas le nombre : le manifeste et le dossier
  // `supabase/migrations` coïncident nom par nom, dans les deux sens.
  verifierManifesteDesMigrations(assert);
  assert.ok(attendues.includes("20260805090000_nutrition_plan_v2_weekly_target.sql"));
});

/* ══════════ Refonte « semaine d'abord » — rendu réel ══════════ */

await test("65. la page rend SEPT onglets de jour et UN SEUL panneau ouvert", () => {
  const html = rendre(étatComplet());
  const onglets = html.split('role="tab"').length - 1;
  // Sept jours + trois macronutriments : deux barres d'onglets, pas plus.
  assert.equal(onglets, 7 + 3, `attendu 10 onglets, obtenu ${onglets}`);
  assert.equal(html.split('role="tabpanel"').length - 1, 2, "un panneau de jour, un panneau de macro");
  // Un seul onglet sélectionné par barre.
  assert.equal(html.split('aria-selected="true"').length - 1, 2);
  for (const jour of ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"]) {
    assert.ok(html.includes(jour), `jour absent du sélecteur : ${jour}`);
  }
  // Et le jour ouvert est lundi. `renderToString` insère un commentaire vide
  // entre un texte littéral et une expression : on cherche donc les deux
  // fragments, pas la chaîne recomposée.
  assert.ok(/Objectifs\s*—[\s\S]{0,30}Lundi/.test(html), "le titre de la zone 1 nomme le jour ouvert");
  assert.ok(/Actions\s*—[\s\S]{0,30}Lundi/.test(html), "le titre de la zone 4 aussi");
});

await test("66. les quatre zones du jour ouvert sont rendues, et rien d'autre", () => {
  const html = rendre(étatComplet());
  for (const zone of [
    "Calories du jour",
    "Répartition par créneau",
    "Repas prescrits",
    "Dupliquer ce jour vers",
    "Appliquer à toute la semaine",
    "Réinitialiser ce jour",
  ]) {
    assert.ok(html.includes(zone), `zone absente : ${zone}`);
  }
  // Une seule fois chacune : le jour ouvert, pas sept copies.
  assert.equal(html.split("Répartition par créneau").length - 1, 1);
  assert.equal(html.split("Repas prescrits").length - 1, 1);
  // Le total hebdomadaire est bien la somme des sept jours.
  assert.ok(html.includes("Total de la semaine"));
  assert.ok(html.includes("somme des sept jours"));
  // Aucun vocabulaire de profil, nulle part dans le rendu.
  for (const interdit of ["Profil", "profile_key", "default", "legacy_default"]) {
    assert.ok(!html.includes(interdit), `le rendu contient encore « ${interdit} »`);
  }
});

await test("67. l'initialisation de la semaine est facultative et repliée", () => {
  const html = rendre(étatComplet());
  assert.ok(html.includes("Initialiser les sept jours avec les mêmes objectifs"));
  // Repliée : son formulaire n'est pas monté tant qu'on ne l'ouvre pas, donc
  // elle ne peut pas être prise pour un réglage global permanent.
  assert.ok(!html.includes("Appliquer aux sept jours"));
  assert.ok(!html.includes("Calories par jour (kcal)"));
  // Et elle n'est jamais relue : le constructeur ne dérive rien d'elle.
  const src = sansCommentaires(BUILDER);
  assert.ok(src.includes("initializeAllDays(week, objectifs)"));
  assert.equal(src.split("initializeAllDays").length - 1, 2, "un import, un seul appel");
});
/* ═══════════ Cycle de vie du plan (PR D) ═══════════ */

await test("68. les actions du plan suivent son statut, et la suppression n'en fait pas partie", () => {
  assert.deepEqual(planLifecycleActions("brouillon"), ["activate", "duplicate"]);
  assert.deepEqual(planLifecycleActions("actif"), ["archive", "duplicate"]);
  // « Restaurer » ramène en BROUILLON : un plan archivé ne redevient jamais
  // assignable sans qu'on l'ait relu.
  assert.deepEqual(planLifecycleActions("archivé"), ["restore", "duplicate"]);
  assert.equal(planStatusAfter("restore"), "brouillon");
  assert.equal(planStatusAfter("activate"), "actif");
  assert.equal(planStatusAfter("archive"), "archivé");
  assert.equal(planStatusAfter("duplicate"), null);
  assert.equal(PLAN_ACTION_LABELS_FR.archive, "Archiver");
  assert.equal(DELETE_ACTION_LABEL_FR, "Supprimer définitivement");
  // Aucune liste d'actions ne contient la suppression : elle vit ailleurs.
  for (const statut of ["brouillon", "actif", "archivé"] as const) {
    assert.ok(!(planLifecycleActions(statut) as readonly string[]).includes("delete"));
  }
  // La liste des plans ne propose PAS la suppression — seulement le statut.
  assert.ok(!PAGE_LISTE.includes("DeleteTriggerButton"));
  assert.ok(PAGE_LISTE.includes('filter((action) => action !== "duplicate")'));
  // RÈGLE MÉTIER : la SEULE condition bloquante est un élève actuellement
  // affecté. Le motif le nomme, au singulier comme au pluriel, et propose la
  // sortie (retirer l'élève, ou archiver).
  const seul = describePlanDeletionBlock("assigned", { assignedStudents: 1, dailyLogs: 12 });
  assert.ok(seul.includes("Un élève"));
  assert.ok(seul.includes("archive"), "l'alternative non destructrice est nommée");
  assert.ok(!seul.includes("journée"), "l'historique n'est PAS invoqué comme motif de refus");
  assert.ok(describePlanDeletionBlock("assigned", { assignedStudents: 3, dailyLogs: 0 }).includes("3 élèves"));

  // Un historique, désormais, ne bloque plus : il s'ANNONCE.
  assert.equal(describePlanDeletionSideEffects({ assignedStudents: 0, dailyLogs: 0 }), null,
    "rien à signaler quand il n'y a rien à perdre");
  assert.equal(describePlanDeletionSideEffects({ assignedStudents: 0, dailyLogs: 1 }),
    "1 journée de suivi sera également supprimée.");
  assert.equal(describePlanDeletionSideEffects({ assignedStudents: 0, dailyLogs: 2 }),
    "2 journées de suivi seront également supprimées.");
});

await test("68 bis. la modale annonce ce qui partira EN PLUS, et seulement si c'est permis", () => {
  // PERMISE + historique : l'avertissement est visible, et le champ de
  // confirmation aussi.
  const permise = renderToString(
    createElement(DeleteConfirmationModal, {
      resourceName: "TEST PLAN V2",
      resourceKind: "ce plan alimentaire",
      dependencies: [
        { label: "Élèves affectés", count: 0 },
        { label: "Journées de suivi enregistrées", count: 2 },
      ],
      blockedReason: null,
      sideEffect: describePlanDeletionSideEffects({ assignedStudents: 0, dailyLogs: 2 }),
      deleting: false,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  const texte = permise.replace(/<!-- -->/g, "");
  assert.ok(texte.includes("2 journées de suivi seront également supprimées."),
    "la perte est annoncée AVANT le clic");
  assert.ok(texte.includes("Recopie le nom exact"), "et la confirmation reste exigée");
  assert.ok(texte.includes("irréversible"), "l'irréversibilité est maintenue");
  assert.ok(permise.includes("disabled"), "le bouton part désactivé");

  // REFUSÉE : on montre le motif, pas un inventaire de ce qui ne partira pas.
  const refusée = renderToString(
    createElement(DeleteConfirmationModal, {
      resourceName: "TEST PLAN V2",
      resourceKind: "ce plan alimentaire",
      dependencies: [{ label: "Élèves affectés", count: 1 }],
      blockedReason: "Un eleve est encore affecte a ce plan.",
      sideEffect: "2 journees de suivi seront egalement supprimees.",
      deleting: false,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(refusée.includes("Un eleve est encore affecte a ce plan."));
  assert.ok(!refusée.includes("2 journees de suivi seront egalement supprimees."),
    "aucun avertissement de perte sur une suppression refusée");
  assert.ok(!refusée.includes("Recopie le nom exact"));
});

await test("69. dupliquer un plan crée un BROUILLON indépendant, par la MÊME RPC", () => {
  const semaine = initializeAllDays(createBlankWeek(), {
    dailyCalories: 2400,
    proteinBp: 3000,
    carbBp: 4500,
    fatBp: 2500,
  });
  // Un repas DÉJÀ enregistré porte un vrai UUID : c'est le cas dangereux.
  const uuid = "11111111-2222-4333-8444-555555555555";
  const avecRepas: typeof semaine = {
    ...semaine,
    days: semaine.days.map((jour, i) =>
      i === 0
        ? {
            ...jour,
            meals: [
              {
                id: uuid,
                slot: "breakfast" as const,
                name: "Petit déjeuner",
                items: [{ name: "Flocons", quantity: "80 g" }],
                calories: 500,
                protein: 30,
                carbs: 60,
                fat: 12,
                coachNotes: "",
                choiceSlots: [],
              },
            ],
          }
        : jour,
    ),
  };

  // La sauvegarde NORMALE conserve l'identifiant : le repas est mis à jour.
  const normal = toWeekSavePayload(avecRepas);
  const repasNormal = (normal.days[0] as { meals: { id: string | null }[] }).meals[0];
  assert.equal(repasNormal.id, uuid, "une sauvegarde met à jour le repas existant");

  // La DUPLICATION, elle, le neutralise : sans quoi le repas du plan d'origine
  // serait déplacé dans la copie.
  const copie = toDuplicateWeekPayload(avecRepas);
  const repasCopie = (copie.days[0] as { meals: { id: string | null }[] }).meals[0];
  assert.equal(repasCopie.id, null, "la copie demande un identifiant neuf");
  assert.equal(copie.days.length, 7, "les sept jours sont copiés");
  assert.equal(copie.profiles.length, 7, "et les sept profils internes");
  assert.equal(copie.main_profile_key, normal.main_profile_key);
  // Le reste du repas est copié sans perte.
  const contenu = repasCopie as unknown as { name: string; calories: number };
  assert.equal(contenu.name, "Petit déjeuner");
  assert.equal(contenu.calories, 500);
  // L'original n'a pas été muté.
  assert.equal(avecRepas.days[0].meals[0].id, uuid);

  // La page duplique en BROUILLON, sans élève, par la RPC.
  const src = sansCommentaires(PAGE_PLAN);
  assert.ok(src.includes("status: STATUS_APP_TO_DB.brouillon"), "une copie naît en brouillon");
  assert.ok(src.includes("week: toDuplicateWeekPayload(formulaire)"));
  assert.ok(!/studentId|student_id/.test(src.slice(src.indexOf("async function dupliquer"), src.indexOf("function lancerAction"))),
    "dupliquer n'assigne jamais d'élève");
  assert.equal(duplicateName("Semaine sèche"), "Semaine sèche (copie)");
  assert.equal(duplicateName("   "), "Sans nom (copie)");
});

await test("70. retirer un plan de l'écran d'un élève se confirme, et nomme l'élève", () => {
  // SEUL le retour en brouillon masque le plan. L'archivage, lui, conserve
  // l'accès de l'élève déjà affecté : confondre les deux ferait apparaître une
  // confirmation là où il n'y a rien à confirmer.
  assert.equal(hidesPlanFromAssignedStudent("brouillon", 1), true);
  assert.equal(hidesPlanFromAssignedStudent("brouillon", 0), false, "sans élève, rien à prévenir");
  assert.equal(hidesPlanFromAssignedStudent("archivé", 1), false, "archiver ne masque rien");
  assert.equal(hidesPlanFromAssignedStudent("actif", 1), false);

  // Le message NOMME. « un élève » est une abstraction, un prénom est une
  // conséquence.
  const seul = describeHidingFromStudent(["Marie Dupont"]);
  assert.ok(seul.startsWith("Marie Dupont"), seul);
  assert.ok(seul.includes("ne verra plus ce plan"));
  assert.ok(seul.includes("recettes"), "on dit ce qui disparaît");
  assert.ok(seul.includes("archive"), "et on nomme l'alternative qui préserve l'accès");
  const deux = describeHidingFromStudent(["Marie Dupont", "Léo Martin"]);
  assert.ok(deux.includes("Marie Dupont et Léo Martin"));
  assert.ok(deux.includes("ne verront plus"));
  assert.ok(describeHidingFromStudent([]).startsWith("L'élève affecté"), "repli sans nom");

  // La modale rend le message et laisse une sortie.
  const html = renderToString(
    createElement(ConfirmActionModal, {
      title: "Ce plan disparaîtra de l'espace de l'élève",
      message: "Marie Dupont ne verra plus ce plan.",
      confirmLabel: "Repasser en brouillon",
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(html.includes("Marie Dupont ne verra plus ce plan."));
  assert.ok(html.includes("Repasser en brouillon"));
  assert.ok(html.includes("Annuler"), "on peut toujours renoncer");
  assert.ok(html.includes('role="dialog"'), "c'est bien une modale accessible");
  assert.ok(html.includes("min-h-[44px]"), "cibles tactiles");

  // LES TROIS CHEMINS qui peuvent ramener un plan en brouillon la déclenchent.
  // Un seul oubli suffirait à rendre la garantie fausse.
  const fiche = sansCommentaires(PAGE_PLAN);
  const liste = sansCommentaires(PAGE_LISTE);
  assert.equal((fiche.match(/hidesPlanFromAssignedStudent\(/g) ?? []).length, 2,
    "la fiche couvre l'action de cycle de vie ET l'enregistrement du constructeur");
  assert.ok(liste.includes("hidesPlanFromAssignedStudent("), "la liste aussi");
  // Et la modale est montée dans les DEUX branches de rendu de la fiche : la
  // branche « constructeur » sort avant le reste de la page.
  assert.equal((fiche.match(/<ConfirmActionModal/g) ?? []).length, 2,
    "une modale déclenchée mais non montée ne s'ouvrirait jamais");
  assert.equal((liste.match(/<ConfirmActionModal/g) ?? []).length, 1);
});

await test("71. le propriétaire d'un plan est posé par la BASE, jamais par l'écran", () => {
  const sql = lire("../../supabase/migrations/20260816090000_nutrition_plan_coach_ownership.sql");

  // Un trigger, pas une retouche de RPC : il est SOUS tous les chemins.
  assert.ok(sql.includes("create trigger nutrition_plans_fill_coach_id"));
  assert.ok(sql.includes("create trigger nutrition_plans_fill_coach_id_on_assign"));
  assert.ok(sql.includes("before insert on public.nutrition_plans"));
  assert.ok(sql.includes("before update of student_id on public.nutrition_plans"));
  // Sur UPDATE, le déclenchement est BORNÉ à un vrai changement d'élève : sans
  // cette clause, le détachement provoqué par la suppression d'un coach
  // (ON DELETE SET NULL) réattribuerait aussitôt le plan.
  assert.ok(sql.includes("when (new.student_id is not null and new.student_id is distinct from old.student_id)"));

  // La règle : l'élève d'abord, l'appelant ensuite, et JAMAIS d'écrasement.
  const corps = sql.slice(sql.indexOf("create or replace function public.nutrition_plans_fill_coach_id"));
  assert.ok(/if new\.coach_id is not null then\s+return new;/.test(corps),
    "un propriétaire déjà désigné n'est jamais réécrit");
  assert.ok(corps.indexOf("from public.students s") < corps.indexOf("public.current_coach_id()"),
    "le coach de l'élève prime sur celui qui écrit");

  // Conventions du dépôt, et aucune exposition applicative.
  assert.ok(/^security invoker$/m.test(corps));
  assert.ok(/^set search_path = ''$/m.test(corps));
  assert.ok(sql.includes("alter function public.nutrition_plans_fill_coach_id() owner to postgres;"));
  for (const rôle of ["public", "anon", "authenticated"]) {
    assert.ok(
      sql.includes(`revoke all on function public.nutrition_plans_fill_coach_id() from ${rôle};`) ||
        sql.includes(`revoke execute on function public.nutrition_plans_fill_coach_id() from ${rôle};`),
      `le trigger ne doit pas être exécutable par ${rôle}`,
    );
  }

  // AUCUNE reprise en masse, AUCUNE destruction : les plans existants se
  // réparent à leur réassignation, ou se suppriment par le chemin de la PR D.
  const horsCorps = sql
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(!/delete from/i.test(horsCorps), "la migration ne supprime rien");
  assert.ok(!/^update public\.nutrition_plans/m.test(horsCorps), "aucune reprise en masse");
  assert.ok(!/drop table|drop column|truncate/i.test(sql));

  // Et la migration refuse de s'appliquer si la policy qu'elle débloque
  // cessait de dépendre de la colonne.
  assert.ok(sql.includes("nutrition_recipes_select_student"));
  assert.ok(sql.includes("ce trigger est à revoir"));
});


/* ══════════════ PRÉSETS DE RÉPARTITION PAR HORAIRE D'ENTRAÎNEMENT ══════════════
 *
 * LA RÉFÉRENCE EST LE DOCUMENT, PAS LE CODE.
 *
 * `TABLES_REFERENCE` ci-dessous est une TRANSCRIPTION INDÉPENDANTE des douze
 * tableaux du document de référence : glucides / protéines / lipides, en
 * pourcentages entiers, avec le créneau du builder qui porte chaque ligne et
 * le rôle nutritionnel qu'il joue. Elle est écrite ici à la main, sans
 * import depuis `macro-presets.ts` — sinon un chiffre faux dans la
 * bibliothèque se comparerait à lui-même et sortirait vert.
 *
 * PRESET-01 à PRESET-12 comparent chaque combinaison — d'abord la table de
 * la bibliothèque à la transcription, puis les CURSEURS RÉELLEMENT POSÉS par
 * `applyDayMacroPreset` à la transcription. Les deux niveaux sont
 * nécessaires : une table juste peut être mal appliquée.
 *
 * PRESET-13 à PRESET-23 couvrent les refus (6 repas, mauvais jeu de
 * créneaux), les rôles explicites, l'absence totale d'écriture et le rendu
 * des quatre raccourcis.
 */

/** Rôles tels qu'écrits dans le document — repris pour les assertions. */
type RoleAttendu =
  | "petit_dejeuner"
  | "collation_matin"
  | "dejeuner"
  | "collation_apres_midi"
  | "collation_pre_training"
  | "collation_soir"
  | "diner";

interface LigneReference {
  readonly slot: string;
  readonly role: RoleAttendu;
  /** Pourcentages ENTIERS du document : glucides, protéines, lipides. */
  readonly g: number;
  readonly p: number;
  readonly l: number;
}

/**
 * LES DOUZE TABLEAUX DU DOCUMENT DE RÉFÉRENCE, TRANSCRITS À LA MAIN.
 *
 * Le mapping rôle → créneau suit le document :
 *   • MIDI × 4 et × 5 : la collation pré-training précède la séance de midi,
 *     donc `morning_snack` ;
 *   • APRÈS-MIDI × 4 et × 5, SOIR × 4 : elle tombe entre déjeuner et dîner,
 *     donc `afternoon_snack` ;
 *   • APRÈS-MIDI × 5 : la collation du SOIR vient après le dîner → `dessert` ;
 *   • SOIR × 5 : `afternoon_snack` est déjà pris par la collation
 *     d'après-midi, le PRÉ-TRAINING occupe donc `dessert`.
 */
const TABLES_REFERENCE: Record<string, Record<number, readonly LigneReference[]>> = {
  matin: {
    3: [
      { slot: "breakfast", role: "petit_dejeuner", g: 30, p: 30, l: 15 },
      { slot: "lunch", role: "dejeuner", g: 45, p: 35, l: 25 },
      { slot: "dinner", role: "diner", g: 25, p: 35, l: 60 },
    ],
    4: [
      { slot: "breakfast", role: "petit_dejeuner", g: 30, p: 25, l: 10 },
      { slot: "lunch", role: "dejeuner", g: 40, p: 30, l: 20 },
      { slot: "afternoon_snack", role: "collation_apres_midi", g: 15, p: 20, l: 30 },
      { slot: "dinner", role: "diner", g: 15, p: 25, l: 40 },
    ],
    5: [
      { slot: "breakfast", role: "petit_dejeuner", g: 25, p: 20, l: 10 },
      { slot: "morning_snack", role: "collation_matin", g: 30, p: 20, l: 10 },
      { slot: "lunch", role: "dejeuner", g: 20, p: 25, l: 30 },
      { slot: "afternoon_snack", role: "collation_apres_midi", g: 10, p: 15, l: 20 },
      { slot: "dinner", role: "diner", g: 15, p: 20, l: 30 },
    ],
  },
  midi: {
    3: [
      { slot: "breakfast", role: "petit_dejeuner", g: 25, p: 30, l: 35 },
      { slot: "lunch", role: "dejeuner", g: 45, p: 35, l: 15 },
      { slot: "dinner", role: "diner", g: 30, p: 35, l: 50 },
    ],
    4: [
      { slot: "breakfast", role: "petit_dejeuner", g: 20, p: 25, l: 40 },
      { slot: "morning_snack", role: "collation_pre_training", g: 20, p: 15, l: 5 },
      { slot: "lunch", role: "dejeuner", g: 35, p: 35, l: 15 },
      { slot: "dinner", role: "diner", g: 25, p: 25, l: 40 },
    ],
    5: [
      { slot: "breakfast", role: "petit_dejeuner", g: 20, p: 20, l: 30 },
      { slot: "morning_snack", role: "collation_pre_training", g: 20, p: 15, l: 5 },
      { slot: "lunch", role: "dejeuner", g: 30, p: 30, l: 15 },
      { slot: "afternoon_snack", role: "collation_apres_midi", g: 10, p: 15, l: 20 },
      { slot: "dinner", role: "diner", g: 20, p: 20, l: 30 },
    ],
  },
  apres_midi: {
    3: [
      { slot: "breakfast", role: "petit_dejeuner", g: 25, p: 30, l: 40 },
      { slot: "lunch", role: "dejeuner", g: 35, p: 35, l: 35 },
      { slot: "dinner", role: "diner", g: 40, p: 35, l: 25 },
    ],
    4: [
      { slot: "breakfast", role: "petit_dejeuner", g: 20, p: 25, l: 40 },
      { slot: "lunch", role: "dejeuner", g: 25, p: 30, l: 40 },
      { slot: "afternoon_snack", role: "collation_pre_training", g: 20, p: 15, l: 5 },
      { slot: "dinner", role: "diner", g: 35, p: 30, l: 15 },
    ],
    5: [
      { slot: "breakfast", role: "petit_dejeuner", g: 20, p: 20, l: 30 },
      { slot: "lunch", role: "dejeuner", g: 25, p: 25, l: 30 },
      { slot: "afternoon_snack", role: "collation_pre_training", g: 20, p: 15, l: 5 },
      { slot: "dinner", role: "diner", g: 30, p: 25, l: 15 },
      { slot: "dessert", role: "collation_soir", g: 5, p: 15, l: 20 },
    ],
  },
  soir: {
    3: [
      { slot: "breakfast", role: "petit_dejeuner", g: 25, p: 30, l: 40 },
      { slot: "lunch", role: "dejeuner", g: 35, p: 35, l: 40 },
      { slot: "dinner", role: "diner", g: 40, p: 35, l: 20 },
    ],
    4: [
      { slot: "breakfast", role: "petit_dejeuner", g: 20, p: 25, l: 40 },
      { slot: "lunch", role: "dejeuner", g: 25, p: 30, l: 40 },
      { slot: "afternoon_snack", role: "collation_pre_training", g: 20, p: 15, l: 5 },
      { slot: "dinner", role: "diner", g: 35, p: 30, l: 15 },
    ],
    5: [
      { slot: "breakfast", role: "petit_dejeuner", g: 15, p: 20, l: 30 },
      { slot: "lunch", role: "dejeuner", g: 25, p: 25, l: 30 },
      { slot: "afternoon_snack", role: "collation_apres_midi", g: 10, p: 15, l: 20 },
      { slot: "dessert", role: "collation_pre_training", g: 20, p: 15, l: 5 },
      { slot: "dinner", role: "diner", g: 30, p: 25, l: 15 },
    ],
  },
};

/** Une semaine dont le lundi n'a QUE les créneaux demandés. */
function semaineAvecCreneaux(slots: readonly string[]): WeekFormState {
  let semaine = semaineComplète();
  for (const slot of MEAL_SLOT_KEYS) {
    semaine = setDaySlotEnabled(semaine, "monday", slot, (slots as readonly string[]).includes(slot));
  }
  return semaine;
}

function lundi(semaine: WeekFormState) {
  const jour = findDay(semaine, "monday");
  assert.ok(jour, "lundi doit exister");
  return jour;
}

function partsDe(semaine: WeekFormState, slot: string) {
  const allocation = lundi(semaine).slots.find((a) => a.slot === slot);
  assert.ok(allocation, `créneau ${slot} introuvable`);
  return { carb: allocation.carbBp, protein: allocation.proteinBp, fat: allocation.fatBp };
}

/**
 * LE CŒUR DES DOUZE PREMIERS TESTS.
 *
 * Trois vérifications successives sur une combinaison :
 *   1. la table de la bibliothèque EST la table du document — mêmes
 *      créneaux, dans le même ordre, mêmes rôles, mêmes pourcentages ;
 *   2. appliquée sur un jour qui a exactement ces créneaux, elle pose les
 *      valeurs attendues, à l'unité de point de base près ;
 *   3. les créneaux non prescrits restent à zéro et chaque macro somme à
 *      100 % — un préset ne laisse jamais un jour incohérent.
 */
function verifierCombinaison(horaire: HoraireEntrainement, nombre: NombreDeRepasCouvert) {
  const attendues = TABLES_REFERENCE[horaire][nombre];
  const lignes = PRESETS_MACROS[horaire][nombre];

  // 1 — la bibliothèque contre le document.
  assert.equal(lignes.length, attendues.length, `${horaire} × ${nombre} : nombre de lignes`);
  for (const [i, attendue] of attendues.entries()) {
    const ligne = lignes[i];
    assert.equal(ligne.slot, attendue.slot, `${horaire} × ${nombre}, ligne ${i + 1} : créneau`);
    assert.equal(ligne.role, attendue.role, `${horaire} × ${nombre}, ${attendue.slot} : rôle`);
    assert.deepEqual(
      { g: ligne.carbBp, p: ligne.proteinBp, l: ligne.fatBp },
      { g: attendue.g * 100, p: attendue.p * 100, l: attendue.l * 100 },
      `${horaire} × ${nombre}, ${attendue.slot} : pourcentages`,
    );
  }

  // 2 — les curseurs réellement posés.
  const semaine = semaineAvecCreneaux(attendues.map((a) => a.slot));
  const résultat = applyDayMacroPreset(semaine, "monday", horaire);
  assert.ok(résultat.ok, `${horaire} × ${nombre} doit s'appliquer sur son propre jeu de créneaux`);
  for (const attendue of attendues) {
    assert.deepEqual(
      partsDe(résultat.state, attendue.slot),
      { carb: attendue.g * 100, protein: attendue.p * 100, fat: attendue.l * 100 },
      `${horaire} × ${nombre} — ${attendue.slot} après application`,
    );
  }

  // 3 — rien ailleurs, et 100 % partout.
  const prescrits = new Set(attendues.map((a) => a.slot));
  for (const slot of MEAL_SLOT_KEYS) {
    if (prescrits.has(slot)) continue;
    assert.deepEqual(
      partsDe(résultat.state, slot),
      { carb: 0, protein: 0, fat: 0 },
      `${horaire} × ${nombre} — ${slot} n'est pas prescrit et doit rester à zéro`,
    );
  }
  for (const macro of ["protein", "carb", "fat"] as const) {
    assert.equal(
      describeMacroBalance(lundi(résultat.state).slots, macro).totalBp,
      BASIS_POINTS_TOTAL,
      `${horaire} × ${nombre} / ${macro} après application`,
    );
  }
}

await test("PRESET-01 — MATIN × 3 : valeurs exactes du document", () => verifierCombinaison("matin", 3));
await test("PRESET-02 — MATIN × 4 : valeurs exactes du document", () => verifierCombinaison("matin", 4));
await test("PRESET-03 — MATIN × 5 : valeurs exactes du document", () => verifierCombinaison("matin", 5));
await test("PRESET-04 — MIDI × 3 : valeurs exactes du document", () => verifierCombinaison("midi", 3));
await test("PRESET-05 — MIDI × 4 : valeurs exactes du document", () => verifierCombinaison("midi", 4));
await test("PRESET-06 — MIDI × 5 : valeurs exactes du document", () => verifierCombinaison("midi", 5));
await test("PRESET-07 — APRÈS-MIDI × 3 : valeurs exactes du document", () =>
  verifierCombinaison("apres_midi", 3));
await test("PRESET-08 — APRÈS-MIDI × 4 : valeurs exactes du document", () =>
  verifierCombinaison("apres_midi", 4));
await test("PRESET-09 — APRÈS-MIDI × 5 : valeurs exactes du document", () =>
  verifierCombinaison("apres_midi", 5));
await test("PRESET-10 — SOIR × 3 : valeurs exactes du document", () => verifierCombinaison("soir", 3));
await test("PRESET-11 — SOIR × 4 : valeurs exactes du document", () => verifierCombinaison("soir", 4));
await test("PRESET-12 — SOIR × 5 : valeurs exactes du document", () => verifierCombinaison("soir", 5));

await test("PRESET-13 — SIX repas : les quatre raccourcis sont désactivés, avec le message exact", () => {
  const six = ["breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "dessert"];
  const semaine = semaineAvecCreneaux(six);
  assert.equal(creneauxActifs(lundi(semaine)).length, 6, "le jour doit bien avoir six repas cochés");

  for (const horaire of HORAIRES_ENTRAINEMENT) {
    const verdict = presetApplicable(lundi(semaine), horaire);
    assert.equal(verdict.ok, false, `${horaire} doit être indisponible à six repas`);
    assert.equal(verdict.ok === false && verdict.raison, "nombre");
    assert.equal(
      verdict.ok === false && verdict.message,
      "Répartition automatique non définie pour 6 repas.",
      `${horaire} : message attendu au mot près`,
    );
    // Et l'application refuse aussi — un bouton grisé peut toujours être
    // contourné au clavier ou par un état de rendu en retard.
    const tentative = applyDayMacroPreset(semaine, "monday", horaire);
    assert.equal(tentative.ok, false, `${horaire} : l'application doit refuser`);
    assert.equal(
      tentative.ok === false && tentative.message,
      "Répartition automatique non définie pour 6 repas.",
    );
  }

  // À l'écran : quatre boutons désactivés, portant la phrase en info-bulle.
  const html = rendre(étatComplet(), { week: semaine });
  const raccourcis = [...html.matchAll(/<button[^>]*data-raccourci-horaire[^>]*>/g)].map((m) => m[0]);
  assert.equal(raccourcis.length, 4, `quatre raccourcis attendus, ${raccourcis.length} rendus`);
  for (const balise of raccourcis) {
    assert.ok(balise.includes("disabled"), `raccourci non désactivé à six repas : ${balise.slice(0, 90)}`);
  }
  assert.ok(
    html.includes("Répartition automatique non définie pour 6 repas."),
    "la phrase doit être lisible à l'écran, pas seulement dans le code",
  );
});

await test("PRESET-14 — AUCUNE table à six repas n'est inventée", () => {
  assert.deepEqual([...NOMBRES_DE_REPAS_COUVERTS], [3, 4, 5], "le document couvre 3, 4 et 5 repas");
  for (const horaire of HORAIRES_ENTRAINEMENT) {
    assert.deepEqual(
      Object.keys(PRESETS_MACROS[horaire]).sort(),
      ["3", "4", "5"],
      `${horaire} : aucune entrée hors 3-5`,
    );
  }
  // Le compte de lignes est arithmétique : (3 + 4 + 5) × 4 horaires = 48.
  // Une table supplémentaire, même cohérente, ferait bouger ce nombre.
  const total = HORAIRES_ENTRAINEMENT.reduce(
    (somme, horaire) =>
      somme + NOMBRES_DE_REPAS_COUVERTS.reduce((s, n) => s + PRESETS_MACROS[horaire][n].length, 0),
    0,
  );
  assert.equal(total, 48, `48 lignes prescrites au total, ${total} trouvées`);
  const source = sansCommentaires(lire("../../lib/nutrition/macro-presets.ts"));
  // On compte les APPELS — `ligne("breakfast", …)` — et non la déclaration
  // de la fonction, qui prend un paramètre nommé.
  assert.equal(
    source.split('ligne("').length - 1,
    48,
    "la source ne déclare pas d'autres lignes que les 48 du document",
  );
  assert.ok(!/\b6:\s*\[/.test(source), "aucune entrée « 6: [ » dans les tables");
});

await test("PRESET-15 — bon NOMBRE, mauvais JEU de créneaux : refus nommant les créneaux attendus", () => {
  // Quatre repas, mais la collation du MATIN là où MATIN × 4 attend celle de
  // l'après-midi. Poser les valeurs « dans l'ordre » donnerait à la collation
  // du matin les parts prévues pour l'après-midi : autre prescription, donc
  // refus.
  const semaine = semaineAvecCreneaux(["breakfast", "morning_snack", "lunch", "dinner"]);
  const verdict = presetApplicable(lundi(semaine), "matin");
  assert.equal(verdict.ok, false);
  assert.equal(verdict.ok === false && verdict.raison, "creneaux");
  assert.equal(
    verdict.ok === false && verdict.message,
    "Cette répartition nécessite : Petit déjeuner, Déjeuner, Collation de l'après-midi et Dîner.",
    `message attendu au mot près — lu : « ${verdict.ok === false ? verdict.message : ""} »`,
  );
  assert.deepEqual(
    verdict.ok === false && verdict.raison === "creneaux" ? [...verdict.attendus] : null,
    ["breakfast", "lunch", "afternoon_snack", "dinner"],
    "et les créneaux attendus sont exposés, pas seulement écrits dans une phrase",
  );
  assert.equal(applyDayMacroPreset(semaine, "monday", "matin").ok, false, "l'application refuse aussi");

  // Les libellés cités sont EXACTEMENT ceux des cases à cocher : le coach ne
  // doit pas chercher à l'écran un nom qui n'y figure pas.
  for (const libellé of ["Petit déjeuner", "Déjeuner", "Collation de l'après-midi", "Dîner"]) {
    assert.ok(
      Object.values(MEAL_SLOT_LABELS_FR).includes(libellé),
      `« ${libellé} » doit être un libellé de créneau réel`,
    );
  }
});

await test("PRESET-16 — les rôles pré-training et collation du soir sont explicites, jamais positionnels", () => {
  // Avant une séance de MIDI, le pré-training est le MATIN.
  assert.equal(
    PRESETS_MACROS.midi[4].find((l) => l.role === "collation_pre_training")?.slot,
    "morning_snack",
  );
  assert.equal(
    PRESETS_MACROS.midi[5].find((l) => l.role === "collation_pre_training")?.slot,
    "morning_snack",
  );
  // L'APRÈS-MIDI, il tombe après le déjeuner.
  for (const nombre of [4, 5] as const) {
    assert.equal(
      PRESETS_MACROS.apres_midi[nombre].find((l) => l.role === "collation_pre_training")?.slot,
      "afternoon_snack",
    );
  }
  // APRÈS-MIDI × 5 ajoute une collation du SOIR, après le dîner : `dessert`.
  assert.equal(
    PRESETS_MACROS.apres_midi[5].find((l) => l.role === "collation_soir")?.slot,
    "dessert",
  );
  // SOIR × 5 : `afternoon_snack` est DÉJÀ pris par la collation d'après-midi,
  // le pré-training occupe donc `dessert`. C'est le cas qui interdit un
  // mapping par position — les deux rôles sont sur des créneaux différents
  // de ceux d'APRÈS-MIDI × 5, à nombre de repas identique.
  const soirCinq = PRESETS_MACROS.soir[5];
  assert.equal(soirCinq.find((l) => l.role === "collation_apres_midi")?.slot, "afternoon_snack");
  assert.equal(soirCinq.find((l) => l.role === "collation_pre_training")?.slot, "dessert");
  // Et la preuve que ce n'est pas de la position : à créneaux identiques,
  // APRÈS-MIDI × 5 et SOIR × 5 donnent des rôles différents à `dessert`.
  assert.notEqual(
    PRESETS_MACROS.apres_midi[5].find((l) => l.slot === "dessert")?.role,
    soirCinq.find((l) => l.slot === "dessert")?.role,
  );
});

await test("PRESET-17 — `dessert` s'affiche « Collation du soir », la clé technique ne bouge pas", () => {
  assert.equal(MEAL_SLOT_LABELS_FR.dessert, "Collation du soir");
  assert.ok(MEAL_SLOT_KEYS.includes("dessert"), "la clé reste `dessert`");
  // La clé est une valeur d'enum en base : la renommer demanderait une
  // migration. Les tables la citent donc telle quelle.
  const source = sansCommentaires(lire("../../lib/nutrition/macro-presets.ts"));
  assert.ok(source.includes('ligne("dessert"'), "les tables visent bien la clé `dessert`");
  assert.ok(
    !source.includes('"collation_du_soir"') && !source.includes('"evening_snack"'),
    "aucune clé technique inventée pour ce créneau",
  );
  // Et le libellé affiché apparaît à l'écran.
  const html = rendre(étatComplet(), {
    week: semaineAvecCreneaux(["breakfast", "lunch", "afternoon_snack", "dinner", "dessert"]),
  });
  assert.ok(html.includes("Collation du soir"), "l'étiquette est rendue");
});

await test("PRESET-18 — les TROIS macros sont posées d'un coup, et chacune somme à 100 %", () => {
  const semaine = semaineAvecCreneaux(["breakfast", "lunch", "dinner"]);
  // État de départ volontairement déséquilibré sur une seule macro.
  const bancal = setDaySlotMacroBp(semaine, "monday", "breakfast", "carb", 9000);
  const résultat = applyDayMacroPreset(bancal, "monday", "matin");
  assert.ok(résultat.ok);
  // Une seule application a repositionné glucides, protéines ET lipides.
  assert.deepEqual(partsDe(résultat.state, "breakfast"), { carb: 3000, protein: 3000, fat: 1500 });
  assert.deepEqual(partsDe(résultat.state, "lunch"), { carb: 4500, protein: 3500, fat: 2500 });
  assert.deepEqual(partsDe(résultat.state, "dinner"), { carb: 2500, protein: 3500, fat: 6000 });
  for (const macro of ["protein", "carb", "fat"] as const) {
    assert.equal(describeMacroBalance(lundi(résultat.state).slots, macro).totalBp, BASIS_POINTS_TOTAL);
  }
  // Et le coach reprend la main : les curseurs restent solidaires.
  const modifié = setDaySlotMacroBp(résultat.state, "monday", "breakfast", "carb", 5000);
  assert.equal(partsDe(modifié, "breakfast").carb, 5000, "la valeur saisie est prise");
  assert.equal(
    describeMacroBalance(lundi(modifié).slots, "carb").totalBp,
    BASIS_POINTS_TOTAL,
    "et le reste absorbe la différence",
  );
});

await test("PRESET-19 — appliquer un préset LÈVE les verrous du jour", () => {
  const semaine = semaineAvecCreneaux(["breakfast", "lunch", "dinner"]);
  const verrouillé = toggleDaySlotLock(semaine, "monday", "carb", "breakfast");
  assert.ok(lundi(verrouillé).locked.carb.includes("breakfast"), "verrou posé");
  const résultat = applyDayMacroPreset(verrouillé, "monday", "midi");
  assert.ok(résultat.ok);
  assert.deepEqual(lundi(résultat.state).locked, { protein: [], carb: [], fat: [] });
  // Le cadenas désignait une valeur que le préset vient de remplacer : le
  // garder aurait figé un chiffre qui n'a plus de raison d'être.
  assert.equal(partsDe(résultat.state, "breakfast").carb, 2500);
});

await test("PRESET-20 — aucun enregistrement : fonctions pures, aucun appel Supabase", () => {
  const source = lire("../../lib/nutrition/macro-presets.ts");
  const forme = lire("../../lib/nutrition/plan-v2-week-form.ts");
  for (const [nom, code] of [["macro-presets", source], ["plan-v2-week-form", forme]] as const) {
    assert.ok(!code.includes("createSupabaseBrowserClient"), `${nom} : aucun client Supabase`);
    assert.ok(!code.includes(".from("), `${nom} : aucune requête`);
    assert.ok(!code.includes("fetch("), `${nom} : aucun réseau`);
  }
  // Et le panneau n'enregistre rien au clic : il passe par `onChange`, comme
  // n'importe quel geste manuel.
  const panneau = lire("../../components/admin/NutritionPlanV2WeekPanel.tsx");
  const bloc = panneau.slice(panneau.indexOf("onAppliquer:"), panneau.indexOf("onAppliquer:") + 400);
  assert.ok(bloc.includes("onChange("), "le préset passe par onChange");
  assert.ok(!bloc.includes("save") && !bloc.includes("Save"), "aucun enregistrement déclenché");
});

await test("PRESET-21 — un préset ne touche NI les repas cochés, NI les calories, NI la macro du jour, NI les autres jours", () => {
  const semaine = semaineAvecCreneaux(["breakfast", "lunch", "afternoon_snack", "dinner"]);
  const avant = lundi(semaine);
  const repasAvant = creneauxActifs(avant);
  const ordreAvant = avant.slots.map((a) => `${a.slot}:${a.displayOrder}`);

  const résultat = applyDayMacroPreset(semaine, "monday", "apres_midi");
  assert.ok(résultat.ok);
  const après = lundi(résultat.state);

  assert.deepEqual(creneauxActifs(après), repasAvant, "les repas cochés sont EXACTEMENT les mêmes");
  assert.deepEqual(
    après.slots.map((a) => `${a.slot}:${a.displayOrder}`),
    ordreAvant,
    "aucun display_order modifié",
  );
  assert.equal(après.dailyCalories, avant.dailyCalories);
  assert.equal(après.proteinBp, avant.proteinBp);
  assert.equal(après.carbBp, avant.carbBp);
  assert.equal(après.fatBp, avant.fatBp);
  assert.deepEqual(après.meals, avant.meals, "les repas prescrits ne bougent pas");

  // Les six autres jours sont intacts.
  for (const jour of résultat.state.days) {
    if (jour.day === "monday") continue;
    assert.deepEqual(jour, semaine.days.find((d) => d.day === jour.day), `${jour.day} ne doit pas bouger`);
  }
  // Et l'entrée n'a pas été mutée : `applyDayMacroPreset` rend un nouvel état.
  assert.deepEqual(creneauxActifs(lundi(semaine)), repasAvant, "aucune mutation de l'état d'entrée");
});

await test("PRESET-22 — quatre raccourcis compacts, en type=button, avant les contrôles qu'ils pilotent", () => {
  const html = rendre(étatComplet(), { week: semaineAvecCreneaux(["breakfast", "lunch", "dinner"]) });
  for (const libellé of ["Matin", "Midi", "Après-midi", "Soir"]) {
    assert.ok(html.includes(`>${libellé}</button>`), `bouton « ${libellé} »`);
  }
  const iPresets = html.indexOf("data-raccourci-horaire");
  assert.ok(iPresets > -1, "les raccourcis sont rendus");
  assert.ok(iPresets < html.indexOf("Petit déjeuner"), "les présets précèdent les cases de repas");
  // Le premier `role="tablist"` de la page est celui des JOURS : on vise
  // celui des macros par son libellé, sinon on comparerait avec un autre
  // composant.
  assert.ok(iPresets < html.indexOf("Macronutriment"), "et les onglets de macro");

  const raccourcis = [...html.matchAll(/<button[^>]*data-raccourci-horaire[^>]*>/g)].map((m) => m[0]);
  assert.equal(raccourcis.length, 4, `quatre raccourcis attendus, ${raccourcis.length} rendus`);
  for (const balise of raccourcis) {
    // Dans un <form>, un bouton sans type vaut « submit » : il enregistrerait.
    assert.ok(balise.includes('type="button"'), `raccourci sans type=button : ${balise.slice(0, 90)}`);
    // Compacts : une ligne de 28 px en petite typographie, pas quatre pavés.
    assert.ok(balise.includes("h-7"), `raccourci non compact (hauteur) : ${balise.slice(0, 90)}`);
    assert.ok(balise.includes("text-[11px]"), `raccourci non compact (typo) : ${balise.slice(0, 90)}`);
    assert.ok(!balise.includes("w-full"), `raccourci pleine largeur : ${balise.slice(0, 90)}`);
  }
});

await test("PRESET-23 — les douze tables somment à 100 % sur CHAQUE macro, sans créneau répété", () => {
  for (const horaire of HORAIRES_ENTRAINEMENT) {
    for (const nombre of NOMBRES_DE_REPAS_COUVERTS) {
      const lignes = PRESETS_MACROS[horaire][nombre];
      assert.equal(lignes.length, nombre, `${horaire}/${nombre} : ${lignes.length} lignes`);
      for (const macro of ["carbBp", "proteinBp", "fatBp"] as const) {
        const total = lignes.reduce((somme, l) => somme + l[macro], 0);
        assert.equal(total, BASIS_POINTS_TOTAL, `${horaire}/${nombre}/${macro} = ${total}`);
      }
      // Un créneau ne peut pas recevoir deux lignes : la seconde écraserait
      // la première en silence.
      assert.equal(new Set(lignes.map((l) => l.slot)).size, nombre, `${horaire}/${nombre} : créneau répété`);
    }
  }
  // La même règle, sur la transcription indépendante du document : si la
  // transcription elle-même était fausse, les douze premiers tests
  // compareraient deux erreurs.
  for (const horaire of Object.keys(TABLES_REFERENCE)) {
    for (const nombre of [3, 4, 5]) {
      const lignes = TABLES_REFERENCE[horaire][nombre];
      for (const champ of ["g", "p", "l"] as const) {
        const total = lignes.reduce((somme, l) => somme + l[champ], 0);
        assert.equal(total, 100, `document ${horaire}/${nombre}/${champ} = ${total} %`);
      }
    }
  }
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
