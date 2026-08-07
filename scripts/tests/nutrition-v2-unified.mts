/**
 * Harnais — feat/student-nutrition-recipes, PR C.
 *
 * UNIFICATION DU MODÈLE NUTRITIONNEL : le v2 devient le seul modèle, et les
 * trois outils cohabitent sans se mélanger.
 *
 * OÙ CHAQUE GARANTIE EST PROUVÉE.
 *   - Ce fichier prouve la LOGIQUE : vocabulaire unique, objectifs par jour,
 *     total hebdomadaire à profils multiples, sélection des créneaux et des
 *     recettes, chaîne de calcul du solveur, absence de persistance.
 *   - Le comportement TRANSACTIONNEL et la SÉCURITÉ (conversion v1 → v2, RLS
 *     élève, cloisonnement des coachs, rollback) sont prouvés sur un vrai
 *     PostgreSQL par supabase/tests/nutrition_v2_unified_checklist.sql.
 *
 * Lancement : npx tsx scripts/tests/nutrition-v2-unified.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { KCAL_PER_GRAM, computeDailyMacroTargets } from "../../lib/nutrition/macro-targets";
import { MEAL_SLOT_KEYS, type MealSlotAllocation } from "../../lib/nutrition/meal-distribution";
import {
  completeWeek,
  dailyTargetsByWeekday,
  dailyTargetsForDay,
  enabledSlotsForDay,
  orderedDays,
  orderedMeals,
  profileForDay,
  recipesForSlot,
  slotMacrosForDay,
  slotTargetForDay,
  weeklyCaloriesFromDays,
  type PlanV2Day,
  type PlanV2Week,
} from "../../lib/nutrition/plan-v2-week";
import {
  addMeal,
  applyDayToWholeWeek,
  toggleDaySlotLock,
  createBlankWeek,
  createWeekFormFromPlan,
  duplicateDay,
  initializeAllDays,
  itemsToText,
  mainDayTargets,
  removeMeal,
  resetDay,
  setDayCalories,
  setDayMacroBp,
  setDaySlotEnabled,
  setDaySlotMacroBp,
  textToItems,
  toWeekSavePayload,
  updateMeal,
  weeklyCaloriesFromForm,
  type WeekFormState,
} from "../../lib/nutrition/plan-v2-week-form";
import {
  DAY_PROFILE_KEYS,
  MAIN_DAY_PROFILE_KEY,
  internalProfileKeyForDay,
} from "../../lib/nutrition/day-profile-keys";
import { rebalanceDailyMacros, rebalanceToTotal } from "../../lib/nutrition/macro-rebalance";
import { BASIS_POINTS_TOTAL } from "../../lib/nutrition/basis-points";
import {
  WEEKDAY_KEYS,
  WEEKDAY_LABELS_FR,
  compareWeekdays,
  describeWeekday,
  isWeekdayKey,
  toWeekdayKey,
} from "../../lib/nutrition/weekdays";
import { formatSolvedIngredientQuantity } from "../../lib/nutrition/recipe-quantity";
import { describeRecipeFit } from "../../lib/nutrition/recipe-matching";
import { solveRecipe } from "../../lib/nutrition/recipe-solver";
import type { RecipeWithTags } from "../../lib/nutrition/recipe-rows";
import {
  computeWeeklyNutritionAdjustment,
  getCurrentWeekDates,
} from "../../lib/nutrition-weekly";
import { isStudentRouteActive } from "../../lib/student-shell-nav";
import { buildSaveNutritionPlanV2Payload } from "../../lib/supabase/nutrition-v2";
import { RECETTE_SIMPLE_PGL, RECETTE_MAXIMUM } from "./fixtures/nutrition-recipes";

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
function sansCommentairesTs(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}
function sansCommentairesSql(s: string): string {
  return s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}

const M_DURCISSEMENT = lire("../../supabase/migrations/20260810090000_harden_nutrition_privileges.sql");
const M_UNIFICATION = lire("../../supabase/migrations/20260811090000_nutrition_v2_unification.sql");
const M_SAUVEGARDE = lire("../../supabase/migrations/20260812090000_save_nutrition_plan_v2_full.sql");
const M_RECETTES = lire("../../supabase/migrations/20260813090000_student_recipe_read_access.sql");
const CHECKLIST = lire("../../supabase/tests/nutrition_v2_unified_checklist.sql");
const PAGE_ELEVE_DETAIL = lire("../../app/(student)/nutrition/[planId]/page.tsx");
const PAGE_ELEVE_LISTE = lire("../../app/(student)/nutrition/page.tsx");
const PAGE_RECETTES = lire("../../app/(student)/nutrition/[planId]/recettes/page.tsx");
const RECETTES_ELEVE = lire("../../components/student/StudentAdaptiveRecipes.tsx");
const SEMAINE_ELEVE = lire("../../components/student/StudentPrescribedWeek.tsx");
const PANNEAU_SEMAINE = lire("../../components/admin/NutritionPlanV2WeekPanel.tsx");
const CONSTRUCTEUR = lire("../../components/admin/NutritionPlanV2Builder.tsx");
const JOUR_ONGLETS = lire("../../components/admin/NutritionDayTabs.tsx");
const JOUR_OBJECTIFS = lire("../../components/admin/NutritionDayTargets.tsx");
const JOUR_REPARTITION = lire("../../components/admin/NutritionDaySlotDistribution.tsx");
const JOUR_REPAS = lire("../../components/admin/NutritionDayManualMeals.tsx");
const PAGE_NOUVEAU = lire("../../app/admin/nutrition/nouveau/page.tsx");
const PAGE_ADMIN_PLAN = lire("../../app/admin/nutrition/[planId]/page.tsx");
const APERCU_ADMIN = lire("../../components/admin/RecipeAdaptivePreview.tsx");
const SEMAINE_LIB = lire("../../lib/nutrition/plan-v2-week.ts");
const SEMAINE_FORM = lire("../../lib/nutrition/plan-v2-week-form.ts");
const LECTURE_SEMAINE = lire("../../lib/supabase/nutrition-week.ts");
const HOOK_ELEVE = lire("../../hooks/useStudentNutritionPlanV2.ts");
const M_CYCLE_DE_VIE = lire("../../supabase/migrations/20260815090000_nutrition_lifecycle.sql");
// 20260815 et 20260816 sont APPLIQUÉES en Production, donc immuables : toute
// évolution de règle vit dans une migration NOUVELLE, et c'est elle qu'il faut
// lire pour connaître le comportement en vigueur.
const M_SUPPRESSION = lire("../../supabase/migrations/20260817090000_nutrition_plan_deletion_history.sql");
const HOOK_CYCLE_DE_VIE = lire("../../hooks/useNutritionLifecycle.ts");
const SERVICE_CYCLE_DE_VIE = lire("../../lib/supabase/nutrition-lifecycle.ts");
const LECTURE_PLANS = lire("../../lib/supabase/nutrition.ts");

/* ────────────────────────── Aides ────────────────────────── */

const CRENEAUX_STANDARD: MealSlotAllocation[] = [
  { slot: "breakfast", enabled: true, proteinBp: 2500, carbBp: 2500, fatBp: 2500, displayOrder: 0 },
  { slot: "morning_snack", enabled: false, proteinBp: 0, carbBp: 0, fatBp: 0, displayOrder: 1 },
  { slot: "lunch", enabled: true, proteinBp: 3500, carbBp: 3500, fatBp: 3500, displayOrder: 2 },
  { slot: "afternoon_snack", enabled: true, proteinBp: 1000, carbBp: 1000, fatBp: 1000, displayOrder: 3 },
  { slot: "dinner", enabled: true, proteinBp: 3000, carbBp: 3000, fatBp: 3000, displayOrder: 4 },
  { slot: "dessert", enabled: false, proteinBp: 0, carbBp: 0, fatBp: 0, displayOrder: 5 },
];

function semaineFactice(): PlanV2Week {
  const profils = [
    { profileKey: "standard", dailyCalories: 2000, proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD },
    { profileKey: "training_high", dailyCalories: 2200, proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD },
    { profileKey: "rest", dailyCalories: 1900, proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD },
  ];
  const affectation: Record<string, string> = {
    monday: "standard",
    tuesday: "training_high",
    wednesday: "rest",
    thursday: "training_high",
    friday: "standard",
    saturday: "standard",
    sunday: "rest",
  };
  const days: PlanV2Day[] = WEEKDAY_KEYS.map((jour) => ({
    id: `jour-${jour}`,
    day: jour,
    profileKey: affectation[jour],
    status: "non-commence",
    meals: [],
  }));
  return { planId: "plan-1", profiles: profils, days };
}

function recetteFactice(
  id: string,
  nom: string,
  slot: RecipeWithTags["slotKey"],
): RecipeWithTags {
  return {
    recipe: {
      id,
      name: nom,
      slot,
      ingredients: [
        {
          id: `${id}-p`, name: "Poulet", role: "protein",
          proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 140,
          minGrams: null, maxGrams: null, unitScalable: false, maxUnits: null,
          unitName: null, fixedLabel: null, egg: false, eggGrams: null,
          linkedToIngredientId: null, linkRatioBp: null,
        },
      ],
    },
    slotKey: slot,
    status: "active",
    tags: [],
    description: null,
    sourceKey: null,
    updatedAt: "2026-08-05T09:00:00Z",
  };
}

/* ═══════════ 1. Vocabulaire unique ═══════════ */

await test("1. les SEPT jours ont une clé unique, et un seul libellé français", () => {
  assert.deepEqual([...WEEKDAY_KEYS], [
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  ]);
  assert.equal(new Set(WEEKDAY_KEYS).size, 7);
  for (const cle of WEEKDAY_KEYS) {
    assert.ok(WEEKDAY_LABELS_FR[cle].length > 3, cle);
  }
  assert.equal(describeWeekday("monday"), "Lundi");
  assert.equal(describeWeekday("inconnu"), "inconnu", "une valeur inconnue reste visible");
});

await test("2. les anciens libellés français sont traduits, rien n'est deviné", () => {
  assert.equal(toWeekdayKey("Lundi"), "monday");
  assert.equal(toWeekdayKey("Dimanche"), "sunday");
  assert.equal(toWeekdayKey("monday"), "monday", "une clé reste une clé");
  assert.equal(toWeekdayKey("lundi"), null, "aucune correspondance approximative");
  assert.equal(toWeekdayKey(null), null);
  assert.ok(isWeekdayKey("friday") && !isWeekdayKey("Friday"));
});

await test("3. l'ordre est TOUJOURS lundi → dimanche, jamais alphabétique", () => {
  const mélangé = ["sunday", "wednesday", "monday", "friday"];
  assert.deepEqual(mélangé.slice().sort(compareWeekdays), [
    "monday", "wednesday", "friday", "sunday",
  ]);
  // L'ordre alphabétique donnerait friday, monday, sunday, wednesday.
  assert.notDeepEqual(mélangé.slice().sort(compareWeekdays), mélangé.slice().sort());
  const jours = orderedDays(semaineFactice().days.slice().reverse());
  assert.deepEqual(jours.map((j) => j.day), [...WEEKDAY_KEYS]);
});

