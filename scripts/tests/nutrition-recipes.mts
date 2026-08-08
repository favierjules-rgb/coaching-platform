/**
 * Harnais — feat/nutrition-adaptive-recipes-engine, PR A.
 *
 * Socle des recettes adaptatives : migration, mappers, lecture groupée,
 * cible par créneau, filtrage par profil contrôlé, description des écarts.
 *
 * PÉRIMÈTRE. Aucune interface d'administration, aucun écran élève, aucune
 * écriture, aucune fixture importée en base. Le comportement TRANSACTIONNEL
 * et les privilèges réels sont prouvés sur un vrai PostgreSQL par
 * supabase/tests/nutrition_recipes_checklist.sql.
 *
 * Lancement : npx tsx scripts/tests/nutrition-recipes.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { computeDailyMacroTargets } from "../../lib/nutrition/macro-targets";
import { computeMealDistribution, MEAL_SLOT_KEYS } from "../../lib/nutrition/meal-distribution";
import type { MealSlotAllocation } from "../../lib/nutrition/meal-distribution";
import type { NutritionPlanV2Profile } from "../../lib/nutrition/plan-v2-validation";
import { solveRecipe } from "../../lib/nutrition/recipe-solver";
import type { Recipe } from "../../lib/nutrition/recipe-types";
import {
  RECIPE_SLOT_KEYS,
  RECIPE_STATUSES,
  RECIPE_TAG_KINDS,
  RECIPE_TAG_VOCABULARY,
  RecipeMappingError,
  assembleRecipeWithTags,
  buildRecipeIngredientInsertPayload,
  mapRecipeIngredientRow,
  mapRecipeRow,
  mapRecipeTagRow,
  toNutritionRecipeIngredientRow,
  type NutritionRecipeIngredientRow,
  type NutritionRecipeRow,
  type NutritionRecipeTagRow,
  type RecipeWithTags,
} from "../../lib/nutrition/recipe-rows";
import {
  buildRecipeTargetForMealSlot,
  describeRecipeFit,
  filterRecipesForProfile,
  keepMatchingRecipes,
} from "../../lib/nutrition/recipe-matching";
import { assembler } from "../../lib/supabase/nutrition-recipes";
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
function sansCommentairesSql(source: string): string {
  return source.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}
/** Retire les commentaires TypeScript : on assertionne le CODE, pas la prose
 *  — un commentaire qui DOCUMENTE une interdiction ne doit pas la déclencher. */
