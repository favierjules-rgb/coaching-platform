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
  dailyTargetsForDay,
  enabledSlotsForDay,
  orderedDays,
  orderedMeals,
  profileForDay,
  recipesForSlot,
  slotTargetForDay,
  weeklyCaloriesFromDays,
  type PlanV2Day,
  type PlanV2Week,
} from "../../lib/nutrition/plan-v2-week";
import {
  PROFILE_KEY_PATTERN,
  addMeal,
  addProfile,
  createBlankWeek,
  duplicateDay,
  itemsToText,
  removeMeal,
  removeProfile,
  setDayProfile,
  setProfileCalories,
  textToItems,
  toWeekSavePayload,
  updateMeal,
  weeklyCaloriesFromForm,
} from "../../lib/nutrition/plan-v2-week-form";
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
const RECETTES_ELEVE = lire("../../components/student/StudentAdaptiveRecipes.tsx");
const SEMAINE_ELEVE = lire("../../components/student/StudentPrescribedWeek.tsx");
const PANNEAU_SEMAINE = lire("../../components/admin/NutritionPlanV2WeekPanel.tsx");
const PAGE_NOUVEAU = lire("../../app/admin/nutrition/nouveau/page.tsx");
const PAGE_ADMIN_PLAN = lire("../../app/admin/nutrition/[planId]/page.tsx");
const APERCU_ADMIN = lire("../../components/admin/RecipeAdaptivePreview.tsx");
const SEMAINE_LIB = lire("../../lib/nutrition/plan-v2-week.ts");
const SEMAINE_FORM = lire("../../lib/nutrition/plan-v2-week-form.ts");
const LECTURE_SEMAINE = lire("../../lib/supabase/nutrition-week.ts");
const HOOK_ELEVE = lire("../../hooks/useStudentNutritionPlanV2.ts");

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
  for (const source of [RECETTES_ELEVE, SEMAINE_ELEVE, PANNEAU_SEMAINE]) {
    const code = sansCommentairesTs(source);
    assert.ok(
      !/\[\s*"breakfast"\s*,\s*"morning_snack"/.test(code),
      "aucune liste de créneaux réécrite dans un composant",
    );
  }
  assert.ok(PANNEAU_SEMAINE.includes("MEAL_SLOT_KEYS"), "le panneau importe la liste");
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
  const semaine = createBlankWeek("standard", 2000);
  const payload = toWeekSavePayload(semaine, {
    proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD,
  });
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

await test("26. sept jours, tous rattachés au profil principal, dès la création", () => {
  const semaine = createBlankWeek("standard", 2000);
  assert.equal(semaine.days.length, 7);
  assert.deepEqual(semaine.days.map((d) => d.day), [...WEEKDAY_KEYS]);
  assert.ok(semaine.days.every((d) => d.profileKey === "standard"));
  assert.ok(semaine.days.every((d) => d.meals.length === 0));
});

await test("27. ajout, modification et retrait d'un repas", () => {
  let s = createBlankWeek("standard", 2000);
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

await test("28. dupliquer un jour donne de NOUVEAUX identifiants de repas", () => {
  let s = createBlankWeek("standard", 2000);
  s = addMeal(s, "monday", "lunch");
  const source = s.days.find((d) => d.day === "monday")!.meals[0];
  s = duplicateDay(s, "monday", "tuesday");

  const copie = s.days.find((d) => d.day === "tuesday")!.meals[0];
  assert.equal(copie.slot, source.slot);
  assert.notEqual(copie.id, source.id, "sans identifiant neuf, la RPC refuserait l'écriture");
  // Le jour source est intact.
  assert.equal(s.days.find((d) => d.day === "monday")!.meals[0].id, source.id);
});

await test("29. le profil d'un jour se change, et un profil retiré libère ses jours", () => {
  let s = createBlankWeek("standard", 2000);
  s = addProfile(s, "training_high", 2200);
  s = setDayProfile(s, "tuesday", "training_high");
  assert.equal(s.days.find((d) => d.day === "tuesday")!.profileKey, "training_high");

  // Un profil inconnu est refusé silencieusement : l'état ne change pas.
  const avant = s;
  s = setDayProfile(s, "wednesday", "inexistant");
  assert.equal(s, avant);

  s = removeProfile(s, "training_high");
  assert.equal(s.days.find((d) => d.day === "tuesday")!.profileKey, "standard",
    "le jour retombe sur le principal, sinon la clé étrangère refuserait");
  assert.ok(!s.profiles.some((p) => p.profileKey === "training_high"));

  // Le profil PRINCIPAL n'est jamais retirable.
  const intact = removeProfile(s, "standard");
  assert.equal(intact, s);
});

await test("30. la clé d'un profil respecte le format de la base", () => {
  assert.ok(PROFILE_KEY_PATTERN.test("training_high"));
  assert.ok(PROFILE_KEY_PATTERN.test("rest"));
  assert.ok(!PROFILE_KEY_PATTERN.test("Training"), "pas de majuscule");
  assert.ok(!PROFILE_KEY_PATTERN.test("2000kcal"), "ne commence pas par un chiffre");
  assert.ok(!PROFILE_KEY_PATTERN.test("a".repeat(33)), "32 caractères au plus");
  // Le miroir SQL.
  assert.ok(sansCommentairesSql(M_SAUVEGARDE).includes("^[a-z][a-z0-9_]{0,31}$"));

  // Une clé invalide n'entre pas dans l'état.
  const s = addProfile(createBlankWeek("standard", 2000), "Training", 2200);
  assert.equal(s.profiles.length, 1);
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

await test("32. le total hebdomadaire du formulaire suit les profils par jour", () => {
  let s = createBlankWeek("standard", 2000);
  assert.equal(weeklyCaloriesFromForm(s), 14000);

  s = addProfile(s, "training_high", 2200);
  s = setDayProfile(s, "tuesday", "training_high");
  s = setDayProfile(s, "thursday", "training_high");
  assert.equal(weeklyCaloriesFromForm(s), 14400);

  s = setProfileCalories(s, "standard", 1900);
  assert.equal(weeklyCaloriesFromForm(s), 1900 * 5 + 2200 * 2);
});

await test("33. la charge utile porte les SEPT jours, dans l'ordre, avec leur profil", () => {
  let s = createBlankWeek("standard", 2000);
  s = addProfile(s, "rest", 1900);
  s = setDayProfile(s, "sunday", "rest");
  s = addMeal(s, "monday", "dinner");
  s = addMeal(s, "monday", "breakfast");

  const payload = toWeekSavePayload(s, {
    proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD,
  }) as {
    days: { day: string; profile_key: string; meals: { slot: string; id: string | null }[] }[];
    profiles: { profile_key: string; slots: unknown[] }[];
    main_profile_key: string;
  };

  assert.equal(payload.days.length, 7);
  assert.deepEqual(payload.days.map((d) => d.day), [...WEEKDAY_KEYS]);
  assert.equal(payload.days.find((d) => d.day === "sunday")!.profile_key, "rest");
  assert.equal(payload.main_profile_key, "standard");
  assert.equal(payload.profiles.length, 2);
  assert.ok(payload.profiles.every((p) => p.slots.length === 6), "six créneaux par profil");

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
  const localFactice = toWeekSavePayload(
    { ...s, days: s.days.map((d) => (d.day === "monday" ? { ...d, meals: [{ ...d.meals[0], id: "nouveau:monday" }] } : d)) },
    { proteinBp: 2800, carbBp: 4400, fatBp: 2800, slots: CRENEAUX_STANDARD },
  ) as { days: { day: string; meals: { id: string | null }[] }[] };
  assert.equal(localFactice.days.find((d) => d.day === "monday")!.meals[0].id, null,
    "un identifiant non-UUID n'est jamais envoyé");
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

await test("45. l'écran élève affiche les TROIS sections, séparées", () => {
  for (const titre of ["Suivi de la semaine", "Semaine alimentaire", "Recettes adaptatives"]) {
    assert.ok(PAGE_ELEVE_DETAIL.includes(titre), `section « ${titre} »`);
  }
  assert.ok(PAGE_ELEVE_DETAIL.includes("WeeklyNutritionTracker"), "l'outil 1 est réutilisé tel quel");
  assert.ok(PAGE_ELEVE_DETAIL.includes("StudentPrescribedWeek"));
  assert.ok(PAGE_ELEVE_DETAIL.includes("StudentAdaptiveRecipes"));
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

await test("48. le panneau de semaine du coach conserve la carte de repas v1", () => {
  for (const champ of ["Moment", "Nom du repas", "Aliments", "Kcal", "Prot (g)", "Gluc (g)", "Lip (g)", "Notes coach"]) {
    assert.ok(PANNEAU_SEMAINE.includes(champ), `champ « ${champ} » conservé`);
  }
  assert.ok(PANNEAU_SEMAINE.includes("Profil du jour"), "le sélecteur de profil est ajouté");
  assert.ok(PANNEAU_SEMAINE.includes("Dupliquer"));
  assert.ok(PANNEAU_SEMAINE.includes("Ajouter un repas"));
  assert.ok(
    !sansCommentairesTs(PANNEAU_SEMAINE).includes("solveRecipe"),
    "l'outil 3 reste entièrement manuel",
  );
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
  ]) {
    assert.ok(CHECKLIST.includes(attendu), `la checklist doit couvrir : ${attendu}`);
  }
  assert.ok(/^rollback;$/m.test(CHECKLIST));
  assert.ok(CHECKLIST.indexOf("begin;") < CHECKLIST.indexOf("\nrollback;"));
});

await test("51. les quatre migrations sont déclarées au manifeste et comptées", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 20);
  for (const nom of [
    "20260810090000_harden_nutrition_privileges.sql",
    "20260811090000_nutrition_v2_unification.sql",
    "20260812090000_save_nutrition_plan_v2_full.sql",
    "20260813090000_student_recipe_read_access.sql",
  ]) {
    assert.ok(attendues.includes(nom), nom);
  }
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 47,"), "le compteur de migrations suit les migrations réelles");
  assert.ok(secu.includes("assert.equal(attendues.length, 20);"));
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