await test("4. AUCUNE troisième liste de créneaux n'est créée", () => {
  // Les six clés v2 sont la seule source ; la migration les répète à
  // l'identique, et les composants les importent.
  assert.deepEqual([...MEAL_SLOT_KEYS], [
    "breakfast", "morning_snack", "lunch", "afternoon_snack", "dinner", "dessert",
  ]);
  const sql = sansCommentairesSql(M_UNIFICATION);
  for (const cle of MEAL_SLOT_KEYS) {
    assert.ok(sql.includes(`'${cle}'`), `la migration connaît ${cle}`);
  }
  for (const source of [RECETTES_ELEVE, SEMAINE_ELEVE, PANNEAU_SEMAINE, JOUR_REPAS, JOUR_REPARTITION]) {
    const code = sansCommentairesTs(source);
    assert.ok(
      !/\[\s*"breakfast"\s*,\s*"morning_snack"/.test(code),
      "aucune liste de créneaux réécrite dans un composant",
    );
  }
  // La liste vient de `meal-distribution.ts` : le composant qui propose un
  // créneau l'importe, il ne la redéclare pas. Depuis la refonte « semaine
  // d'abord », c'est la carte de repas qui la porte.
  assert.ok(JOUR_REPAS.includes("MEAL_SLOT_KEYS"), "la carte de repas importe la liste");
  assert.ok(JOUR_REPARTITION.includes("MEAL_SLOT_LABELS_FR"), "la répartition importe les libellés");
});

/* ═══════════ 2. Objectifs par jour ═══════════ */

await test("5. chaque jour tire ses objectifs de SON profil", () => {
  const semaine = semaineFactice();
  const lundi = semaine.days.find((d) => d.day === "monday")!;
  const mardi = semaine.days.find((d) => d.day === "tuesday")!;

  assert.equal(profileForDay(semaine, lundi)?.dailyCalories, 2000);
  assert.equal(profileForDay(semaine, mardi)?.dailyCalories, 2200);

  const cibleLundi = dailyTargetsForDay(semaine, lundi)!;
  const cibleMardi = dailyTargetsForDay(semaine, mardi)!;
  assert.equal(cibleLundi.dailyCalories, 2000);
  assert.equal(cibleMardi.dailyCalories, 2200);
  assert.ok(cibleMardi.grams.proteinGrams > cibleLundi.grams.proteinGrams);
});

await test("6. un jour dont le profil est absent ne devine RIEN", () => {
  const semaine = semaineFactice();
  const orphelin: PlanV2Day = {
    id: "x", day: "monday", profileKey: "inexistant", status: "non-commence", meals: [],
  };
  assert.equal(profileForDay(semaine, orphelin), null);
  assert.equal(dailyTargetsForDay(semaine, orphelin), null);
  assert.deepEqual([...enabledSlotsForDay(semaine, orphelin)], []);
});

await test("7. le total HEBDOMADAIRE est la somme des sept jours, jamais × 7", () => {
  const semaine = semaineFactice();
  // 2000 + 2200 + 1900 + 2200 + 2000 + 2000 + 1900
  assert.equal(weeklyCaloriesFromDays(semaine), 14200);
  assert.notEqual(weeklyCaloriesFromDays(semaine), 2000 * 7);

  // Un seul profil partout : la somme redevient naturellement × 7.
  const uniforme: PlanV2Week = {
    ...semaine,
    days: semaine.days.map((d) => ({ ...d, profileKey: "standard" })),
  };
  assert.equal(weeklyCaloriesFromDays(uniforme), 14000);
});

await test("8. le calcul TypeScript et le calcul SQL disent la même chose", () => {
  // La RPC additionne les calories du profil de chaque jour ; le module pur
  // fait exactement la même somme. Les deux formulations sont vérifiées côté
  // SQL par la checklist (D8/D9) et ici côté TypeScript.
  const sql = sansCommentairesSql(M_SAUVEGARDE);
  assert.ok(sql.includes("select sum(pr.daily_calories) into v_weekly_target"));
  assert.ok(
    sql.includes("join public.nutrition_plan_profiles pr\n      on pr.plan_id = d.plan_id and pr.profile_key = d.profile_key"),
    "la somme joint bien chaque jour à SON profil",
  );
  assert.ok(!/daily_calories \* 7/.test(sql), "aucune multiplication par 7 ne subsiste");
});

/* ═══════════ 3. Créneaux et cible du solveur ═══════════ */

await test("9. seuls les créneaux ACTIVÉS du profil du jour sont proposés", () => {
  const semaine = semaineFactice();
  const lundi = semaine.days[0];
  assert.deepEqual([...enabledSlotsForDay(semaine, lundi)], [
    "breakfast", "lunch", "afternoon_snack", "dinner",
  ]);
  // Les deux créneaux à zéro sont bien exclus.
  assert.ok(!enabledSlotsForDay(semaine, lundi).includes("morning_snack"));
  assert.ok(!enabledSlotsForDay(semaine, lundi).includes("dessert"));
});

await test("10. la cible d'un créneau vient de la CHAÎNE complète, sans raccourci", () => {
  const semaine = semaineFactice();
  const lundi = semaine.days.find((d) => d.day === "monday")!;
  const cible = slotTargetForDay(semaine, lundi, "lunch");
  assert.ok(cible.ok);
  if (!cible.ok) return;

  // Recalcul indépendant : 35 % des grammes du jour.
  const jour = computeDailyMacroTargets({
    dailyCalories: 2000, proteinBp: 2800, carbBp: 4400, fatBp: 2800,
  });
  assert.ok(Math.abs(cible.target.proteinGrams - jour.grams.proteinGrams * 0.35) < 1e-9);
  assert.ok(Math.abs(cible.target.carbGrams - jour.grams.carbGrams * 0.35) < 1e-9);
  assert.ok(Math.abs(cible.target.fatGrams - jour.grams.fatGrams * 0.35) < 1e-9);

  // Les calories du créneau dérivent des GRAMMES, jamais d'un pourcentage de kcal.
  const attendu =
    cible.target.proteinGrams * KCAL_PER_GRAM.protein +
    cible.target.carbGrams * KCAL_PER_GRAM.carb +
    cible.target.fatGrams * KCAL_PER_GRAM.fat;
  assert.ok(Math.abs(cible.calories - attendu) < 1e-6);
});

await test("11. changer de jour change la cible du MÊME créneau", () => {
  const semaine = semaineFactice();
  const lundi = semaine.days.find((d) => d.day === "monday")!;
  const mardi = semaine.days.find((d) => d.day === "tuesday")!;
  const cl = slotTargetForDay(semaine, lundi, "lunch");
  const cm = slotTargetForDay(semaine, mardi, "lunch");
  assert.ok(cl.ok && cm.ok);
  if (!cl.ok || !cm.ok) return;
  assert.ok(cm.target.proteinGrams > cl.target.proteinGrams, "2 200 kcal > 2 000 kcal");
  assert.ok(cm.calories > cl.calories);
});

await test("12. un créneau DÉSACTIVÉ est refusé, pas ramené à zéro", () => {
  const semaine = semaineFactice();
  const lundi = semaine.days[0];
  const cible = slotTargetForDay(semaine, lundi, "dessert");
  assert.equal(cible.ok, false);
  if (cible.ok) return;
  assert.equal(cible.reason, "slot_disabled");
});

await test("13. un profil sans calories est SIGNALÉ, jamais calculé", () => {
  const semaine: PlanV2Week = {
    planId: "p", profiles: [
      { profileKey: "vide", dailyCalories: 0, proteinBp: 0, carbBp: 0, fatBp: 0, slots: CRENEAUX_STANDARD },
    ],
    days: [{ id: "d", day: "monday", profileKey: "vide", status: "non-commence", meals: [] }],
  };
  const cible = slotTargetForDay(semaine, semaine.days[0], "lunch");
  assert.equal(cible.ok, false);
  if (cible.ok) return;
  assert.equal(cible.reason, "no_calories");
});

/* ═══════════ 4. Sélection des recettes ═══════════ */

await test("14. une recette GÉNÉRIQUE apparaît dans tous les créneaux", () => {
  const recettes = [
    recetteFactice("r-generique", "Générique", null),
    recetteFactice("r-lunch", "Déjeuner", "lunch"),
    recetteFactice("r-breakfast", "Petit déjeuner", "breakfast"),
  ];
  for (const slot of MEAL_SLOT_KEYS) {
    const proposées = recipesForSlot(recettes, slot).map((r) => r.recipe.id);
    assert.ok(proposées.includes("r-generique"), `générique visible dans ${slot}`);
  }
});

await test("15. une recette de PETIT DÉJEUNER n'apparaît pas au dîner", () => {
  const recettes = [
    recetteFactice("r-breakfast", "Petit déjeuner", "breakfast"),
    recetteFactice("r-dinner", "Dîner", "dinner"),
  ];
  const auDîner = recipesForSlot(recettes, "dinner").map((r) => r.recipe.id);
  assert.deepEqual(auDîner, ["r-dinner"]);
  const auPetitDéjeuner = recipesForSlot(recettes, "breakfast").map((r) => r.recipe.id);
  assert.deepEqual(auPetitDéjeuner, ["r-breakfast"]);
});

await test("16. le tri des recettes est DÉTERMINISTE", () => {
  const recettes = [
    recetteFactice("b", "Zèbre", "lunch"),
    recetteFactice("a", "Ananas", "lunch"),
    recetteFactice("c", "Ananas", "lunch"),
  ];
  const noms = recipesForSlot(recettes, "lunch").map((r) => r.recipe.id);
  assert.deepEqual(noms, ["a", "c", "b"], "nom puis identifiant");
  // Deux appels successifs rendent le même ordre.
  assert.deepEqual(recipesForSlot(recettes, "lunch").map((r) => r.recipe.id), noms);
});

await test("17. les brouillons et archives ne sont PAS filtrés côté client", () => {
  // C'est la RLS qui ne les rend pas. Filtrer ici donnerait l'illusion que le
  // client protège quelque chose — la migration est la seule barrière.
  const code = sansCommentairesTs(SEMAINE_LIB);
  assert.ok(!/status\s*===\s*"active"/.test(code), "aucun filtrage de statut côté client");
  const sql = sansCommentairesSql(M_RECETTES);
  assert.ok(sql.includes("status = 'active'"), "la policy élève, elle, l'exige");
});

/* ═══════════ 5. Le solveur, une seule fois ═══════════ */

await test("18. solveur EXACT : quantités affichées, cible atteinte", () => {
  // Cible réellement atteignable par cette recette : les bornes de ses
  // ingrédients le permettent. On ne choisit pas une cible « ronde » qui
  // rendrait `impossible` et ferait passer le test pour la mauvaise raison.
  const solution = solveRecipe(RECETTE_MAXIMUM, {
    target: { proteinGrams: 80, carbGrams: 80, fatGrams: 10 },
  });
  assert.equal(solution.status, "exact");
  const verdict = describeRecipeFit(solution);
  assert.equal(verdict.proposable, true);
  assert.ok(verdict.summary.length > 10);
  for (const ing of solution.ingredients) {
    assert.ok(Number.isFinite(ing.grams) && Number.isFinite(ing.calories));
  }
});

await test("19. solveur APPROXIMATIF et IMPOSSIBLE : les deux sont exploitables", () => {
  const approx = solveRecipe(RECETTE_MAXIMUM, {
    target: { proteinGrams: 120, carbGrams: 150, fatGrams: 30 },
  });
  assert.equal(approx.status, "approximate");
  assert.equal(describeRecipeFit(approx).proposable, true);

  const impossible = solveRecipe(RECETTE_MAXIMUM, {
    target: { proteinGrams: 200, carbGrams: 300, fatGrams: 60 },
  });
  assert.equal(impossible.status, "impossible");
  assert.equal(describeRecipeFit(impossible).proposable, false);
  assert.ok(describeRecipeFit(impossible).summary.length > 10);
});

await test("20. AUCUN Infinity, AUCUN NaN, quelle que soit la cible", () => {
  const cibles = [
    { proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
    { proteinGrams: 1, carbGrams: 0, fatGrams: 0 },
    { proteinGrams: 500, carbGrams: 500, fatGrams: 500 },
  ];
  for (const target of cibles) {
    for (const recette of [RECETTE_SIMPLE_PGL, RECETTE_MAXIMUM]) {
      const s = solveRecipe(recette, { target });
      assert.ok(Number.isFinite(s.totals.calories), `totaux finis pour ${JSON.stringify(target)}`);
      for (const ing of s.ingredients) {
        assert.ok(Number.isFinite(ing.grams), `grammes finis : ${ing.grams}`);
        assert.ok(Number.isFinite(ing.displayGrams));
        assert.ok(ing.eggCount === null || Number.isFinite(ing.eggCount));
        assert.ok(!formatSolvedIngredientQuantity(ing).includes("NaN"));
        assert.ok(!formatSolvedIngredientQuantity(ing).includes("Infinity"));
      }
    }
  }
});

await test("21. le formatage des quantités est PARTAGÉ, jamais dupliqué", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, {
    target: { proteinGrams: 40, carbGrams: 80, fatGrams: 20 },
  });
  const rendu = formatSolvedIngredientQuantity(solution.ingredients[0]);
  assert.ok(/\d/.test(rendu) && /g|œuf|unité|tranche|[a-zà-ÿ]/i.test(rendu), rendu);

  // L'aperçu admin ET l'écran élève appellent la MÊME fonction.
  assert.ok(APERCU_ADMIN.includes("formatSolvedIngredientQuantity"));
  assert.ok(RECETTES_ELEVE.includes("formatSolvedIngredientQuantity"));
  assert.ok(
    !/function quantite\(/.test(sansCommentairesTs(APERCU_ADMIN)),
    "l'ancienne copie locale a disparu",
  );
});

await test("22. il n'existe qu'UN SEUL solveur, et aucune formule 4/4/9 réécrite", () => {
  for (const [nom, source] of Object.entries({
    RECETTES_ELEVE, SEMAINE_ELEVE, SEMAINE_LIB, SEMAINE_FORM, PANNEAU_SEMAINE,
  })) {
    const code = sansCommentairesTs(source);
    assert.ok(!/function solve[A-Z]/.test(code), `${nom} ne définit aucun solveur`);
    assert.ok(
      !/\*\s*4\b[\s\S]{0,40}\*\s*9\b/.test(code),
      `${nom} ne réécrit pas la formule 4 / 4 / 9`,
    );
  }
  assert.ok(RECETTES_ELEVE.includes("solveRecipe"), "l'écran élève utilise le solveur existant");
});

/* ═══════════ 6. Aucune persistance du calcul ═══════════ */

await test("23. l'écran de recettes élève n'écrit RIEN", () => {
  const code = sansCommentairesTs(RECETTES_ELEVE);
  assert.ok(!code.includes("@/lib/supabase"), "aucun import de la couche Supabase");
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/.test(code));
  for (const interdit of ["Enregistrer", "Appliquer", "Ajouter au plan", "Marquer comme consommé"]) {
    assert.ok(!code.includes(interdit), `aucun bouton « ${interdit} »`);
  }
});