function sansCommentairesTs(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const MIGRATION = lire("../../supabase/migrations/20260807090000_nutrition_recipes.sql");
const CHECKLIST = lire("../../supabase/tests/nutrition_recipes_checklist.sql");
const COUCHE_LECTURE = lire("../../lib/supabase/nutrition-recipes.ts");
const MATCHING = lire("../../lib/nutrition/recipe-matching.ts");
const ROWS = lire("../../lib/nutrition/recipe-rows.ts");

/* ────────────────────────── Jeux de lignes ────────────────────────── */

const RECETTE_ROW: NutritionRecipeRow = {
  id: "r1",
  coach_id: "c1",
  name: "Poulet riz crème",
  description: "Plat de référence",
  slot_key: "lunch",
  status: "active",
};

/** `numeric` PostgREST = chaînes. On teste le cas réel, pas le cas confortable. */
const INGREDIENTS_ROWS: NutritionRecipeIngredientRow[] = [
  {
    id: "creme", recipe_id: "r1", position: 3, name: "Crème légère 4%", role: "fat",
    protein_per_100g: "3", carb_per_100g: "3", fat_per_100g: "4",
    reference_grams: "80", min_grams: null, max_grams: "100",
    unit_scalable: false, max_units: null, unit_name: null, fixed_label: null,
    egg: false, egg_grams: null, linked_to_ingredient_id: null, link_ratio_bp: null,
  },
  {
    id: "poulet", recipe_id: "r1", position: 1, name: "Blanc de poulet", role: "protein",
    protein_per_100g: "25.5", carb_per_100g: "0", fat_per_100g: "1.25",
    reference_grams: "140", min_grams: null, max_grams: null,
    unit_scalable: false, max_units: null, unit_name: null, fixed_label: null,
    egg: false, egg_grams: null, linked_to_ingredient_id: null, link_ratio_bp: null,
  },
  {
    id: "riz", recipe_id: "r1", position: 2, name: "Riz", role: "carbohydrate",
    protein_per_100g: 7, carb_per_100g: 77, fat_per_100g: 1,
    reference_grams: 100, min_grams: null, max_grams: null,
    unit_scalable: false, max_units: null, unit_name: null, fixed_label: null,
    egg: false, egg_grams: null, linked_to_ingredient_id: null, link_ratio_bp: null,
  },
];

const TAGS_ROWS: NutritionRecipeTagRow[] = [
  { recipe_id: "r1", kind: "allergen", value: "milk" },
  { recipe_id: "r1", kind: "excludes", value: "poultry" },
];

function recetteAvec(
  id: string,
  slotKey: string | null,
  status: string,
  tags: readonly { kind: string; value: string }[],
): RecipeWithTags {
  return assembleRecipeWithTags(
    { ...RECETTE_ROW, id, slot_key: slotKey, status },
    INGREDIENTS_ROWS.map((i) => ({ ...i, recipe_id: id })),
    tags.map((t) => ({ recipe_id: id, kind: t.kind, value: t.value })),
  );
}

const PROFIL_V2: NutritionPlanV2Profile = {
  profileKey: "default",
  dailyCalories: 2400,
  proteinBp: 3000,
  carbBp: 4500,
  fatBp: 2500,
  slots: MEAL_SLOT_KEYS.map((slot, i): MealSlotAllocation => ({
    slot,
    enabled: slot !== "dessert",
    proteinBp: slot === "dessert" ? 0 : 2000,
    carbBp: slot === "dessert" ? 0 : 2000,
    fatBp: slot === "dessert" ? 0 : 2000,
    displayOrder: i,
  })),
};

/* ═══════════════════════ 1. Mappers ═══════════════════════ */

await test("1. mapRecipeIngredientRow préserve les valeurs EXACTES, sans arrondi", () => {
  const ing = mapRecipeIngredientRow(INGREDIENTS_ROWS[1]);
  assert.equal(ing.proteinPer100g, 25.5, "25.5 ne doit pas devenir 25 ni 26");
  assert.equal(ing.fatPer100g, 1.25);
  assert.equal(ing.referenceGrams, 140);
  assert.equal(ing.role, "protein");
  assert.equal(ing.minGrams, null);
  assert.equal(ing.maxGrams, null);
  assert.equal(ing.unitScalable, false);
  assert.equal(ing.egg, false);
});

await test("2. mapRecipeRow trie par position et n'invente rien", () => {
  const recette = mapRecipeRow(RECETTE_ROW, INGREDIENTS_ROWS);
  assert.deepEqual(recette.ingredients.map((i) => i.id), ["poulet", "riz", "creme"]);
  assert.equal(recette.id, "r1");
  assert.equal(recette.name, "Poulet riz crème");
  assert.equal(recette.slot, "lunch");
});

await test("3. les mappers ne MUTENT jamais leurs entrées", () => {
  const avantRecette = JSON.stringify(RECETTE_ROW);
  const avantIngrédients = JSON.stringify(INGREDIENTS_ROWS);
  const avantTags = JSON.stringify(TAGS_ROWS);
  const ordreAvant = INGREDIENTS_ROWS.map((i) => i.id).join(",");
  assembleRecipeWithTags(RECETTE_ROW, INGREDIENTS_ROWS, TAGS_ROWS);
  assert.equal(JSON.stringify(RECETTE_ROW), avantRecette);
  assert.equal(JSON.stringify(INGREDIENTS_ROWS), avantIngrédients);
  assert.equal(JSON.stringify(TAGS_ROWS), avantTags);
  assert.equal(INGREDIENTS_ROWS.map((i) => i.id).join(","), ordreAvant, "le tableau source n'est pas trié en place");
});

await test("4. ordre DÉTERMINISTE : deux mappings donnent le même résultat", () => {
  const a = mapRecipeRow(RECETTE_ROW, INGREDIENTS_ROWS);
  const b = mapRecipeRow(RECETTE_ROW, [...INGREDIENTS_ROWS].reverse());
  assert.deepEqual(a.ingredients.map((i) => i.id), b.ingredients.map((i) => i.id));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

await test("5. une ligne incohérente ÉCHOUE explicitement, jamais silencieusement", () => {
  const cas: [string, () => unknown, string][] = [
    ["rôle inconnu", () => mapRecipeIngredientRow({ ...INGREDIENTS_ROWS[1], role: "sauce" }), "invalid_role"],
    ["numérique illisible", () => mapRecipeIngredientRow({ ...INGREDIENTS_ROWS[1], protein_per_100g: "abc" }), "invalid_numeric"],
    ["numérique NaN", () => mapRecipeIngredientRow({ ...INGREDIENTS_ROWS[1], reference_grams: Number.NaN }), "invalid_numeric"],
    ["nom vide", () => mapRecipeIngredientRow({ ...INGREDIENTS_ROWS[1], name: "   " }), "invalid_ingredient_row"],
    ["créneau inconnu", () => mapRecipeRow({ ...RECETTE_ROW, slot_key: "brunch" }, []), "invalid_slot_key"],
    ["statut inconnu", () => mapRecipeRow({ ...RECETTE_ROW, status: "publie" }, []), "invalid_status"],
    ["ingrédient d'une autre recette", () => mapRecipeRow(RECETTE_ROW, [{ ...INGREDIENTS_ROWS[1], recipe_id: "r2" }]), "ingredient_recipe_mismatch"],
    ["étiquette hors vocabulaire", () => mapRecipeTagRow({ recipe_id: "r1", kind: "allergen", value: "cacahuete" }), "invalid_tag_value"],
    ["famille d'étiquette inconnue", () => mapRecipeTagRow({ recipe_id: "r1", kind: "humeur", value: "gluten" }), "invalid_tag_kind"],
  ];
  for (const [libellé, action, code] of cas) {
    assert.throws(action, (e: unknown) => {
      assert.ok(e instanceof RecipeMappingError, `${libellé} : RecipeMappingError attendue`);
      assert.equal((e as RecipeMappingError).code, code, libellé);
      return true;
    }, libellé);
  }
});

await test("6. le vocabulaire TypeScript et la contrainte SQL coïncident", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const kind of RECIPE_TAG_KINDS) {
    for (const valeur of RECIPE_TAG_VOCABULARY[kind]) {
      assert.ok(sql.includes(`'${valeur}'`), `${kind}/${valeur} doit figurer dans la contrainte SQL`);
    }
  }
  // Et réciproquement : aucune valeur SQL absente du vocabulaire TypeScript.
  const bloc = sql.slice(sql.indexOf("nutrition_recipe_tags_value_check"), sql.indexOf("create index if not exists nutrition_recipe_tags_kind_value_idx"));
  const valeursSql = [...bloc.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  const connues = new Set<string>([...RECIPE_TAG_KINDS, ...RECIPE_TAG_KINDS.flatMap((k) => RECIPE_TAG_VOCABULARY[k])]);
  for (const valeur of valeursSql) {
    assert.ok(connues.has(valeur), `« ${valeur} » est dans le SQL mais pas dans RECIPE_TAG_VOCABULARY`);
  }
});

await test("7. les créneaux et statuts TypeScript reflètent la contrainte SQL", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const slot of RECIPE_SLOT_KEYS) assert.ok(sql.includes(`'${slot}'`), slot);
  for (const statut of RECIPE_STATUSES) assert.ok(sql.includes(`'${statut}'`), statut);
  // Les six créneaux du modèle v2, à l'identique.
  assert.deepEqual([...RECIPE_SLOT_KEYS], [...MEAL_SLOT_KEYS]);
});

/* ═══════════════════ 2. Assemblage et lecture groupée ═══════════════════ */

await test("8. l'assemblage regroupe ingrédients et étiquettes par recette", () => {
  const r2: NutritionRecipeRow = { ...RECETTE_ROW, id: "r2", name: "Autre", slot_key: null };
  const résultat = assembler(
    [RECETTE_ROW, r2],
    [...INGREDIENTS_ROWS, { ...INGREDIENTS_ROWS[1], id: "x", recipe_id: "r2", position: 1 }],
    [...TAGS_ROWS, { recipe_id: "r2", kind: "diet", value: "vegan" }],
  );
  assert.equal(résultat.recipes.length, 2);
  assert.equal(résultat.invalid.length, 0);
  assert.equal(résultat.recipes[0].recipe.ingredients.length, 3);
  assert.equal(résultat.recipes[1].recipe.ingredients.length, 1);
  assert.deepEqual(résultat.recipes[1].tags, [{ kind: "diet", value: "vegan" }]);
  assert.equal(résultat.recipes[1].slotKey, null, "slot_key null = recette générique");
});

await test("9. une recette invalide est ISOLÉE, les autres restent lisibles", () => {
  const cassée: NutritionRecipeRow = { ...RECETTE_ROW, id: "r3", status: "publie" };
  const résultat = assembler([RECETTE_ROW, cassée], INGREDIENTS_ROWS, TAGS_ROWS);
  assert.equal(résultat.recipes.length, 1, "la recette saine passe");
  assert.equal(résultat.invalid.length, 1, "la recette cassée est signalée");
  assert.equal(résultat.invalid[0].recipeId, "r3");
  assert.equal(résultat.invalid[0].code, "invalid_status");
  assert.ok(résultat.invalid[0].message.length > 0, "la raison est lisible");
});

await test("10. la lecture est GROUPÉE : aucune requête par recette ni par ingrédient", () => {
  // Trois `.from(...)` au total dans le module : recettes, ingrédients, tags.
  const tables = [...COUCHE_LECTURE.matchAll(/\.from\((TABLE_[A-Z]+)\)/g)].map((m) => m[1]);
  assert.deepEqual(
    [...new Set(tables)].sort(),
    ["TABLE_INGREDIENTS", "TABLE_RECIPES", "TABLE_TAGS"],
    "exactement trois tables interrogées",
  );
  // Les enfants sont chargés par `in(...)`, jamais par `eq` dans une boucle.
  assert.ok(/\.in\("recipe_id", recipeIds as string\[\]\)/.test(COUCHE_LECTURE));
  assert.ok(!/for\s*\([^)]*\)\s*\{[\s\S]*?await supabase/.test(COUCHE_LECTURE), "aucun await dans une boucle");
  // Ordre déterministe explicite.
  assert.ok(COUCHE_LECTURE.includes('.order("position", { ascending: true })'));
  assert.ok(COUCHE_LECTURE.includes('.order("name", { ascending: true })'));
});

await test("11. AUCUN chemin d'écriture dans la couche de lecture", () => {
  for (const interdit of [".insert(", ".update(", ".delete(", ".upsert(", ".rpc("]) {
    assert.ok(!COUCHE_LECTURE.includes(interdit), `la PR A n'écrit pas : ${interdit} interdit`);
  }
});

/* ═══════════════════ 3. Cible depuis un créneau v2 ═══════════════════ */

await test("12. la cible d'un créneau vient bien du profil v2", () => {
  const résultat = buildRecipeTargetForMealSlot(PROFIL_V2, "lunch");
  assert.ok(résultat.ok, "le créneau lunch est actif");
  if (!résultat.ok) return;

  // Valeur attendue recalculée à la main depuis les sources de vérité.
  const quotidien = computeDailyMacroTargets({
    dailyCalories: 2400, proteinBp: 3000, carbBp: 4500, fatBp: 2500,
  });
  const attendu = computeMealDistribution(quotidien, PROFIL_V2.slots).slots.find((s) => s.slot === "lunch")!;
  assert.equal(résultat.target.proteinGrams, attendu.proteinGrams);
  assert.equal(résultat.target.carbGrams, attendu.carbGrams);
  assert.equal(résultat.target.fatGrams, attendu.fatGrams);
  assert.equal(résultat.calories, attendu.calories);
  // Grammes NON arrondis : 2400 × 3000/10000 / 4 × 2000/10000 = 36 g pile ici,
  // mais la garantie porte sur l'absence d'arrondi intermédiaire.
  assert.ok(Number.isFinite(résultat.target.proteinGrams));
});

await test("13. AUCUNE formule dupliquée : le module réutilise les fonctions existantes", () => {
  assert.ok(MATCHING.includes("computeDailyMacroTargets("), "réutilise computeDailyMacroTargets");
  assert.ok(MATCHING.includes("computeMealDistribution("), "réutilise computeMealDistribution");
  // Aucune arithmétique de points de base ni de kcal réécrite dans le calcul
  // de cible (la seule mention de 4/4/9 sert à réafficher une cible connue).
  const calcul = MATCHING.slice(0, MATCHING.indexOf("2. Filtrage par profil"));
  assert.ok(!/\/\s*10000/.test(calcul), "aucune division par 10 000 réécrite");
  assert.ok(!/KCAL_PER_GRAM/.test(calcul), "aucune conversion kcal réécrite");
});