await test("24. la couche de lecture de la semaine n'écrit RIEN non plus", () => {
  const code = sansCommentairesTs(LECTURE_SEMAINE);
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code));
  const froms = [...code.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(froms)].sort(), ["meals", "nutrition_days"]);
});

await test("25. la charge utile de sauvegarde ne contient AUCUNE quantité calculée", () => {
  const semaine = createBlankWeek();
  const payload = toWeekSavePayload(semaine);
  const texte = JSON.stringify(payload);
  for (const interdit of ["displayGrams", "solvedGrams", "boundHit", "warnings", "deltas", "unitLabel"]) {
    assert.ok(!texte.includes(interdit), `aucune trace de ${interdit}`);
  }
  const sql = sansCommentairesSql(M_SAUVEGARDE);
  for (const interdit of ["display_grams", "solved_", "bound_hit"]) {
    assert.ok(!sql.includes(interdit), `la RPC ne connaît pas ${interdit}`);
  }
});

/* ═══════════ 7. La semaine manuelle du coach ═══════════ */

await test("26. sept jours INDÉPENDANTS dès la création, sans le moindre profil", () => {
  // RÉÉCRIT PAR LA REFONTE « SEMAINE D'ABORD ». Ce contrôle vérifiait que les
  // sept jours étaient rattachés au profil principal ; le coach ne manipule
  // plus de profil du tout, et l'état de formulaire n'en porte plus aucun.
  const semaine = createBlankWeek();
  assert.equal(semaine.days.length, 7);
  assert.deepEqual(semaine.days.map((d) => d.day), [...WEEKDAY_KEYS]);
  assert.ok(semaine.days.every((d) => d.meals.length === 0));
  // Chaque jour porte SA configuration, pas une référence partagée.
  assert.ok(semaine.days.every((d) => d.slots.length === 6));
  assert.ok(!("profiles" in semaine), "l'état de formulaire n'expose plus de profils");
  assert.ok(!("mainProfileKey" in semaine));
  // Aucun tableau n'est partagé entre deux jours.
  assert.notEqual(semaine.days[0].slots, semaine.days[1].slots);
});

await test("27. ajout, modification et retrait d'un repas", () => {
  let s = createBlankWeek();
  s = addMeal(s, "monday", "lunch");
  const repas = s.days.find((d) => d.day === "monday")!.meals[0];
  assert.equal(repas.slot, "lunch");

  s = updateMeal(s, "monday", repas.id, {
    name: "Repas avant entraînement",
    items: [
      { name: "Blanc de poulet", quantity: "150 g" },
      { name: "Riz basmati", quantity: "100 g cru" },
    ],
    calories: 650, protein: 45, carbs: 80, fat: 15,
    coachNotes: "Peser le riz cru.",
  });
  const modifié = s.days.find((d) => d.day === "monday")!.meals[0];
  assert.equal(modifié.name, "Repas avant entraînement");
  assert.equal(modifié.items.length, 2);
  assert.equal(modifié.coachNotes, "Peser le riz cru.");

  s = removeMeal(s, "monday", repas.id);
  assert.equal(s.days.find((d) => d.day === "monday")!.meals.length, 0);
});

await test("28. dupliquer un jour copie TOUT et renouvelle les identifiants de repas", () => {
  let s = createBlankWeek();
  s = setDayCalories(s, "monday", 2300);
  s = setDayMacroBp(s, "monday", "protein", 3000);
  s = setDaySlotMacroBp(s, "monday", "lunch", "protein", 4000);
  s = addMeal(s, "monday", "lunch");
  const source = s.days.find((d) => d.day === "monday")!;
  const repasSource = source.meals[0];
  s = updateMeal(s, "monday", repasSource.id, { name: "Poulet riz", coachNotes: "Peser cru." });

  s = duplicateDay(s, "monday", ["tuesday"]);
  const lundi = s.days.find((d) => d.day === "monday")!;
  const mardi = s.days.find((d) => d.day === "tuesday")!;

  // Calories, répartition, allocations, repas ET notes.
  assert.equal(mardi.dailyCalories, 2300);
  assert.equal(mardi.proteinBp, lundi.proteinBp);
  assert.equal(mardi.carbBp, lundi.carbBp);
  assert.equal(mardi.fatBp, lundi.fatBp);
  assert.deepEqual(
    mardi.slots.map((a) => a.proteinBp),
    lundi.slots.map((a) => a.proteinBp),
  );
  assert.equal(mardi.meals[0].name, "Poulet riz");
  assert.equal(mardi.meals[0].coachNotes, "Peser cru.");
  assert.notEqual(mardi.meals[0].id, lundi.meals[0].id, "sans identifiant neuf, la RPC refuserait");
  // L'identifiant de la JOURNÉE de destination est conservé : on remplit une
  // ligne existante, on n'en crée pas une seconde.
  assert.equal(mardi.id, createBlankWeek().days.find((d) => d.day === "tuesday")!.id);
  // Le jour source est intact.
  assert.equal(lundi.meals[0].id, repasSource.id);
});

await test("29. modifier mardi ne modifie JAMAIS lundi", () => {
  // RÉÉCRIT. Ce contrôle vérifiait le changement de profil d'un jour et la
  // libération des jours quand un profil disparaissait. Ces deux gestes
  // n'existent plus : chaque jour possède son propre profil interne, dérivé
  // de son nom. La garantie qui compte désormais est l'INDÉPENDANCE.
  let s = createBlankWeek();
  s = initializeAllDays(s, { dailyCalories: 2000, proteinBp: 3000, carbBp: 4500, fatBp: 2500 });
  s = addMeal(s, "monday", "lunch");

  const lundiAvant = s.days.find((d) => d.day === "monday")!;
  s = setDayCalories(s, "tuesday", 2600);
  s = setDayMacroBp(s, "tuesday", "protein", 4000);
  s = setDaySlotEnabled(s, "tuesday", "dessert", false);
  s = addMeal(s, "tuesday", "dinner");

  const lundiAprès = s.days.find((d) => d.day === "monday")!;
  assert.equal(lundiAprès.dailyCalories, lundiAvant.dailyCalories);
  assert.equal(lundiAprès.proteinBp, lundiAvant.proteinBp);
  assert.equal(lundiAprès.meals.length, 1, "le repas de lundi n'a pas bougé");
  assert.deepEqual(
    lundiAprès.slots.map((a) => a.enabled),
    lundiAvant.slots.map((a) => a.enabled),
  );
  assert.equal(s.days.find((d) => d.day === "tuesday")!.dailyCalories, 2600);

  // Duplication vers PLUSIEURS jours, puis application à toute la semaine.
  s = duplicateDay(s, "tuesday", ["wednesday", "friday"]);
  for (const jour of ["wednesday", "friday"] as const) {
    assert.equal(s.days.find((d) => d.day === jour)!.dailyCalories, 2600);
  }
  assert.equal(s.days.find((d) => d.day === "thursday")!.dailyCalories, 2000, "jeudi n'était pas ciblé");

  s = applyDayToWholeWeek(s, "tuesday");
  assert.ok(s.days.every((d) => d.dailyCalories === 2600));
  // Les repas dupliqués ont tous des identifiants distincts.
  const ids = s.days.flatMap((d) => d.meals.map((m) => m.id));
  assert.equal(new Set(ids).size, ids.length, "aucun identifiant de repas partagé");

  // Réinitialiser un jour ne touche que lui.
  s = resetDay(s, "sunday");
  assert.equal(s.days.find((d) => d.day === "sunday")!.dailyCalories, 0);
  assert.equal(s.days.find((d) => d.day === "sunday")!.meals.length, 0);
  assert.equal(s.days.find((d) => d.day === "saturday")!.dailyCalories, 2600);
});

await test("30. sept clés de profil INTERNES, automatiques et conformes à la base", () => {
  // RÉÉCRIT. Le contrôle vérifiait le format d'une clé SAISIE par le coach.
  // Plus aucune clé n'est saisie : elles sont dérivées du jour.
  assert.equal(DAY_PROFILE_KEYS.length, 7);
  assert.equal(new Set(DAY_PROFILE_KEYS).size, 7, "aucun doublon possible");
  assert.deepEqual(DAY_PROFILE_KEYS, WEEKDAY_KEYS.map((j) => `day_${j}`));
  assert.equal(MAIN_DAY_PROFILE_KEY, "day_monday");

  // Miroir EXACT de la contrainte CHECK de la base.
  const format = /^[a-z][a-z0-9_]{0,31}$/;
  for (const clé of DAY_PROFILE_KEYS) {
    assert.ok(format.test(clé), `clé refusée par la base : ${clé}`);
  }
  assert.ok(sansCommentairesSql(M_SAUVEGARDE).includes("^[a-z][a-z0-9_]{0,31}$"));

  // Elles n'apparaissent nulle part dans l'interface.
  for (const [nom, code] of [
    ["constructeur", CONSTRUCTEUR],
    ["panneau de semaine", PANNEAU_SEMAINE],
    ["objectifs du jour", JOUR_OBJECTIFS],
    ["répartition du jour", JOUR_REPARTITION],
    ["repas du jour", JOUR_REPAS],
    ["onglets de jour", JOUR_ONGLETS],
  ] as const) {
    const texte = sansCommentairesTs(code);
    for (const interdit of ["day_monday", "profile_key", "profileKey", "legacy_default"]) {
      assert.ok(!texte.includes(interdit), `${nom} ne doit pas mentionner ${interdit}`);
    }
  }
});

await test("31. les aliments font l'aller-retour texte ↔ objets sans perte", () => {
  const texte = "Blanc de poulet — 150 g\nRiz basmati — 100 g cru\nHaricots verts";
  const items = textToItems(texte);
  assert.deepEqual([...items], [
    { name: "Blanc de poulet", quantity: "150 g" },
    { name: "Riz basmati", quantity: "100 g cru" },
    { name: "Haricots verts", quantity: "" },
  ]);
  assert.equal(itemsToText(items), texte);
  // L'ancienne forme « Nom - quantité » reste lisible.
  assert.deepEqual([...textToItems("Riz - 100 g")], [{ name: "Riz", quantity: "100 g" }]);
});

await test("32. le total hebdomadaire est la SOMME des sept jours, jamais un produit", () => {
  let s = createBlankWeek();
  assert.equal(weeklyCaloriesFromForm(s), 0);

  s = initializeAllDays(s, { dailyCalories: 2000, proteinBp: 3000, carbBp: 4500, fatBp: 2500 });
  assert.equal(weeklyCaloriesFromForm(s), 14000);

  s = setDayCalories(s, "tuesday", 2200);
  s = setDayCalories(s, "thursday", 2200);
  assert.equal(weeklyCaloriesFromForm(s), 2000 * 5 + 2200 * 2);

  s = setDayCalories(s, "sunday", 1500);
  assert.equal(weeklyCaloriesFromForm(s), 2000 * 4 + 2200 * 2 + 1500);
  // Et surtout : ce n'est pas « calories du jour ouvert × 7 ».
  assert.notEqual(weeklyCaloriesFromForm(s), mainDayTargets(s).dailyCalories * 7);
});

await test("33. la charge utile porte SEPT profils internes et SEPT jours", () => {
  let s = createBlankWeek();
  s = initializeAllDays(s, { dailyCalories: 2000, proteinBp: 2800, carbBp: 4400, fatBp: 2800 });
  s = setDayCalories(s, "sunday", 1900);
  s = addMeal(s, "monday", "dinner");
  s = addMeal(s, "monday", "breakfast");

  const payload = toWeekSavePayload(s) as {
    days: { day: string; profile_key: string; meals: { slot: string; id: string | null }[] }[];
    profiles: { profile_key: string; daily_calories: number; slots: unknown[] }[];
    main_profile_key: string;
  };

  assert.equal(payload.days.length, 7);
  assert.equal(payload.profiles.length, 7, "un profil interne par jour");
  assert.deepEqual(payload.days.map((d) => d.day), [...WEEKDAY_KEYS]);
  assert.deepEqual(payload.profiles.map((p) => p.profile_key), [...DAY_PROFILE_KEYS]);
  assert.equal(payload.main_profile_key, MAIN_DAY_PROFILE_KEY);
  assert.ok(payload.profiles.every((p) => p.slots.length === 6), "six créneaux par profil");

  // Chaque jour désigne SON profil : aucun partage, donc aucune contagion.
  for (const jour of payload.days) {
    assert.equal(jour.profile_key, internalProfileKeyForDay(jour.day as (typeof WEEKDAY_KEYS)[number]));
  }
  assert.equal(payload.profiles.find((p) => p.profile_key === "day_sunday")!.daily_calories, 1900);

  // Les repas sont triés par créneau.
  const lundi = payload.days.find((d) => d.day === "monday")!;
  assert.deepEqual(lundi.meals.map((m) => m.slot), ["breakfast", "dinner"]);
  // Un identifiant LOCAL non-UUID est laissé à la base ; un UUID généré par
  // le client est conservé, ce qui préserve l'identité du repas entre deux
  // enregistrements.
  for (const repas of lundi.meals) {
    assert.ok(
      repas.id === null || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(repas.id),
      `identifiant transmis : ${String(repas.id)}`,
    );
  }
  const localFactice = toWeekSavePayload({
    ...s,
    days: s.days.map((d) => (d.day === "monday" ? { ...d, meals: [{ ...d.meals[0], id: "nouveau:monday" }] } : d)),
  }) as { days: { day: string; meals: { id: string | null }[] }[] };
  assert.equal(
    localFactice.days.find((d) => d.day === "monday")!.meals[0].id,
    null,
    "un identifiant non-UUID n'est jamais envoyé",
  );
});