await test("14. refus explicites : pas de calories, créneau désactivé, créneau absent", () => {
  const sansCalories = buildRecipeTargetForMealSlot({ ...PROFIL_V2, dailyCalories: 0 }, "lunch");
  assert.equal(sansCalories.ok, false);
  assert.equal(sansCalories.ok === false && sansCalories.reason, "no_calories");

  const désactivé = buildRecipeTargetForMealSlot(PROFIL_V2, "dessert");
  assert.equal(désactivé.ok, false);
  assert.equal(désactivé.ok === false && désactivé.reason, "slot_disabled");

  const absent = buildRecipeTargetForMealSlot({ ...PROFIL_V2, slots: [] }, "lunch");
  assert.equal(absent.ok, false);
  assert.equal(absent.ok === false && absent.reason, "slot_not_found");
});

/* ═══════════════════ 4. Filtrage par profil ═══════════════════ */

const CATALOGUE: RecipeWithTags[] = [
  recetteAvec("generique", null, "active", []),
  recetteAvec("midi", "lunch", "active", []),
  recetteAvec("matin", "breakfast", "active", []),
  recetteAvec("lait", "lunch", "active", [{ kind: "allergen", value: "milk" }]),
  recetteAvec("lactose", "lunch", "active", [{ kind: "intolerance", value: "lactose" }]),
  recetteAvec("vegetarienne", "lunch", "active", [{ kind: "diet", value: "vegetarian" }]),
  recetteAvec("porc", "lunch", "active", [{ kind: "excludes", value: "pork" }]),
  recetteAvec("brouillon", "lunch", "draft", []),
];

await test("15. profil ABSENT : toutes les recettes du créneau passent", () => {
  const gardées = keepMatchingRecipes(CATALOGUE, undefined, { slot: "lunch" }).map((r) => r.recipe.id);
  assert.deepEqual(gardées, ["generique", "midi", "lait", "lactose", "vegetarienne", "porc"]);
  assert.ok(!gardées.includes("matin"), "un autre créneau est écarté");
  assert.ok(!gardées.includes("brouillon"), "un brouillon n'est pas proposable");
});

await test("16. null et [] se comportent à l'IDENTIQUE", () => {
  const avecNull = keepMatchingRecipes(CATALOGUE, {
    allergens: null, intolerances: null, diets: null, excludes: null,
  }, { slot: "lunch" }).map((r) => r.recipe.id);
  const avecVides = keepMatchingRecipes(CATALOGUE, {
    allergens: [], intolerances: [], diets: [], excludes: [],
  }, { slot: "lunch" }).map((r) => r.recipe.id);
  const sansProfil = keepMatchingRecipes(CATALOGUE, null, { slot: "lunch" }).map((r) => r.recipe.id);
  assert.deepEqual(avecNull, avecVides);
  assert.deepEqual(avecNull, sansProfil);
  assert.equal(avecNull.length, 6, "un profil vide ne vide jamais la liste");
});

await test("17. filtre par ALLERGÈNE", () => {
  const résultats = filterRecipesForProfile(CATALOGUE, { allergens: ["milk"] }, { slot: "lunch" });
  const rejetée = résultats.find((r) => r.recipe.recipe.id === "lait");
  assert.equal(rejetée?.kept, false);
  assert.equal(rejetée?.reason, "allergen");
  assert.equal(rejetée?.detail, "milk");
  assert.ok(résultats.find((r) => r.recipe.recipe.id === "midi")?.kept, "les autres passent");
});

await test("18. filtre par INTOLÉRANCE", () => {
  const gardées = keepMatchingRecipes(CATALOGUE, { intolerances: ["lactose"] }, { slot: "lunch" });
  assert.ok(!gardées.some((r) => r.recipe.id === "lactose"));
  assert.ok(gardées.some((r) => r.recipe.id === "lait"), "un allergène n'est pas une intolérance");
});

await test("19. filtre par RÉGIME — sémantique inverse, la recette doit le PORTER", () => {
  const gardées = keepMatchingRecipes(CATALOGUE, { diets: ["vegetarian"] }, { slot: "lunch" }).map((r) => r.recipe.id);
  assert.deepEqual(gardées, ["vegetarienne"], "seule la recette étiquetée végétarienne est conservée");
  const rejet = filterRecipesForProfile(CATALOGUE, { diets: ["vegetarian"] }, { slot: "lunch" })
    .find((r) => r.recipe.recipe.id === "midi");
  assert.equal(rejet?.reason, "diet");
});

await test("20. filtre par EXCLUSION de catégorie", () => {
  const gardées = keepMatchingRecipes(CATALOGUE, { excludes: ["pork"] }, { slot: "lunch" }).map((r) => r.recipe.id);
  assert.ok(!gardées.includes("porc"));
  assert.equal(gardées.length, 5);
});

await test("21. recette GÉNÉRIQUE : compatible avec tout créneau", () => {
  for (const slot of MEAL_SLOT_KEYS) {
    const gardées = keepMatchingRecipes(CATALOGUE, null, { slot }).map((r) => r.recipe.id);
    assert.ok(gardées.includes("generique"), `générique attendue sur ${slot}`);
  }
});

await test("22. créneau INCOMPATIBLE : la recette est écartée avec sa raison", () => {
  const résultat = filterRecipesForProfile(CATALOGUE, null, { slot: "breakfast" })
    .find((r) => r.recipe.recipe.id === "midi");
  assert.equal(résultat?.kept, false);
  assert.equal(résultat?.reason, "slot_mismatch");
  assert.equal(résultat?.detail, "lunch");
});