await test("34. la charge utile RPC transporte la semaine sans la déformer", () => {
  const payload = buildSaveNutritionPlanV2Payload({
    planId: "plan-1",
    name: "Plan unifié",
    dailyCalories: 2000,
    proteinBp: 2800,
    carbBp: 4400,
    fatBp: 2800,
    slots: CRENEAUX_STANDARD,
    week: { profiles: [{ profile_key: "standard" }], days: [{ day: "monday" }], main_profile_key: "standard" },
  }) as Record<string, unknown>;

  assert.ok(Array.isArray(payload.profiles), "profiles est transmis");
  assert.ok(Array.isArray(payload.days), "days est transmis");
  assert.equal(payload.main_profile_key, "standard");
  // La forme historique reste présente : les appelants et tests existants
  // continuent de décrire la même charge utile.
  assert.ok(payload.profile && payload.slots);

  // Sans semaine, aucune clé `days` : la RPC ne touche alors pas aux jours.
  const sansSemaine = buildSaveNutritionPlanV2Payload({
    planId: "plan-1", name: "x", dailyCalories: 2000,
    proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD,
  }) as Record<string, unknown>;
  assert.ok(!("days" in sansSemaine));
  assert.ok(!("profiles" in sansSemaine));
});

await test("35. les repas sont rendus dans un ordre stable", () => {
  const repas = [
    { id: "c", slot: "dinner" as const, name: "B", items: [], calories: 0, protein: 0, carbs: 0, fat: 0, coachNotes: "" },
    { id: "a", slot: "breakfast" as const, name: "Z", items: [], calories: 0, protein: 0, carbs: 0, fat: 0, coachNotes: "" },
    { id: "b", slot: "dinner" as const, name: "A", items: [], calories: 0, protein: 0, carbs: 0, fat: 0, coachNotes: "" },
  ];
  assert.deepEqual(orderedMeals(repas).map((m) => m.id), ["a", "b", "c"]);
});

await test("36. completeWeek ne fabrique QUE les jours manquants", () => {
  const semaine = semaineFactice();
  const partielle = semaine.days.slice(0, 3);
  const complète = completeWeek(partielle, "standard");
  assert.equal(complète.length, 7);
  // Les trois jours existants sont les mêmes objets, pas des copies vides.
  assert.equal(complète[0], partielle[0]);
  assert.equal(complète[6].profileKey, "standard");
});

/* ═══════════ 8. Le modèle v1 a disparu ═══════════ */

await test("37. aucun écran ne choisit plus entre v1 et v2", () => {
  for (const [nom, source] of Object.entries({ PAGE_NOUVEAU, PAGE_ADMIN_PLAN, PAGE_ELEVE_DETAIL })) {
    const code = sansCommentairesTs(source);
    assert.ok(!code.includes("NutritionPlanBuilder"), `${nom} n'importe plus le constructeur v1`);
    assert.ok(!/mode === "classique"/.test(code), `${nom} n'a plus de mode classique`);
  }
  const code = sansCommentairesTs(PAGE_ELEVE_DETAIL);
  assert.ok(
    !/nutritionModelVersion/.test(code),
    "l'écran élève ne branche plus son rendu sur la version",
  );
});

await test("38. la base interdit désormais toute autre valeur que 2", () => {
  const sql = sansCommentairesSql(M_UNIFICATION);
  assert.ok(sql.includes("check (nutrition_model_version = 2)"));
  assert.ok(sql.includes("alter column nutrition_model_version set default 2"));
  assert.ok(sql.includes("update public.nutrition_plans\n   set nutrition_model_version = 2"));
});

await test("39. nutrition_days et meals sont CONSERVÉES, jamais supprimées", () => {
  for (const [nom, sql] of Object.entries({ M_UNIFICATION, M_DURCISSEMENT, M_SAUVEGARDE, M_RECETTES })) {
    const corps = sansCommentairesSql(sql);
    for (const interdit of ["drop table", "truncate table", "truncate public."]) {
      assert.ok(!corps.toLowerCase().includes(interdit), `${nom} ne contient pas « ${interdit} »`);
    }
  }
  assert.ok(M_UNIFICATION.includes("nutrition_days"), "la migration les fait évoluer, pas disparaître");
});

/* ═══════════ 9. Sécurité — le miroir applicatif des policies ═══════════ */

await test("40. la chaîne d'autorisation passe par le PLAN, jamais par students.coach_id", () => {
  const sql = sansCommentairesSql(M_RECETTES);
  assert.ok(sql.includes("p.student_id = public.current_student_id()"));
  assert.ok(sql.includes("p.coach_id = nutrition_recipes.coach_id"));
  assert.ok(sql.includes("p.coach_id is not null"));
  assert.ok(
    !/students\.coach_id/.test(sql),
    "students.coach_id n'apparaît dans AUCUNE policy de recette",
  );
});

await test("41. les trois policies élève ré-expriment la chaîne ENTIÈRE", () => {
  const sql = sansCommentairesSql(M_RECETTES);
  for (const table of ["nutrition_recipes", "nutrition_recipe_ingredients", "nutrition_recipe_tags"]) {
    assert.ok(sql.includes(`${table}_select_student`), `policy élève sur ${table}`);
  }
  // Chaque enfant vérifie le statut ET le coach — pas seulement le parent.
  const morceaux = sql.split("create policy").filter((b) => b.includes("_select_student"));
  assert.equal(morceaux.length, 3);
  for (const bloc of morceaux) {
    assert.ok(bloc.includes("status = 'active'"), "statut vérifié");
    assert.ok(bloc.includes("current_student_id()"), "élève vérifié");
    assert.ok(bloc.includes("coach_id"), "coach vérifié");
  }
});

await test("42. le coach ne gère que ses recettes, l'administrateur gère tout", () => {
  const sql = sansCommentairesSql(M_RECETTES);
  assert.ok(sql.includes("current_coach_id()"));
  assert.ok(sql.includes("nutrition_recipes_manage_admin"));
  assert.ok(sql.includes("nutrition_recipes_manage_own_coach"));
  assert.ok(
    sql.includes('drop policy if exists "nutrition_recipes_manage_staff"'),
    "l'ancienne policy « tout le staff » est retirée",
  );
  // La fonction d'identité coach est déterministe.
  assert.ok(sql.includes("order by c.created_at, c.id"));
  assert.ok(sql.includes("limit 1"));
});

await test("43. le durcissement retire TRUNCATE sans casser l'outil 1", () => {
  const sql = sansCommentairesSql(M_DURCISSEMENT);
  assert.ok(sql.includes("revoke all on table public.%I from authenticated"));
  assert.ok(sql.includes("grant select, insert, update, delete on table public.%I to authenticated"));
  assert.ok(sql.includes("nutrition_daily_logs"), "la table du suivi reste accessible en écriture");
  assert.ok(sql.includes("protect_students_ownership"));
  assert.ok(sql.includes("protect_nutrition_days_coach_columns"));
  // Les colonnes protégées de students.
  for (const colonne of ["coach_id", "access_type", "status", "user_id"]) {
    assert.ok(sql.includes(`new.${colonne} := old.${colonne}`), `students.${colonne} protégée`);
  }
});

/* ═══════════ 10. Interface ═══════════ */

await test("44. l'entrée Nutrition reste active sur /nutrition/[planId]", () => {
  assert.equal(isStudentRouteActive("/nutrition", "/nutrition"), true);
  assert.equal(isStudentRouteActive("/nutrition/abc-123", "/nutrition"), true);
  assert.equal(isStudentRouteActive("/nutritionnisme", "/nutrition"), false,
    "le préfixe est comparé segment par segment");
  assert.equal(isStudentRouteActive("/entrainement", "/nutrition"), false);
  assert.equal(isStudentRouteActive(null, "/nutrition"), false);
});

await test("45. les TROIS outils restent séparés, les recettes ayant leur écran", () => {
  // MIS À JOUR. Les outils 1 et 2 restent sur la fiche du plan ; les recettes
  // adaptatives ont désormais leur PROPRE parcours,
  // /nutrition/[planId]/recettes, atteint depuis un bouton mis en avant. La
  // séparation des trois outils est donc plus nette qu'avant, pas moins.
  for (const titre of ["Suivi de la semaine", "Semaine alimentaire"]) {
    assert.ok(PAGE_ELEVE_DETAIL.includes(titre), `section « ${titre} »`);
  }
  assert.ok(PAGE_ELEVE_DETAIL.includes("WeeklyNutritionTracker"), "l'outil 1 est réutilisé tel quel");
  assert.ok(PAGE_ELEVE_DETAIL.includes("StudentPrescribedWeek"));
  // Les recettes ne sont plus montées sur la fiche…
  assert.ok(
    !sansCommentairesTs(PAGE_ELEVE_DETAIL).includes("StudentAdaptiveRecipes"),
    "l'outil 2 a quitté la fiche du plan",
  );
  // …mais sur leur page, INCHANGÉ : même composant, même hook, même solveur.
  assert.ok(PAGE_RECETTES.includes("<StudentAdaptiveRecipes"), "l'outil 2 est monté sur son écran");
  assert.ok(PAGE_RECETTES.includes("useStudentNutritionPlanV2"), "mêmes données qu'avant");
  assert.ok(PAGE_RECETTES.includes("Choisis un jour puis un créneau"), "même parcours jour → créneau");
  assert.ok(!sansCommentairesTs(PAGE_RECETTES).includes(".from("), "toujours aucune écriture");
});

await test("45 bis. l'entrée « Recettes » est mise en avant, en haut, une seule fois", () => {
  // Le bouton mène à la page dédiée depuis les DEUX écrans de nutrition.
  for (const [nom, page] of [["liste", PAGE_ELEVE_LISTE], ["fiche", PAGE_ELEVE_DETAIL]] as const) {
    assert.ok(page.includes("<RecipesHighlightLink"), `${nom} : le bouton est monté`);
    assert.equal(
      (page.match(/<RecipesHighlightLink/g) ?? []).length,
      1,
      `${nom} : une seule mise en avant — répétée, elle n'en serait plus une`,
    );
  }
  // Il est placé AVANT le suivi de la semaine : visible sans défiler.
  assert.ok(
    PAGE_ELEVE_LISTE.indexOf("<RecipesHighlightLink") < PAGE_ELEVE_LISTE.indexOf("<WeeklyNutritionTracker"),
    "le bouton précède le suivi",
  );

  // Surbrillance verte prise au thème, jamais codée en dur.
  const bouton = lire("../../components/student/RecipesHighlightLink.tsx");
  assert.ok(bouton.includes("border-success/50") && bouton.includes("bg-success/10"));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(bouton), "aucune couleur codée en dur");
  assert.ok(bouton.includes("recettes-halo"), "le filet lumineux est appliqué");
  assert.ok(bouton.includes('href={`/nutrition/${planId}/recettes`}'), "il mène au parcours dédié");
  assert.ok(bouton.includes("min-h-[44px]"), "cible tactile suffisante");

  // Le rayon tourne, et il S'IMMOBILISE sous prefers-reduced-motion — il ne
  // disparaît pas : la mise en avant reste, seul le mouvement s'arrête.
  const styles = lire("../../app/globals.css");
  const halo = styles.slice(styles.indexOf("@property --recettes-halo-angle"));
  assert.ok(halo.includes("conic-gradient"), "le rayon est un dégradé conique masqué en bordure");
  assert.ok(halo.includes("animation: recettes-halo-tour"));
  assert.ok(halo.includes("@keyframes recettes-halo-tour"));
  assert.ok(halo.includes("prefers-reduced-motion: reduce"), "le mouvement est réductible");
  const repli = halo.slice(halo.indexOf("prefers-reduced-motion"));
  assert.ok(repli.includes("animation: none"), "l'animation s'arrête");
  assert.ok(repli.includes("--recettes-halo-angle: 118deg"), "mais le liseré reste visible, figé");
  assert.ok(halo.includes("var(--success)"), "la couleur vient du thème");
});

await test("46. la semaine prescrite est en LECTURE SEULE côté élève", () => {
  const code = sansCommentairesTs(SEMAINE_ELEVE);
  assert.ok(!/<input|<textarea|<select/.test(code), "aucun champ de saisie");
  assert.ok(!/onChange|onSubmit/.test(code), "aucun callback de modification");
  assert.ok(!code.includes("@/lib/supabase"), "aucune écriture possible");
  assert.ok(!code.includes("solveRecipe"), "l'outil 3 n'utilise jamais le solveur");
});

await test("47. une erreur réseau n'est plus présentée comme « aucun plan »", () => {
  assert.ok(PAGE_ELEVE_DETAIL.includes("ÉtatErreur"), "un état d'erreur existe");
  assert.ok(PAGE_ELEVE_DETAIL.includes("Réessayer"), "avec une action de reprise");
  const hook = sansCommentairesTs(HOOK_ELEVE);
  assert.ok(hook.includes("catch"), "l'échec est capturé");
  assert.ok(hook.includes("setError"), "et distingué du vide");
  assert.ok(!/setLoading\(true\)/.test(hook), "le rechargement est silencieux");
});