await test("23. une clé de contrainte HORS vocabulaire bloque, jamais ne s'ignore", () => {
  // « peanuts » au pluriel n'existe pas dans le vocabulaire : l'ignorer
  // reviendrait à servir un plat contenant des arachides.
  const résultats = filterRecipesForProfile(CATALOGUE, { allergens: ["peanuts"] }, { slot: "lunch" });
  assert.ok(résultats.every((r) => !r.kept), "aucune recette proposée sur une contrainte illisible");
  assert.equal(résultats[0].reason, "unknown_constraint_key");
  assert.ok(résultats[0].detail?.includes("allergen/peanuts"));
});

await test("24. JAMAIS de comparaison de texte libre à un nom d'ingrédient", () => {
  // Garde structurelle : le module ne lit aucun champ de student_profiles et
  // ne compare aucun nom d'ingrédient à une contrainte.
  const code = sansCommentairesTs(MATCHING);
  for (const interdit of ["disliked_foods", "allergies", "food_preferences", "ingredient\\.name", "\\.name\\.toLowerCase", "includes\\(ingredient"]) {
    assert.ok(!new RegExp(interdit).test(code), `comparaison interdite : ${interdit}`);
  }
  assert.ok(MATCHING.includes("RECIPE_TAG_VOCABULARY"), "le filtrage travaille sur le vocabulaire contrôlé");
});

await test("25. le filtrage est DÉTERMINISTE et ne mute rien", () => {
  const avant = JSON.stringify(CATALOGUE);
  const a = keepMatchingRecipes(CATALOGUE, { allergens: ["milk"] }, { slot: "lunch" }).map((r) => r.recipe.id);
  const b = keepMatchingRecipes(CATALOGUE, { allergens: ["milk"] }, { slot: "lunch" }).map((r) => r.recipe.id);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(CATALOGUE), avant, "le catalogue n'est jamais muté");
  assert.deepEqual(a, ["generique", "midi", "lactose", "vegetarienne", "porc"], "ordre d'entrée conservé");
});

/* ═══════════════════ 5. Description des écarts ═══════════════════ */

await test("26. EXACT : proposé, sans détail d'écart", () => {
  const cible = { proteinGrams: 35, carbGrams: 77, fatGrams: 3.2 };
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: cible });
  const fit = describeRecipeFit(solution);
  assert.equal(fit.status, solution.status);
  if (solution.status === "exact") {
    assert.equal(fit.proposable, true);
    assert.deepEqual(fit.details, []);
    assert.ok(fit.summary.includes("exactement"));
    assert.equal(fit.mainReason, null);
  }
});

await test("27. APPROXIMATE : proposé AVEC les écarts P/G/L et les kcal", () => {
  // Une cible que le plafond de crème ne laisse pas atteindre exactement.
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, {
    target: { proteinGrams: 40, carbGrams: 80, fatGrams: 40 },
  });
  const fit = describeRecipeFit(solution);
  assert.equal(fit.status, solution.status);
  if (solution.status === "approximate") {
    assert.equal(fit.proposable, true);
    assert.ok(fit.summary.includes("approche"));
    assert.ok(/kcal/.test(fit.summary), "les kcal calculées et visées sont dites");
    assert.ok(fit.details.length > 0, "au moins un écart est détaillé");
    assert.ok(fit.details.every((d) => /^(protéines|glucides|lipides) [+-]?\d+/.test(d)), fit.details.join(" | "));
  }
});

await test("28. IMPOSSIBLE : exclu des propositions, mais exploitable en interne", () => {
  const solution = solveRecipe(RECETTE_MAXIMUM, {
    target: { proteinGrams: 400, carbGrams: 400, fatGrams: 400 },
  });
  assert.equal(solution.status, "impossible");
  const fit = describeRecipeFit(solution);
  assert.equal(fit.proposable, false, "jamais proposé à l'élève");
  assert.ok(typeof fit.mainReason === "string" && fit.mainReason.length > 0, "raison principale disponible");
  assert.ok(/^(bound_(min|max):|macro_gap:)/.test(fit.mainReason!), fit.mainReason!);
  assert.ok(fit.summary.length > 0, "et une phrase reste disponible pour l'aperçu admin");
});

await test("29. les phrases sont déterministes et sans texte médical", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: { proteinGrams: 40, carbGrams: 80, fatGrams: 40 } });
  const a = describeRecipeFit(solution);
  const b = describeRecipeFit(solution);
  assert.deepEqual(a, b);
  const interdits = /santé|maladie|carence|régime amaigrissant|traitement|médic|diagnostic/i;
  assert.ok(!interdits.test(a.summary), a.summary);
});

/* ═══════════════════ 6. Garanties structurelles ═══════════════════ */

await test("30. AUCUNE RecipeSolution ne peut devenir une recette canonique", () => {
  // 1. Aucune fonction ne prend une RecipeSolution en entrée pour produire
  //    une Recipe, une ligne ou une charge utile d'écriture.
  const rows = sansCommentairesTs(ROWS);
  const lecture = sansCommentairesTs(COUCHE_LECTURE);
  assert.ok(!/RecipeSolution/.test(rows), "recipe-rows.ts n'importe ni ne manipule RecipeSolution");
  assert.ok(!/SolvedIngredient/.test(rows), "ni SolvedIngredient");
  assert.ok(!/RecipeSolution/.test(lecture), "la couche de lecture non plus");
  assert.ok(!/SolvedIngredient/.test(lecture), "ni SolvedIngredient");
  // 2. La charge utile d'écriture prend un RecipeIngredient — pas un résultat.
  const payload = buildRecipeIngredientInsertPayload("r1", RECETTE_SIMPLE_PGL.ingredients[0], 1);
  assert.equal(payload.reference_grams, RECETTE_SIMPLE_PGL.ingredients[0].referenceGrams);
  assert.ok(!("grams" in payload), "aucune quantité calculée dans la charge utile");
  assert.ok(!("displayGrams" in payload), "ni de quantité d'affichage");
  // 3. Aucune table ne peut recevoir une portion calculée.
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(!/solved|portion|serving_grams|computed_grams/i.test(sql), "aucune table de portion calculée");
});

await test("31. la migration est ADDITIVE et ne touche à rien d'existant", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const motif of [/\bdrop table\b/i, /\balter table public\.nutrition_plans\b/i,
                       /\bdelete\s+from\b/i, /\btruncate\b/i, /\bupdate\s+public\./i]) {
    assert.ok(!motif.test(sql), `la migration ne doit pas contenir : ${motif}`);
  }
  // Aucune donnée insérée : ni fixture, ni recette de démonstration.
  assert.ok(!/\binsert\s+into\b/i.test(sql), "aucune donnée insérée par la migration");
  // Les trois tables attendues, et elles seules.
  const tables = [...sql.matchAll(/create table if not exists public\.([a-z_]+)/g)].map((m) => m[1]);
  assert.deepEqual(tables.sort(), [
    "nutrition_recipe_ingredients", "nutrition_recipe_tags", "nutrition_recipes",
  ]);
});

await test("32. sécurité : RLS, privilèges minimaux, aucun TRUNCATE pour authenticated", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const table of ["nutrition_recipes", "nutrition_recipe_ingredients", "nutrition_recipe_tags"]) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security;`), `RLS ${table}`);
    assert.ok(sql.includes(`revoke all on table public.${table} from public;`), `revoke public ${table}`);
    assert.ok(sql.includes(`revoke all on table public.${table} from anon;`), `revoke anon ${table}`);
    // LE point : sans ce revoke, les privilèges par défaut Supabase laissent
    // TRUNCATE à authenticated, et TRUNCATE contourne la RLS.
    assert.ok(sql.includes(`revoke all on table public.${table} from authenticated;`), `revoke authenticated ${table}`);
    assert.ok(sql.includes(`grant select, insert, update, delete on table public.${table} to authenticated;`), `grant minimal ${table}`);
    assert.ok(!new RegExp(`grant all on table public\\.${table} to authenticated`).test(sql), `jamais grant all à authenticated (${table})`);
  }
  // Le revoke authenticated précède le grant, sinon il l'annulerait.
  assert.ok(
    sql.indexOf("revoke all on table public.nutrition_recipes from authenticated;")
      < sql.indexOf("grant select, insert, update, delete on table public.nutrition_recipes to authenticated;"),
    "le revoke doit précéder le grant",
  );
  // Aucune fonction security definer, search_path verrouillé.
  assert.ok(!/security definer/i.test(sql), "aucune fonction security definer");
  assert.ok(sql.includes("security invoker"), "la fonction de validation est security invoker");
  assert.ok(sql.includes("set search_path = ''"), "search_path verrouillé");
  assert.ok(sql.includes("owner to postgres"), "propriétaire postgres");
  assert.ok(sql.includes("revoke execute on function public.nutrition_recipe_blocking_issue(uuid) from anon;"));
  assert.ok(sql.includes("revoke all on function public.nutrition_recipe_blocking_issue(uuid) from public;"));
  assert.ok(sql.includes("grant execute on function public.nutrition_recipe_blocking_issue(uuid) to authenticated;"));
});

await test("33. aucune policy de lecture élève — décision explicite et documentée", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(!/current_student_id\(\)/.test(sql), "aucune policy élève sur les recettes");
  const policies = [...sql.matchAll(/create policy "([a-z_]+)"/g)].map((m) => m[1]);
  assert.deepEqual(policies.sort(), [
    "nutrition_recipe_ingredients_manage_staff",
    "nutrition_recipe_tags_manage_staff",
    "nutrition_recipes_manage_staff",
  ]);
  // Et la raison est écrite dans l'en-tête, pas seulement dans une PR.
  assert.ok(MIGRATION.includes("LECTURE ÉLÈVE VOLONTAIREMENT ABSENTE"));
});

await test("34. la fonction de validation ne fait AUCUNE écriture", () => {
  const corps = MIGRATION.slice(MIGRATION.indexOf("function public.nutrition_recipe_blocking_issue"));
  const sansCom = sansCommentairesSql(corps);
  for (const motif of [/\binsert\s+into\b/i, /\bupdate\s+public\./i, /\bdelete\s+from\b/i]) {
    assert.ok(!motif.test(sansCom), `aucune écriture : ${motif}`);
  }
  assert.ok(/^stable$/m.test(sansCom.split("\n").map((l) => l.trim()).join("\n")), "déclarée stable");
});

await test("35. les codes de blocage SQL sont tous couverts par la checklist", () => {
  const corps = MIGRATION.slice(MIGRATION.indexOf("function public.nutrition_recipe_blocking_issue"));
  const codes = [...corps.matchAll(/return '([a-z_]+)';/g)].map((m) => m[1]);
  assert.ok(codes.length >= 10, `au moins 10 codes attendus, ${codes.length} trouvés`);
  for (const code of new Set(codes)) {
    assert.ok(CHECKLIST.includes(code), `la checklist doit exercer le code ${code}`);
  }
});

/* ═══════════════════ 7. Non-régression v1 et v2 ═══════════════════ */

await test("36. la migration des recettes est ADDITIVE et ne touche aucune table de plan", () => {
  // FORMULATION CORRIGÉE (PR C.1). Ce contrôle s'intitulait « le modèle v1 est
  // TOTALEMENT inchangé ». C'est devenu faux : la PR C a intégré
  // `nutrition_days` et `meals` au modèle v2 (colonne `profile_key` NOT NULL,
  // clé étrangère composite vers `nutrition_plan_profiles`), et la PR C.1 a
  // supprimé le chemin d'écriture v1 qui les alimentait.
  //
  // La garantie réellement utile n'a pas disparu pour autant, et c'est elle
  // qui est vérifiée ici : la migration fondatrice des recettes
  // (20260807090000) reste STRICTEMENT ADDITIVE. Elle crée ses trois tables
  // et ne supprime, n'altère ni ne réécrit aucune des tables de plan — y
  // compris `nutrition_days` et `meals`, désormais portées par le v2. Les
  // assertions sont inchangées ; seul leur énoncé l'est.
  const sql = sansCommentairesSql(MIGRATION);
  for (const table of ["nutrition_days", "meals", "nutrition_daily_logs", "nutrition_plans"]) {
    assert.ok(!new RegExp(`(alter|drop|insert into|update|delete from)\\s+(table\\s+)?public\\.${table}\\b`, "i").test(sql),
      `la migration ne touche pas ${table}`);
  }
  // Et la séparation des domaines tient dans l'autre sens : le socle recettes
  // ne lit ni n'écrit les journées et les repas prescrits (« Outil 3 »), qui
  // ne sont écrits que par la RPC `save_nutrition_plan_v2`.
  assert.ok(!/nutrition_days|meals/.test(COUCHE_LECTURE), "la couche recettes ne touche ni aux journées ni aux repas");
  assert.ok(!/nutrition_days|meals/.test(MATCHING), "le matching non plus");
});

await test("37. les recettes sont réservées au modèle v2", () => {
  // La cible ne peut venir que d'un profil v2 : le type l'impose, et aucune
  // dérivation depuis daily_target n'existe.
  assert.ok(MATCHING.includes("NutritionPlanV2Profile"), "la cible part d'un profil v2");
  assert.ok(!/daily_target|dailyTarget/.test(MATCHING), "aucune dérivation depuis le daily_target v1");
});

await test("38. les 11 fixtures ne sont JAMAIS insérées en base", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(!/\binsert\s+into\b/i.test(sql), "la migration n'insère aucune donnée");
  assert.ok(!/fixtures/i.test(sansCommentairesTs(COUCHE_LECTURE)), "la couche de lecture ne connaît pas les fixtures");
  // Elles restent utilisables comme fixtures de test — c'est leur seul rôle.
  const recette: Recipe = RECETTE_SIMPLE_PGL;
  assert.equal(recette.ingredients.length, 5);
});

await test("39. la migration est déclarée au manifeste et comptée", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 33);
  assert.ok(attendues.includes("20260807090000_nutrition_recipes.sql"));
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 60,"), "le compteur de migrations suit les migrations réelles");
  assert.ok(secu.includes("assert.equal(attendues.length, 33);"));
});

await test("40. la checklist PostgreSQL couvre le périmètre exigé", () => {
  for (const attendu of [
    "rollback;",
    "nutrition_recipes",
    "nutrition_recipe_ingredients",
    "nutrition_recipe_tags",
    "nutrition_recipe_blocking_issue",
    "has_table_privilege('authenticated'",
    "TRUNCATE",
    "is_coach_or_admin",
    "aucune donnée de test persistante",
  ]) {
    assert.ok(CHECKLIST.includes(attendu), `la checklist doit couvrir : ${attendu}`);
  }
  assert.ok(/^rollback;$/m.test(CHECKLIST), "elle se termine par un ROLLBACK");
  assert.ok(CHECKLIST.indexOf("begin;") < CHECKLIST.indexOf("\nrollback;"), "tout tient dans une transaction");
});

/* ─── 41-45. Adaptateur de ligne d'ingrédient (PR C.1) ─────────────────── */

/**
 * Ligne BRUTE de référence, telle que PostgREST la rend réellement : les
 * `numeric` en chaînes, les colonnes nullables présentes et à `null`. Elle
 * n'est PAS typée `NutritionRecipeIngredientRow` — c'est justement ce que
 * l'adaptateur doit établir, on ne peut pas le présupposer.
 */
const LIGNE_VALIDE = {
  id: "i1",
  recipe_id: "r1",
  position: 1,
  name: "Blanc de poulet",
  role: "protein",
  protein_per_100g: "23",
  carb_per_100g: "0",
  fat_per_100g: "1.5",
  reference_grams: "120",
  min_grams: null,
  max_grams: null,
  unit_scalable: false,
  max_units: null,
  unit_name: null,
  fixed_label: null,
  egg: false,
  egg_grams: null,
  linked_to_ingredient_id: null,
  link_ratio_bp: null,
};

await test("41. la lecture d'ingrédients n'affirme plus aucun type", () => {
  const code = sansCommentairesTs(COUCHE_LECTURE);
  assert.ok(
    !/as\s+NutritionRecipeIngredientRow\[\]/.test(code),
    "le cast aveugle `data as NutritionRecipeIngredientRow[]` doit avoir disparu",
  );
  assert.ok(code.includes("toNutritionRecipeIngredientRow"), "la projection explicite doit être utilisée");
  // Aucune échappatoire de typage sur ce chemin.
  assert.ok(!/@ts-(ignore|expect-error|nocheck)/.test(COUCHE_LECTURE), "aucune directive @ts-* ");
  assert.ok(!/as\s+unknown\s+as\s+NutritionRecipeIngredientRow/.test(code), "aucun double cast");
  const adaptateur = sansCommentairesTs(ROWS).slice(
    sansCommentairesTs(ROWS).indexOf("export function toNutritionRecipeIngredientRow"),
  );
  assert.ok(!/\bany\b/.test(adaptateur.slice(0, adaptateur.indexOf("export function mapRecipeIngredientRow"))),
    "l'adaptateur n'utilise aucun `any`");
});

await test("42. la lecture conserve EXACTEMENT ses 20 colonnes et son ordre", () => {
  // Les colonnes et l'ordre sont une garantie fonctionnelle : le solveur
  // attribue les unités entières dans l'ordre reçu.
  for (const colonne of [
    "id", "recipe_id", "position", "name", "role",
    "protein_per_100g", "carb_per_100g", "fat_per_100g", "reference_grams",
    "min_grams", "max_grams", "unit_scalable", "max_units", "unit_name",
    "fixed_label", "egg", "egg_grams", "linked_to_ingredient_id", "link_ratio_bp",
  ]) {
    assert.ok(COUCHE_LECTURE.includes(colonne), `colonne perdue : ${colonne}`);
  }
  assert.ok(COUCHE_LECTURE.includes(`.order("recipe_id", { ascending: true })`));
  assert.ok(COUCHE_LECTURE.includes(`.order("position", { ascending: true })`));
});

await test("43. l'adaptateur recopie une ligne conforme à l'identique", () => {
  // Cas réel PostgREST : les `numeric` arrivent en chaînes, et elles doivent
  // ressortir en chaînes — c'est `toNumber` qui convertit, pas l'adaptateur.
  const brute = {
    id: "i1",
    recipe_id: "r1",
    position: 2,
    name: "Riz basmati",
    role: "carbohydrate",
    protein_per_100g: "7.5",
    carb_per_100g: "78.2",
    fat_per_100g: "0.6",
    reference_grams: "80",
    min_grams: "40",
    max_grams: null,
    unit_scalable: false,
    max_units: null,
    unit_name: null,
    fixed_label: null,
    egg: false,
    egg_grams: null,
    linked_to_ingredient_id: null,
    link_ratio_bp: null,
  };
  const adaptée = toNutritionRecipeIngredientRow(brute);
  assert.deepEqual({ ...adaptée }, brute, "aucune valeur ne doit être transformée");
  // Et elle traverse le mapper du domaine sans perte.
  const ingrédient = mapRecipeIngredientRow(adaptée);
  assert.equal(ingrédient.proteinPer100g, 7.5);
  assert.equal(ingrédient.referenceGrams, 80);
  assert.equal(ingrédient.minGrams, 40);
  assert.equal(ingrédient.maxGrams, null);
});

await test("44. l'adaptateur ne lève JAMAIS et laisse le mapper juger", () => {
  // Une ligne aberrante ne doit pas faire échouer la lecture du catalogue :
  // elle doit produire la MÊME RecipeMappingError qu'avant, en aval.
  const cas: { ligne: unknown; code: string }[] = [
    { ligne: {}, code: "invalid_ingredient_row" },
    { ligne: null, code: "invalid_ingredient_row" },
    { ligne: { ...LIGNE_VALIDE, id: 42 }, code: "invalid_ingredient_row" },
    { ligne: { ...LIGNE_VALIDE, name: "   " }, code: "invalid_ingredient_row" },
    { ligne: { ...LIGNE_VALIDE, role: "sucre" }, code: "invalid_role" },
    { ligne: { ...LIGNE_VALIDE, role: 3 }, code: "invalid_role" },
    { ligne: { ...LIGNE_VALIDE, protein_per_100g: null }, code: "invalid_numeric" },
    { ligne: { ...LIGNE_VALIDE, reference_grams: {} }, code: "invalid_numeric" },
    { ligne: { ...LIGNE_VALIDE, min_grams: "abc" }, code: "invalid_numeric" },
  ];
  for (const { ligne, code } of cas) {
    const adaptée = toNutritionRecipeIngredientRow(ligne); // ne doit pas lever
    assert.throws(
      () => mapRecipeIngredientRow(adaptée),
      (erreur: unknown) =>
        erreur instanceof RecipeMappingError && erreur.code === code,
      `attendu ${code} pour ${JSON.stringify(ligne)}`,
    );
  }
  // Les booléens sont projetés par le même test que le mapper : identité.
  for (const valeur of [true, false, null, undefined, 1, "true", {}]) {
    const adaptée = toNutritionRecipeIngredientRow({ ...LIGNE_VALIDE, unit_scalable: valeur, egg: valeur });
    assert.equal(adaptée.unit_scalable, valeur === true);
    assert.equal(adaptée.egg, valeur === true);
  }
});

await test("45. une recette invalide reste isolée, le catalogue reste lisible", () => {
  // Comportement d'erreur INCHANGÉ : l'assemblage isole la recette fautive
  // au lieu de vider le catalogue — c'est ce que l'ancien cast permettait
  // déjà, et l'adaptateur ne doit pas l'avoir changé.
  const lignesBrutes: unknown[] = [
    { ...LIGNE_VALIDE, id: "ok1", recipe_id: "r1", position: 1 },
    { ...LIGNE_VALIDE, id: "ko1", recipe_id: "r2", position: 1, role: "sucre" },
  ];
  const adaptées = lignesBrutes.map(toNutritionRecipeIngredientRow);
  const résultat = assembler(
    [
      { ...RECETTE_ROW, id: "r1", name: "Recette saine" },
      { ...RECETTE_ROW, id: "r2", name: "Recette cassée" },
    ],
    adaptées,
    [],
  );
  assert.equal(résultat.recipes.length, 1);
  assert.equal(résultat.recipes[0].recipe.id, "r1");
  assert.equal(résultat.invalid.length, 1);
  assert.equal(résultat.invalid[0].recipeId, "r2");
  assert.equal(résultat.invalid[0].code, "invalid_role");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