await test("48. la carte de repas ne demande QUE ce que le jour ne définit pas", () => {
  // MIS À JOUR DEUX FOIS. D'abord par la refonte « semaine d'abord » : la
  // carte a quitté le panneau de semaine pour `NutritionDayManualMeals`, et a
  // perdu la ligne « Profil du jour » qui la surplombait. Puis par le retrait
  // des kcal et des macros par repas : le jour ouvert les définit déjà, deux
  // zones plus haut. Les redemander ici invitait le coach à se contredire.
  const code = sansCommentairesTs(JOUR_REPAS);
  for (const champ of ["Moment", "Nom du repas", "Aliments", "Notes coach"]) {
    assert.ok(code.includes(champ), `champ « ${champ} » conservé`);
  }
  for (const retiré of ["Kcal", "Prot (g)", "Gluc (g)", "Lip (g)"]) {
    assert.ok(!code.includes(retiré), `« ${retiré} » ne doit plus être saisi par repas`);
  }
  assert.ok(code.includes("Ajouter un repas"));
  assert.ok(!code.includes("Profil du jour"), "plus aucun sélecteur de profil");
  assert.ok(PANNEAU_SEMAINE.includes("Dupliquer"));
  for (const source of [PANNEAU_SEMAINE, JOUR_REPAS]) {
    assert.ok(!sansCommentairesTs(source).includes("solveRecipe"), "l'outil 3 reste entièrement manuel");
  }

  // Le MODÈLE, lui, est intact : un repas déjà enregistré garde ses valeurs,
  // et elles continuent de partir dans la charge utile. Rien à migrer.
  const forme = sansCommentairesTs(SEMAINE_FORM);
  for (const champ of ["calories", "protein", "carbs", "fat"]) {
    assert.ok(forme.includes(`${champ}:`), `le modèle conserve ${champ}`);
  }
  // Et l'écran élève ne montre pas des zéros : il DÉRIVE les kcal et les
  // macros de chaque repas depuis la part de son créneau, un repas saisi
  // avant ce changement gardant ses propres valeurs.
  const eleve = sansCommentairesTs(SEMAINE_ELEVE);
  assert.ok(eleve.includes("slotMacrosForDay(week, jour, repas.slot)"), "la part du créneau est appliquée");
  assert.ok(eleve.includes("saisiParLeCoach"), "les valeurs héritées priment quand elles existent");
});

await test("49. responsive et accessibilité : cibles tactiles et repli en cartes", () => {
  // La semaine prescrite est en lecture seule : elle n'a aucun élément
  // interactif, donc aucune cible tactile à dimensionner.
  for (const [nom, source] of Object.entries({ RECETTES_ELEVE, PANNEAU_SEMAINE })) {
    assert.ok(/min-h-11|min-h-\[44px\]/.test(source), `${nom} : cibles tactiles`);
  }
  for (const [nom, source] of Object.entries({ RECETTES_ELEVE, SEMAINE_ELEVE, PANNEAU_SEMAINE })) {
    assert.ok(!/#[0-9a-fA-F]{6}|bg-white|text-black/.test(source), `${nom} : aucune couleur en dur`);
  }
  // Le tableau des quantités a un repli en cartes ET reste atteignable au clavier.
  assert.ok(RECETTES_ELEVE.includes("md:hidden"), "cartes sous md");
  assert.ok(RECETTES_ELEVE.includes("hidden overflow-x-auto md:block"), "tableau au-dessus");
  assert.ok(RECETTES_ELEVE.includes("tabIndex={0}"), "zone défilante focalisable");
});

await test("50. la checklist PostgreSQL couvre le périmètre exigé", () => {
  for (const attendu of [
    "rollback;",
    "nutrition_v2_backfill_plan",
    "nutrition_v2_normalize_vocabulary",
    "save_nutrition_plan_v2",
    "current_coach_id",
    "TRUNCATE",
    "protect_students_ownership",
    "nutrition_daily_logs",
    "UNKNOWN_PROFILE_FOR_DAY",
    // Section I — cycle de vie (PR D)
    "delete_nutrition_plan(",
    "delete_nutrition_recipe(",
    "nutrition_lifecycle_overview()",
    "0 élève + des journées de suivi : la suppression est AUTORISÉE",
    "les journées liées sont parties avec le plan",
    "I22.",
    // Section K — le propriétaire d'un plan (correctif du risque nº1)
    "nutrition_plans_fill_coach_id",
    "voit ENFIN la recette de son coach",
    "la réassignation répare le plan",
    // Section L — la bascule 20260815 → 20260817
    "APRÈS 20260817 : 0 élève + 2 journées → suppression AUTORISÉE",
    "APRÈS 20260815 : 0 élève + historique → suppression BLOQUÉE",
  ]) {
    assert.ok(CHECKLIST.includes(attendu), `la checklist doit couvrir : ${attendu}`);
  }
  assert.ok(/^rollback;$/m.test(CHECKLIST));
  assert.ok(CHECKLIST.indexOf("begin;") < CHECKLIST.indexOf("\nrollback;"));
});

await test("51. les quatre migrations sont déclarées au manifeste et comptées", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 24);
  for (const nom of [
    "20260810090000_harden_nutrition_privileges.sql",
    "20260811090000_nutrition_v2_unification.sql",
    "20260812090000_save_nutrition_plan_v2_full.sql",
    "20260813090000_student_recipe_read_access.sql",
  ]) {
    assert.ok(attendues.includes(nom), nom);
  }
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 51,"), "le compteur de migrations suit les migrations réelles");
  assert.ok(secu.includes("assert.equal(attendues.length, 24);"));
});

/* ─── 52-53. Outils 1 et 3 après la PR C.1 ─────────────────────────────── */

await test("52. Outil 1 (nutrition_daily_logs) est resté strictement intact", async () => {
  // La suppression du chemin d'écriture v1 ne devait toucher en RIEN la
  // saisie quotidienne de l'élève : même couche, mêmes exports, et toujours
  // un seul module autorisé à y écrire.
  const logs = await import("../../lib/supabase/nutrition-logs");
  assert.deepEqual(
    Object.keys(logs).sort(),
    ["getLatestNutritionLog", "getNutritionLogsForDates", "upsertNutritionDailyLog"],
    "la surface de l'Outil 1 ne doit pas bouger",
  );

  const couche = lire("../../lib/supabase/nutrition-logs.ts");
  assert.ok(couche.includes("upsert("), "l'écriture quotidienne reste un upsert");
  assert.ok(couche.includes("protein_g") && couche.includes("carbs_g") && couche.includes("fat_g"));

  // Aucune écriture ailleurs : progress.ts et delete-student.ts ne font que
  // lire ou supprimer un compte entier.
  const progression = sansCommentairesTs(lire("../../lib/supabase/progress.ts"));
  const indice = progression.indexOf(`from("nutrition_daily_logs")`);
  assert.ok(indice > 0);
  assert.ok(
    /^\s*\.select\(/m.test(progression.slice(indice, indice + 200)),
    "progress.ts ne fait que lire nutrition_daily_logs",
  );

  // Et la couche des plans ne l'a jamais touché — elle ne commence pas.
  const plans = sansCommentairesTs(lire("../../lib/supabase/nutrition.ts"));
  assert.ok(!plans.includes("nutrition_daily_logs"), "la couche plan ne touche pas à l'Outil 1");
});

await test("53. Outil 3 (journées + repas prescrits) n'est écrit que par la RPC v2", () => {
  const rpc = lire("../../supabase/migrations/20260812090000_save_nutrition_plan_v2_full.sql");
  // La seule insertion de journée du dépôt porte profile_key, et la valeur
  // vient du payload ou du profil principal déterministe — jamais d'un
  // littéral arbitraire.
  assert.ok(rpc.includes("insert into public.nutrition_days (plan_id, day, status, target, profile_key)"));
  assert.ok(rpc.includes("v_profile_key := coalesce(nullif(v_day->>'profile_key', ''), v_main_profile_key);"));
  assert.ok(rpc.includes("insert into public.meals ("));
  // Un profil inconnu est refusé AVANT toute écriture.
  assert.ok(rpc.includes("UNKNOWN_PROFILE_FOR_DAY"));

  // Côté TypeScript, le payload hebdomadaire part bien vers cette RPC.
  const couche = lire("../../lib/supabase/nutrition-v2.ts");
  assert.ok(couche.includes(`rpc("save_nutrition_plan_v2"`));
  assert.ok(couche.includes("week"), "le volet hebdomadaire est transmis dans le payload");

  // Et la couche historique n'a plus aucune écriture de structure.
  const plans = sansCommentairesTs(lire("../../lib/supabase/nutrition.ts"));
  const écritureDirecte = /\.from\(\s*["'](nutrition_days|meals)["']\s*\)[\s\S]{0,80}?\.(insert|upsert|delete|update)\(/;
  assert.ok(!écritureDirecte.test(plans), "écriture directe de structure réintroduite");
});

/* ═══════════ 12. La refonte « semaine d'abord » ═══════════ */

await test("54. les curseurs P/G/L sont SOLIDAIRES : le total ne quitte jamais 100 %", () => {
  // Le cœur de la simplification : le coach n'a plus à faire l'appoint.
  let s = createBlankWeek();
  s = setDayMacroBp(s, "monday", "protein", 3000);
  const après = (jour = "monday") => s.days.find((d) => d.day === jour)!;
  assert.equal(après().proteinBp + après().carbBp + après().fatBp, BASIS_POINTS_TOTAL);
  assert.equal(après().proteinBp, 3000);

  // Depuis un état à zéro, le reste part à parts ÉGALES.
  assert.equal(après().carbBp, 3500);
  assert.equal(après().fatBp, 3500);

  // Puis proportionnellement à ce qui existe.
  s = setDayMacroBp(s, "monday", "fat", 2000);
  assert.equal(après().fatBp, 2000);
  assert.equal(après().proteinBp + après().carbBp + après().fatBp, BASIS_POINTS_TOTAL);

  // Balayage exhaustif : aucune combinaison ne casse l'invariant, et toutes
  // les valeurs restent des entiers.
  for (const macro of ["protein", "carb", "fat"] as const) {
    for (let pourcent = 0; pourcent <= 100; pourcent += 1) {
      const t = setDayMacroBp(s, "monday", macro, pourcent * 100);
      const j = t.days.find((d) => d.day === "monday")!;
      assert.equal(j.proteinBp + j.carbBp + j.fatBp, BASIS_POINTS_TOTAL, `${macro} à ${pourcent} %`);
      for (const v of [j.proteinBp, j.carbBp, j.fatBp]) {
        assert.ok(Number.isInteger(v) && v >= 0 && v <= BASIS_POINTS_TOTAL, `valeur hors domaine : ${v}`);
      }
    }
  }

  // Une demande hors bornes est ramenée au disponible, pas refusée : un
  // curseur ne peut physiquement pas demander plus.
  const saturé = rebalanceDailyMacros({ proteinBp: 0, carbBp: 0, fatBp: 0 }, "protein", 99_999);
  assert.equal(saturé.proteinBp, BASIS_POINTS_TOTAL);
  assert.equal(saturé.carbBp + saturé.fatBp, 0);

  // Une entrée figée est préservée au point de base près.
  const avecVerrou = rebalanceToTotal(
    [
      { key: "a", bp: 2000, adjustable: false },
      { key: "b", bp: 4000, adjustable: true },
      { key: "c", bp: 4000, adjustable: true },
    ],
    "b",
    7000,
  );
  assert.equal(avecVerrou.find((e) => e.key === "a")!.bp, 2000, "le verrou est intact");
  assert.equal(avecVerrou.reduce((t, e) => t + e.bp, 0), BASIS_POINTS_TOTAL);
});

await test("55. l'initialisation remplit les sept jours puis s'efface", () => {
  let s = initializeAllDays(createBlankWeek(), {
    dailyCalories: 2300,
    proteinBp: 3000,
    carbBp: 4200,
    fatBp: 2800,
  });
  assert.ok(s.days.every((d) => d.dailyCalories === 2300));
  assert.ok(s.days.every((d) => d.proteinBp === 3000 && d.carbBp === 4200 && d.fatBp === 2800));
  // Les créneaux actifs sont répartis, donc les sept jours sont utilisables
  // immédiatement : chaque macro totalise 100 % sur les créneaux.
  for (const jour of s.days) {
    for (const macro of ["proteinBp", "carbBp", "fatBp"] as const) {
      const total = jour.slots.filter((a) => a.enabled).reduce((t, a) => t + a[macro], 0);
      assert.equal(total, BASIS_POINTS_TOTAL, `${jour.day}/${macro}`);
    }
  }

  // APRÈS l'initialisation, chaque jour est indépendant : ce n'est pas une
  // seconde source de vérité.
  s = setDayCalories(s, "wednesday", 1800);
  assert.equal(s.days.find((d) => d.day === "wednesday")!.dailyCalories, 1800);
  assert.ok(
    s.days.filter((d) => d.day !== "wednesday").every((d) => d.dailyCalories === 2300),
    "les six autres jours n'ont pas bougé",
  );

  // Les repas déjà saisis survivent à une réinitialisation des objectifs.
  let t = addMeal(createBlankWeek(), "friday", "dinner");
  t = updateMeal(t, "friday", t.days.find((d) => d.day === "friday")!.meals[0].id, { name: "Saumon" });
  t = initializeAllDays(t, { dailyCalories: 2000, proteinBp: 3000, carbBp: 4500, fatBp: 2500 });
  assert.equal(t.days.find((d) => d.day === "friday")!.meals[0].name, "Saumon");
});

await test("56. la reprise d'un plan existant rend les jours indépendants sans rien perdre", () => {
  // Deux jours partagent le profil `default` en base — cas le plus courant.
  const repasLundi = {
    id: "11111111-1111-4111-8111-111111111111",
    slot: "lunch" as const,
    name: "Poulet riz",
    items: [{ name: "Riz", quantity: "100 g" }],
    calories: 600,
    protein: 40,
    carbs: 70,
    fat: 12,
    coachNotes: "Peser cru.",
  };
  const profil = {
    profileKey: "default",
    dailyCalories: 2100,
    proteinBp: 3000,
    carbBp: 4500,
    fatBp: 2500,
    slots: CRENEAUX_STANDARD,
  };
  const semaineBase: PlanV2Week = {
    planId: "plan-1",
    profiles: [profil],
    days: WEEKDAY_KEYS.map((jour) => ({
      id: `jour-${jour}`,
      day: jour,
      profileKey: "default",
      status: "non-commence",
      meals: jour === "monday" ? [repasLundi] : [],
    })),
  };

  let s = createWeekFormFromPlan(semaineBase);
  // 1. Les valeurs du profil sont reprises telles quelles, dans CHAQUE jour.
  assert.ok(s.days.every((d) => d.dailyCalories === 2100 && d.proteinBp === 3000));
  // 2. Les identifiants de journée et les repas sont conservés.
  assert.equal(s.days.find((d) => d.day === "monday")!.id, "jour-monday");
  assert.equal(s.days.find((d) => d.day === "monday")!.meals[0].coachNotes, "Peser cru.");
  // 3. Le profil d'origine est mémorisé, mais jamais affiché.
  assert.equal(s.days.find((d) => d.day === "monday")!.sourceProfileKey, "default");

  // 4. Modifier mardi ne bouge pas lundi, alors qu'ils partageaient le profil.
  s = setDayCalories(s, "tuesday", 2600);
  assert.equal(s.days.find((d) => d.day === "monday")!.dailyCalories, 2100);
  assert.equal(s.days.find((d) => d.day === "tuesday")!.dailyCalories, 2600);

  // 5. À la sauvegarde, la normalisation vers les clés internes est complète,
  //    et le repas existant garde son UUID — donc il est mis à jour, pas
  //    dupliqué.
  const payload = toWeekSavePayload(s) as {
    profiles: { profile_key: string; daily_calories: number }[];
    days: { day: string; profile_key: string; meals: { id: string | null; coach_notes: string }[] }[];
  };
  assert.deepEqual(payload.profiles.map((p) => p.profile_key), [...DAY_PROFILE_KEYS]);
  assert.equal(payload.profiles.find((p) => p.profile_key === "day_tuesday")!.daily_calories, 2600);
  assert.equal(payload.profiles.find((p) => p.profile_key === "day_monday")!.daily_calories, 2100);
  const lundi = payload.days.find((d) => d.day === "monday")!;
  assert.equal(lundi.meals[0].id, repasLundi.id, "le repas existant est mis à jour, pas recréé");
  assert.equal(lundi.meals[0].coach_notes, "Peser cru.");
});

await test("57. l'interface ne parle plus JAMAIS de profil", () => {
  const interdits = [
    "Profils de la semaine",
    "Profil du jour",
    "Clé du nouveau profil",
    "Ajouter un profil",
    "profil principal",
    "profil additionnel",
    "legacy_default",
    "profile_key",
  ];
  // On assertionne le CODE, pas la prose : le commentaire d'en-tête du
  // constructeur DOCUMENTE ce qui a été supprimé, il ne doit pas déclencher
  // l'interdiction qu'il explique.
  for (const [nom, code] of [
    ["constructeur", CONSTRUCTEUR],
    ["panneau de semaine", PANNEAU_SEMAINE],
    ["objectifs du jour", JOUR_OBJECTIFS],
    ["répartition du jour", JOUR_REPARTITION],
    ["repas du jour", JOUR_REPAS],
    ["onglets de jour", JOUR_ONGLETS],
  ] as const) {
    const texte = sansCommentairesTs(code);
    for (const interdit of interdits) {
      assert.ok(!texte.includes(interdit), `${nom} contient encore « ${interdit} »`);
    }
  }
  // Les panneaux supprimés ne sont pas simplement masqués : ils ont disparu.
  const constructeur = sansCommentairesTs(CONSTRUCTEUR);
  for (const supprimé of ["Objectif quotidien", "Récapitulatif", "Repas proposés"]) {
    assert.ok(!constructeur.includes(supprimé), `« ${supprimé} » subsiste dans le constructeur`);
  }
  // Et l'action d'initialisation, elle, existe bien.
  assert.ok(constructeur.includes("Initialiser les sept jours"));
});

await test("58. un SEUL panneau à onglets remplace les trois listes P/G/L", () => {
  // Le constructeur ne rend plus trois panneaux successifs.
  const code = sansCommentairesTs(CONSTRUCTEUR);
  assert.ok(
    !/MACRO_KEYS\.map\([\s\S]{0,120}NutritionMacroDistributionPanel/.test(code),
    "les trois panneaux successifs ont disparu du constructeur",
  );
  // Ils vivent dans un panneau unique, à trois onglets, dont un seul est rendu.
  assert.ok(JOUR_REPARTITION.includes('role="tablist"'));
  assert.equal(
    (JOUR_REPARTITION.match(/<NutritionMacroDistributionPanel/g) ?? []).length,
    1,
    "une seule liste est rendue à la fois",
  );
  assert.ok(JOUR_REPARTITION.includes("macroActive"));

  // MIS À JOUR : les curseurs de créneau sont devenus solidaires, eux aussi.
  // Trois affichages ont donc disparu du panneau — ils décrivaient un reste
  // qui ne peut plus exister. On assertionne le CODE, pas la prose : le
  // commentaire qui documente leur suppression ne doit pas la déclencher.
  const panneau = sansCommentairesTs(lire("../../components/admin/NutritionMacroDistributionPanel.tsx"));
  for (const supprimé of ["Répartir le reste équitablement", "Restant", "Grammes restants"]) {
    assert.ok(!panneau.includes(supprimé), `« ${supprimé} » ne doit plus être rendu`);
  }
  // Ne restent que le pourcentage, les grammes, le total et les verrous.
  assert.ok(panneau.includes("Total réparti"));
  assert.ok(panneau.includes("aria-pressed"), "les boutons de verrouillage restent");
  assert.ok(panneau.includes("MacroSliderRow"));
});

await test("59. sept jours, un seul ouvert, un seul composant de jour", () => {
  // Le sélecteur rend les sept jours…
  assert.ok(JOUR_ONGLETS.includes("WEEKDAY_KEYS.map"));
  assert.ok(JOUR_ONGLETS.includes('role="tablist"') && JOUR_ONGLETS.includes('role="tab"'));
  assert.ok(JOUR_ONGLETS.includes("aria-selected"));
  // …avec un défilement horizontal sur mobile et une rangée sur desktop.
  assert.ok(JOUR_ONGLETS.includes("overflow-x-auto") && JOUR_ONGLETS.includes("sm:flex-wrap"));
  // …et une navigation au clavier conforme au motif « tabs ».
  for (const touche of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.ok(JOUR_ONGLETS.includes(touche), `touche ${touche} gérée`);
  }

  // Le panneau ne monte QU'UN jour : les zones sont rendues une seule fois.
  for (const zone of ["<NutritionDayTargets", "<NutritionDaySlotDistribution", "<NutritionDayManualMeals"]) {
    assert.equal(
      (PANNEAU_SEMAINE.match(new RegExp(zone, "g")) ?? []).length,
      1,
      `${zone} ne doit être monté qu'une fois`,
    );
  }
  assert.ok(!/WEEKDAY_KEYS\.map\([\s\S]{0,200}<NutritionDayTargets/.test(PANNEAU_SEMAINE));
  // Les quatre actions du jour sont présentes.
  for (const action of ["Dupliquer ce jour vers", "Appliquer à toute la semaine", "Réinitialiser ce jour"]) {
    assert.ok(PANNEAU_SEMAINE.includes(action), `action « ${action} » absente`);
  }
});

await test("60. une même recette donne des quantités DIFFÉRENTES selon le jour", () => {
  // Le chemin élève complet : jour → objectifs du jour → créneau → solveur.
  const semaine: PlanV2Week = {
    planId: "plan-1",
    profiles: [
      { profileKey: "day_monday", dailyCalories: 2000, proteinBp: 3000, carbBp: 4500, fatBp: 2500, slots: CRENEAUX_STANDARD },
      { profileKey: "day_tuesday", dailyCalories: 3000, proteinBp: 3000, carbBp: 4500, fatBp: 2500, slots: CRENEAUX_STANDARD },
    ],
    days: [
      { id: "j1", day: "monday", profileKey: "day_monday", status: "non-commence", meals: [] },
      { id: "j2", day: "tuesday", profileKey: "day_tuesday", status: "non-commence", meals: [] },
    ],
  };

  const cibleLundi = slotTargetForDay(semaine, semaine.days[0], "lunch");
  const cibleMardi = slotTargetForDay(semaine, semaine.days[1], "lunch");
  assert.ok(cibleLundi.ok && cibleMardi.ok);
  if (!cibleLundi.ok || !cibleMardi.ok) return;
  assert.notDeepEqual(cibleLundi.target, cibleMardi.target, "deux jours, deux cibles");

  const lundi = solveRecipe(RECETTE_SIMPLE_PGL, { target: cibleLundi.target });
  const mardi = solveRecipe(RECETTE_SIMPLE_PGL, { target: cibleMardi.target });
  assert.notDeepEqual(
    lundi.ingredients.map((i) => i.grams),
    mardi.ingredients.map((i) => i.grams),
    "la même recette doit s'adapter au jour choisi",
  );
  // Et rien n'est persisté : le solveur ne sort que des objets éphémères.
  assert.ok(!sansCommentairesTs(SEMAINE_FORM).includes("solveRecipe"));
});

await test("61. aucun nouveau chemin d'écriture, aucune migration ajoutée", () => {
  // La refonte est purement applicative : elle n'écrit toujours que par la RPC.
  for (const [nom, code] of [
    ["constructeur", CONSTRUCTEUR],
    ["panneau de semaine", PANNEAU_SEMAINE],
    ["objectifs du jour", JOUR_OBJECTIFS],
    ["répartition du jour", JOUR_REPARTITION],
    ["repas du jour", JOUR_REPAS],
    ["onglets de jour", JOUR_ONGLETS],
    ["formulaire de semaine", SEMAINE_FORM],
  ] as const) {
    const texte = sansCommentairesTs(code);
    assert.ok(!/\.from\(|\.rpc\(|createSupabaseBrowserClient/.test(texte), `${nom} ne parle pas à Supabase`);
  }
  for (const page of [PAGE_NOUVEAU, PAGE_ADMIN_PLAN]) {
    assert.ok(page.includes("saveNutritionPlanV2("), "l'enregistrement reste la RPC v2");
    assert.ok(!/\.from\("(nutrition_days|meals|nutrition_plan_profiles)"\)/.test(page));
  }
  // La refonte de l'interface n'a ajouté AUCUNE migration. La seule migration
  // postérieure est celle de la garde serveur (20260814090000), et elle est
  // strictement additive : elle ne remplace qu'une fonction.
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 24);
  assert.ok(attendues.includes("20260814090000_nutrition_plan_v2_blocking_issue_week.sql"));
});

/* ═══════════ 13. Curseurs de créneau solidaires (zone 2) ═══════════ */

/** Somme d'une macro sur les créneaux ACTIFS — la cible est 10 000. */
function sommeActifs(jour: { slots: readonly MealSlotAllocation[] }, macro: "protein" | "carb" | "fat"): number {
  const champ = macro === "protein" ? "proteinBp" : macro === "carb" ? "carbBp" : "fatBp";
  return jour.slots.filter((a) => a.enabled).reduce((t, a) => t + a[champ], 0);
}

/** Les six créneaux actifs, chaque macro déjà répartie à 100 %. */
function jourRéparti(): WeekFormState {
  return initializeAllDays(createBlankWeek(), {
    dailyCalories: 2000,
    proteinBp: 3000,
    carbBp: 4500,
    fatBp: 2500,
  });
}

await test("62. créneau solidaire : CHAQUE position, sur les TROIS macros", () => {
  // Balayage exhaustif : 6 créneaux × 3 macros × 101 positions = 1 818 cas.
  // À chaque fois : somme exacte, entiers, aucune valeur négative, et la
  // valeur demandée conservée telle quelle.
  const base = jourRéparti();
  let cas = 0;
  for (const macro of ["protein", "carb", "fat"] as const) {
    for (const slot of MEAL_SLOT_KEYS) {
      for (let pourcent = 0; pourcent <= 100; pourcent += 1) {
        const bp = pourcent * 100;
        const suivant = setDaySlotMacroBp(base, "monday", slot, macro, bp);
        const jour = suivant.days.find((d) => d.day === "monday")!;
        const champ = macro === "protein" ? "proteinBp" : macro === "carb" ? "carbBp" : "fatBp";

        assert.equal(sommeActifs(jour, macro), BASIS_POINTS_TOTAL, `${macro}/${slot}/${pourcent}% : somme`);
        assert.equal(
          jour.slots.find((a) => a.slot === slot)![champ],
          bp,
          `${macro}/${slot}/${pourcent}% : la valeur demandée est conservée`,
        );
        for (const a of jour.slots) {
          assert.ok(Number.isInteger(a[champ]), `${macro}/${slot} : ${a.slot} n'est pas entier`);
          assert.ok(a[champ] >= 0, `${macro}/${slot} : ${a.slot} est négatif`);
          assert.ok(a[champ] <= BASIS_POINTS_TOTAL, `${macro}/${slot} : ${a.slot} dépasse 100 %`);
        }
        // Les DEUX autres macros ne bougent jamais : les trois répartitions
        // restent strictement indépendantes.
        for (const autre of ["protein", "carb", "fat"] as const) {
          if (autre === macro) continue;
          assert.equal(sommeActifs(jour, autre), BASIS_POINTS_TOTAL, `${autre} a bougé`);
        }
        cas += 1;
      }
    }
  }
  assert.equal(cas, 3 * MEAL_SLOT_KEYS.length * 101);
});

await test("63. verrous : aucun, un, plusieurs, et tous les autres", () => {
  const lire5 = (s: WeekFormState) =>
    s.days.find((d) => d.day === "monday")!.slots.map((a) => a.proteinBp);

  // ── Aucun verrou : le reste se répartit au prorata.
  let s = jourRéparti();
  s = setDaySlotMacroBp(s, "monday", "breakfast", "protein", 4000);
  let jour = s.days.find((d) => d.day === "monday")!;
  assert.equal(jour.slots.find((a) => a.slot === "breakfast")!.proteinBp, 4000);
  assert.equal(sommeActifs(jour, "protein"), BASIS_POINTS_TOTAL);

  // ── UN verrou : il est préservé au point de base près.
  s = jourRéparti();
  s = setDaySlotMacroBp(s, "monday", "lunch", "protein", 3000);
  s = toggleDaySlotLock(s, "monday", "protein", "lunch");
  s = setDaySlotMacroBp(s, "monday", "breakfast", "protein", 5000);
  jour = s.days.find((d) => d.day === "monday")!;
  assert.equal(jour.slots.find((a) => a.slot === "lunch")!.proteinBp, 3000, "le verrou est intact");
  assert.equal(jour.slots.find((a) => a.slot === "breakfast")!.proteinBp, 5000);
  assert.equal(sommeActifs(jour, "protein"), BASIS_POINTS_TOTAL);

  // ── PLUSIEURS verrous.
  s = jourRéparti();
  s = setDaySlotMacroBp(s, "monday", "lunch", "protein", 3000);
  s = setDaySlotMacroBp(s, "monday", "dinner", "protein", 2000);
  s = toggleDaySlotLock(s, "monday", "protein", "lunch");
  s = toggleDaySlotLock(s, "monday", "protein", "dinner");
  const avant = lire5(s);
  s = setDaySlotMacroBp(s, "monday", "breakfast", "protein", 1000);
  jour = s.days.find((d) => d.day === "monday")!;
  assert.equal(jour.slots.find((a) => a.slot === "lunch")!.proteinBp, avant[2]);
  assert.equal(jour.slots.find((a) => a.slot === "dinner")!.proteinBp, avant[4]);
  assert.equal(sommeActifs(jour, "protein"), BASIS_POINTS_TOTAL);

  // ── ÉCRÊTAGE : les verrous rendent la valeur demandée impossible.
  //    Le disponible est 10 000 − somme des verrouillés, lue en direct.
  const verrous = jour.slots
    .filter((a) => a.slot === "lunch" || a.slot === "dinner")
    .reduce((t, a) => t + a.proteinBp, 0);
  s = setDaySlotMacroBp(s, "monday", "breakfast", "protein", 9999);
  jour = s.days.find((d) => d.day === "monday")!;
  assert.equal(
    jour.slots.find((a) => a.slot === "breakfast")!.proteinBp,
    BASIS_POINTS_TOTAL - verrous,
    "la demande est ramenée à 10 000 − somme des verrouillés",
  );
  assert.equal(sommeActifs(jour, "protein"), BASIS_POINTS_TOTAL);

  // ── TOUS les autres verrouillés : le curseur est borné à
  //    10 000 − somme des verrouillés, exactement.
  s = jourRéparti();
  s = setDaySlotMacroBp(s, "monday", "breakfast", "protein", 4000);
  const verrouillés = MEAL_SLOT_KEYS.filter((slot) => slot !== "breakfast");
  for (const slot of verrouillés) s = toggleDaySlotLock(s, "monday", "protein", slot);
  const sommeVerrous = s.days
    .find((d) => d.day === "monday")!
    .slots.filter((a) => a.slot !== "breakfast")
    .reduce((t, a) => t + a.proteinBp, 0);

  s = setDaySlotMacroBp(s, "monday", "breakfast", "protein", 9999);
  jour = s.days.find((d) => d.day === "monday")!;
  assert.equal(
    jour.slots.find((a) => a.slot === "breakfast")!.proteinBp,
    BASIS_POINTS_TOTAL - sommeVerrous,
    "le curseur est borné à 10 000 − somme des verrouillés",
  );
  assert.equal(sommeActifs(jour, "protein"), BASIS_POINTS_TOTAL);

  // Un créneau VERROUILLÉ ne peut pas être déplacé.
  const gelé = setDaySlotMacroBp(s, "monday", "lunch", "protein", 0);
  assert.deepEqual(lire5(gelé), lire5(s), "un créneau verrouillé est immobile");
});

await test("64. créneaux désactivés : exclus de la répartition, jamais négatifs", () => {
  let s = jourRéparti();
  s = setDaySlotEnabled(s, "monday", "dessert", false);
  s = setDaySlotEnabled(s, "monday", "morning_snack", false);
  s = setDaySlotMacroBp(s, "monday", "lunch", "carb", 6000);
  const jour = s.days.find((d) => d.day === "monday")!;

  // Les désactivés restent à zéro et n'entrent pas dans la cible.
  for (const slot of ["dessert", "morning_snack"] as const) {
    const a = jour.slots.find((x) => x.slot === slot)!;
    assert.equal(a.enabled, false);
    assert.equal(a.proteinBp + a.carbBp + a.fatBp, 0);
  }
  // Les quatre restants totalisent 10 000.
  assert.equal(sommeActifs(jour, "carb"), BASIS_POINTS_TOTAL);
  assert.equal(jour.slots.find((a) => a.slot === "lunch")!.carbBp, 6000);
  assert.ok(jour.slots.every((a) => a.carbBp >= 0));

  // Un créneau désactivé ne peut pas être déplacé.
  const inchangé = setDaySlotMacroBp(s, "monday", "dessert", "carb", 5000);
  assert.equal(inchangé.days.find((d) => d.day === "monday")!.slots.find((a) => a.slot === "dessert")!.carbBp, 0);
});

await test("65. la garde serveur contrôle les SEPT jours, dans l'ordre", () => {
  const migration = lire("../../supabase/migrations/20260814090000_nutrition_plan_v2_blocking_issue_week.sql");
  const sql = sansCommentairesSql(migration);

  // Strictement additive : une seule fonction remplacée, rien d'autre.
  assert.equal((sql.match(/create or replace function/gi) ?? []).length, 1);
  for (const interdit of [
    /alter table/i, /drop\s+(table|function|policy|column|index)/i,
    /create\s+(table|index|policy|trigger)/i,
    /insert into/i, /update\s+public\./i, /delete from/i, /truncate/i,
  ]) {
    assert.ok(!interdit.test(sql), `la migration doit rester additive : ${interdit}`);
  }

  // Les sept jours, dans l'ordre canonique.
  assert.ok(
    sql.includes("'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'"),
    "les sept jours sont parcourus dans l'ordre",
  );
  // Les contrôles exigés, chacun avec le jour en préfixe.
  for (const code of [
    "missing_day", "missing_profile_key", "unknown_profile", "calories_not_positive",
    "daily_split_incomplete", "missing_slot", "no_enabled_slot",
    "disabled_slot_with_allocation",
    "protein_split_incomplete", "carb_split_incomplete", "fat_split_incomplete",
  ]) {
    assert.ok(sql.includes(`v_jour || ':${code}'`), `contrôle absent : ${code}`);
  }
  // Le plan sans profil garde le code historique.
  assert.ok(sql.includes("return 'missing_default_profile';"));
  // Conventions de sécurité du dépôt, inchangées.
  assert.ok(sql.includes("security invoker") && sql.includes("set search_path = ''"));
  assert.ok(sql.includes("revoke execute on function public.nutrition_plan_v2_blocking_issue(uuid) from anon;"));
  assert.ok(sql.includes("grant execute on function public.nutrition_plan_v2_blocking_issue(uuid) to authenticated;"));
  assert.ok(!/grant execute on function public\.nutrition_plan_v2_blocking_issue\(uuid\) to (public|anon)/i.test(sql));

  // Et la checklist exerce bien les cas exigés.
  for (const attendu of [
    "H1. les sept jours valides",
    "monday:calories_not_positive",
    "tuesday:daily_split_incomplete",
    "sunday:no_enabled_slot",
    "wednesday:carb_split_incomplete",
    "friday:missing_day",
    "missing_default_profile",
    "H10. tout réparé",
  ]) {
    assert.ok(CHECKLIST.includes(attendu), `la checklist doit couvrir : ${attendu}`);
  }
  assert.ok(/^rollback;$/m.test(CHECKLIST), "la checklist se termine par un ROLLBACK");
});

/* ═══════ 14. Le suivi et l'affichage élève suivent le jour prescrit ═══════ */

/** Une semaine v2 : lundi 3 000 kcal, mardi 2 000, les cinq autres 3 000. */
function semaineInégale(): PlanV2Week {
  const profil = (jour: string, kcal: number) => ({
    profileKey: `day_${jour}`,
    dailyCalories: kcal,
    proteinBp: 3000,
    carbBp: 4500,
    fatBp: 2500,
    slots: MEAL_SLOT_KEYS.map((slot, i): MealSlotAllocation => ({
      slot,
      enabled: slot === "lunch" || slot === "dinner",
      proteinBp: slot === "lunch" ? 4000 : slot === "dinner" ? 6000 : 0,
      carbBp: slot === "lunch" ? 4000 : slot === "dinner" ? 6000 : 0,
      fatBp: slot === "lunch" ? 4000 : slot === "dinner" ? 6000 : 0,
      displayOrder: i,
    })),
  });
  const kcal = (jour: string) => (jour === "tuesday" ? 2000 : 3000);
  return {
    planId: "plan-1",
    profiles: WEEKDAY_KEYS.map((j) => profil(j, kcal(j))),
    days: WEEKDAY_KEYS.map((j) => ({
      id: `jour-${j}`,
      day: j,
      profileKey: `day_${j}`,
      status: "non-commence",
      meals: [],
    })),
  };
}

await test("66. chaque jour du suivi porte SON objectif, pas la moyenne", () => {
  // LE BUG CORRIGÉ : un plan à 3 000 kcal sauf le mardi à 2 000 affichait
  // 2 857 kcal — la moyenne — pour les SEPT jours.
  const semaine = semaineInégale();
  const parJour = dailyTargetsByWeekday(semaine).map((c) =>
    c
      ? {
          calories: c.calories.totalCalories,
          protein: c.grams.proteinGrams,
          carbs: c.grams.carbGrams,
          fat: c.grams.fatGrams,
        }
      : null,
  );
  assert.equal(parJour.length, 7);
  assert.equal(Math.round(parJour[0]!.calories), 3000, "lundi");
  assert.equal(Math.round(parJour[1]!.calories), 2000, "mardi");
  assert.equal(weeklyCaloriesFromDays(semaine), 20000, "3 000 × 6 + 2 000");

  const dates = getCurrentWeekDates(new Date("2026-08-03T12:00:00"));
  const ajustement = computeWeeklyNutritionAdjustment(
    { calories: 3000, protein: 0, carbs: 0, fat: 0, weeklyTargetCalories: 20000, perDay: parJour },
    [],
    dates,
  );

  // Aucun jour rempli : chacun retrouve EXACTEMENT son objectif prescrit.
  assert.equal(ajustement.calories.weeklyTarget, 20000);
  assert.equal(ajustement.days[0].targetCalories, 3000, "lundi");
  assert.equal(ajustement.days[1].targetCalories, 2000, "mardi");
  assert.equal(ajustement.days[6].targetCalories, 3000, "dimanche");
  assert.notEqual(ajustement.days[1].targetCalories, ajustement.days[0].targetCalories,
    "les sept jours ne peuvent plus être identiques");
  // La somme des sept objectifs reconstitue la semaine.
  assert.equal(
    ajustement.days.reduce((t, j) => t + (j.targetCalories ?? 0), 0),
    20000,
  );
});

await test("67. l'ajustement respecte la FORME de la semaine, pas un partage égal", () => {
  const semaine = semaineInégale();
  const parJour = dailyTargetsByWeekday(semaine).map((c) =>
    c ? { calories: c.calories.totalCalories, protein: c.grams.proteinGrams, carbs: c.grams.carbGrams, fat: c.grams.fatGrams } : null,
  );
  const dates = getCurrentWeekDates(new Date("2026-08-03T12:00:00"));

  // Lundi dépassé : 3 500 consommés au lieu de 3 000.
  const ajustement = computeWeeklyNutritionAdjustment(
    { calories: 3000, protein: 0, carbs: 0, fat: 0, weeklyTargetCalories: 20000, perDay: parJour },
    [{ logDate: dates[0], calories: 3500, proteinG: null, carbsG: null, fatG: null, note: "" }],
    dates,
  );

  assert.equal(ajustement.days[0].filled, true);
  assert.equal(ajustement.days[0].targetCalories, 3000, "un jour rempli garde son objectif prescrit");
  assert.equal(ajustement.days[0].varianceCalories, 500, "l'écart se mesure contre SON objectif");

  const restant = 20000 - 3500; // 16 500 à répartir sur six jours
  assert.equal(ajustement.calories.remaining, restant);

  const mardi = ajustement.days[1].targetCalories!;
  const mercredi = ajustement.days[2].targetCalories!;
  // Mardi reste PLUS BAS que mercredi : la forme prescrite est préservée.
  assert.ok(mardi < mercredi, `mardi ${mardi} devrait rester sous mercredi ${mercredi}`);
  // Et au prorata : mardi vaut 2 000/17 000 du restant.
  assert.equal(mardi, Math.round((restant * 2000) / 17000));
  assert.equal(mercredi, Math.round((restant * 3000) / 17000));
  // Aucune valeur négative, jamais.
  assert.ok(ajustement.days.every((j) => (j.targetCalories ?? 0) >= 0));
});

await test("68. sans les sept jours, l'ancien comportement est INCHANGÉ", () => {
  // Les plans mock et les plans sans semaine chargée doivent continuer de
  // fonctionner exactement comme avant : un objectif quotidien unique.
  const dates = getCurrentWeekDates(new Date("2026-08-03T12:00:00"));
  const ajustement = computeWeeklyNutritionAdjustment(
    { calories: 2000, protein: 150, carbs: 200, fat: 60, weeklyTargetCalories: 14000 },
    [],
    dates,
  );
  assert.equal(ajustement.calories.weeklyTarget, 14000);
  assert.ok(ajustement.days.every((j) => j.targetCalories === 2000), "partage égal, comme avant");
  assert.equal(ajustement.days[0].targetProtein, 150);

  // Une liste incomplète est ignorée : on ne devine pas les jours manquants.
  const partiel = computeWeeklyNutritionAdjustment(
    {
      calories: 2000, protein: 150, carbs: 200, fat: 60, weeklyTargetCalories: 14000,
      perDay: [{ calories: 3000, protein: 0, carbs: 0, fat: 0 }],
    },
    [],
    dates,
  );
  assert.ok(partiel.days.every((j) => j.targetCalories === 2000));
});

await test("69. chaque repas affiche la part de SON créneau, pour SON jour", () => {
  // LE SECOND BUG : les repas de l'élève n'affichaient plus rien depuis que le
  // coach ne saisit plus de macros par repas. La part du créneau, appliquée
  // aux objectifs du jour, redonne la valeur — et elle DIFFÈRE d'un jour à
  // l'autre puisque les objectifs diffèrent.
  const semaine = semaineInégale();
  const lundi = semaine.days[0];
  const mardi = semaine.days[1];

  const déjeunerLundi = slotMacrosForDay(semaine, lundi, "lunch");
  const déjeunerMardi = slotMacrosForDay(semaine, mardi, "lunch");
  const dînerLundi = slotMacrosForDay(semaine, lundi, "dinner");
  assert.ok(déjeunerLundi && déjeunerMardi && dînerLundi);
  if (!déjeunerLundi || !déjeunerMardi || !dînerLundi) return;

  // 40 % du lundi, 60 % pour le dîner : le déjeuner est plus léger.
  assert.ok(déjeunerLundi.calories < dînerLundi.calories);
  // Et le déjeuner du mardi est plus léger que celui du lundi (2 000 vs 3 000).
  assert.ok(
    déjeunerMardi.calories < déjeunerLundi.calories,
    `mardi ${déjeunerMardi.calories} devrait rester sous lundi ${déjeunerLundi.calories}`,
  );
  // Les deux créneaux actifs reconstituent la journée, sans dérive d'arrondi.
  assert.ok(Math.abs(déjeunerLundi.calories + dînerLundi.calories - 3000) < 1);

  // Un créneau DÉSACTIVÉ n'a pas d'objectif — il n'en a pas « zéro ».
  assert.equal(slotMacrosForDay(semaine, lundi, "dessert"), null);
});
/* ═══════════ Cycle de vie — ce que la BASE impose (PR D) ═══════════ */

await test("71. un BROUILLON est invisible pour l'élève, une ARCHIVE reste lisible", () => {
  const sql = M_CYCLE_DE_VIE;
  // Les cinq policies de lecture élève portent toutes la même condition.
  for (const policy of [
    "nutrition_plans_select_self_or_assigned",
    "nutrition_days_select_self_or_assigned",
    "meals_select_self_or_assigned",
    "nutrition_plan_profiles_select_assigned",
    "nutrition_meal_slot_targets_select_assigned",
  ]) {
    const début = sql.indexOf(`create policy "${policy}"`);
    assert.ok(début > 0, `${policy} doit être recréée`);
    const corps = sql.slice(début, début + 700);
    assert.ok(corps.includes("status <> 'prochain'"), `${policy} : le brouillon est exclu`);
    assert.ok(!corps.includes("status = 'actif'"), `${policy} : une ARCHIVE reste lisible`);
  }
  // L'écriture élève sur ses journées suit la même règle.
  const majJour = sql.slice(sql.indexOf('create policy "nutrition_days_update_self"'));
  assert.equal((majJour.slice(0, 900).match(/status <> 'prochain'/g) ?? []).length, 2,
    "USING et WITH CHECK portent tous deux la condition");
  // Le catalogue de recettes passe par le plan : un brouillon ne l'ouvre plus.
  const recettesÉlève = sql.slice(sql.indexOf('create policy "nutrition_recipes_select_student"'));
  assert.ok(recettesÉlève.slice(0, 600).includes("p.status <> 'prochain'"));
  assert.ok(recettesÉlève.slice(0, 600).includes("status = 'active'"),
    "une recette non publiée reste invisible, règle inchangée");
  // Et la lecture applicative répète la règle, pour un appel privilégié.
  assert.ok(LECTURE_PLANS.includes('.neq("status", "prochain")'));
});

await test("72. un plan non ACTIF n'est pas assignable, et la base le refuse elle-même", () => {
  const sql = M_CYCLE_DE_VIE;
  const rpc = sql.slice(sql.indexOf("create or replace function public.assign_nutrition_plan"));
  assert.ok(rpc.includes("PLAN_STATUS_DRAFT"), "un brouillon est nommément refusé");
  assert.ok(rpc.includes("PLAN_STATUS_ARCHIVED"), "une archive aussi");
  // Le contrôle est AVANT toute écriture : il précède le retrait des autres
  // plans de l'élève, donc un refus ne laisse jamais l'élève sans plan.
  assert.ok(rpc.indexOf("PLAN_STATUS_DRAFT") < rpc.indexOf("set student_id = null"),
    "le refus précède toute écriture");
  // Idempotence préservée : réassigner le plan que l'élève a DÉJÀ n'est pas
  // refusé, quel que soit son statut — sinon un plan archivé alors qu'il était
  // assigné deviendrait irrécupérable.
  assert.ok(rpc.includes("v_plan.student_id is distinct from p_student_id"));
  // Le message d'écran existe, et distingue les deux cas.
  assert.ok(PAGE_ADMIN_PLAN.includes("il ne peut pas être assigné tant qu'il n'est pas activé"));
  assert.ok(PAGE_ADMIN_PLAN.includes("plus proposé à de nouvelles assignations"));
});

await test("73. la SEULE condition bloquante est un élève actuellement affecté", () => {
  // La règle EN VIGUEUR vient de 20260817090000. 20260815090000 est immuable :
  // on vérifie d'ailleurs qu'elle porte toujours l'ancienne règle, preuve que
  // le correctif est bien passé par une migration et non par une retouche.
  assert.ok(/from public\.nutrition_daily_logs/.test(
    M_CYCLE_DE_VIE.slice(
      M_CYCLE_DE_VIE.indexOf("create or replace function public.nutrition_plan_deletion_block"),
      M_CYCLE_DE_VIE.indexOf("create or replace function public.nutrition_recipe_deletion_block"),
    )),
    "20260815 doit rester tel qu'il a été appliqué en Production");
  const sql = M_SUPPRESSION;
  const départBloc = sql.indexOf("create or replace function public.nutrition_plan_deletion_block");
  const blocage = sql.slice(départBloc, sql.indexOf("$fn$;", départBloc));
  // RÈGLE MÉTIER : l'affectation bloque, l'historique non.
  assert.ok(/if v_plan\.student_id is not null then\s+return 'assigned';/.test(blocage),
    "un élève affecté refuse la suppression");
  assert.ok(!/from public\.nutrition_daily_logs/.test(blocage),
    "les journées de suivi ne sont plus une condition de blocage");
  assert.ok(!/delete from/i.test(blocage), "la garde ne supprime rien, elle est `stable`");
  // `used_in_history` subsiste, mais comme garde-fou d'ÉVOLUTION : il ne se
  // déclenche que si une table inconnue référence le plan.
  assert.ok(blocage.includes("pg_catalog.pg_constraint"), "le garde-fou lit le schéma");
  assert.ok(blocage.includes("return 'used_in_history'"));

  // La suppression, elle, emporte le journal — explicitement, et en le
  // comptant, jamais en laissant faire la CASCADE.
  // BORNÉ au corps de la fonction : au-delà, le fichier parle d'autre chose.
  const départ = sql.indexOf("create or replace function public.delete_nutrition_plan");
  const suppression = sql.slice(départ, sql.indexOf("$fn$;", départ));
  assert.ok(suppression.includes("for update"), "la ligne est verrouillée avant les contrôles");
  assert.ok(/delete from public\.nutrition_daily_logs[\s\S]{0,120}nutrition_plan_id = p_plan_id/.test(suppression),
    "le journal du plan est supprimé, borné à CE plan");
  assert.ok(suppression.includes("'daily_logs', v_logs"), "et le nombre supprimé est remonté");
  // Les cinq tables filles sont nommées une par une.
  for (const table of ["public.meals", "public.nutrition_days", "public.nutrition_meal_slot_targets",
                       "public.nutrition_plan_profiles", "public.nutrition_daily_logs"]) {
    assert.ok(suppression.includes(`delete from ${table}`), `suppression explicite : ${table}`);
  }
  // Une affectation apparue entre-temps annule TOUTE la transaction.
  assert.ok(suppression.includes("PLAN_ASSIGNED_APPEARED"));
  // CE QUI N'EST JAMAIS TOUCHÉ.
  assert.ok(!/delete from public\.students/.test(suppression), "jamais un élève");
  assert.ok(!/auth\.users/.test(suppression), "jamais un compte");
  assert.ok(!/set student_id = null/.test(suppression), "aucune désaffectation automatique");
});

await test("74. les compteurs de l'interface tiennent en UN aller-retour", () => {
  // Un appel, pour toutes les ressources — pas un par ligne.
  assert.ok(SERVICE_CYCLE_DE_VIE.includes('"nutrition_lifecycle_overview"'));
  const sql = M_CYCLE_DE_VIE;
  const aperçu = sql.slice(sql.indexOf("create or replace function public.nutrition_lifecycle_overview"));
  assert.ok(aperçu.includes("left join lateral"), "les compteurs sont agrégés en SQL");
  assert.ok(aperçu.includes("jsonb_agg"), "un seul document est renvoyé");
  assert.ok(aperçu.includes("stable"), "l'aperçu ne peut rien écrire");
  assert.ok(aperçu.includes("is_coach_or_admin()"), "réservé au staff");
  // Le hook n'appelle la lecture qu'au montage et sur rechargement explicite.
  const hook = HOOK_CYCLE_DE_VIE;
  assert.equal((hook.match(/readNutritionLifecycleOverview\(/g) ?? []).length, 2,
    "une lecture au montage, une au rechargement — jamais par ligne");
  assert.ok(!/\bmap\(|forEach\(/.test(hook.slice(hook.indexOf("useEffect"))),
    "aucune boucle de requêtes");
});


console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
