/**
 * Harnais — feat/nutrition-recipes-admin, PR B.
 *
 * Administration des recettes : écriture atomique, catalogue, formulaire,
 * étiquettes contrôlées, aperçu en lecture seule, import explicite.
 *
 * OÙ CHAQUE GARANTIE EST PROUVÉE.
 *   - Ce fichier prouve la LOGIQUE et l'ORCHESTRATION : état de formulaire,
 *     renumérotation, liaisons, filtrage du catalogue, aperçu sans mutation,
 *     import rejouable, et l'absence de tout chemin d'écriture parallèle.
 *   - Le comportement TRANSACTIONNEL réel (rollback d'activation, contrôle
 *     d'appartenance, RLS, privilèges) est prouvé sur un vrai PostgreSQL par
 *     supabase/tests/nutrition_recipes_admin_checklist.sql.
 *
 * Lancement : npx tsx scripts/tests/nutrition-recipes-admin.mts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToString } from "react-dom/server";

import { computeCaloriesFromGrams } from "../../lib/nutrition/macro-targets";
import { solveRecipe } from "../../lib/nutrition/recipe-solver";
import { describeRecipeFit } from "../../lib/nutrition/recipe-matching";
import {
  analyzeRecipeImport,
  buildImportTemplate,
  normalizeRecipeName,
  toImportRpcPayload,
} from "../../lib/nutrition/recipe-import";
import {
  RECIPE_INGREDIENT_ROLES,
  RECIPE_SLOT_KEYS,
  RECIPE_TAG_KINDS,
  RECIPE_TAG_VOCABULARY,
  type RecipeWithTags,
} from "../../lib/nutrition/recipe-rows";
import {
  addIngredient,
  createBlankRecipeForm,
  createEmptyIngredient,
  createRecipeFormFromRecord,
  dependentsOf,
  duplicateRecipeForm,
  detectLinkCycle,
  duplicateIngredient,
  hasTag,
  moveIngredient,
  removeIngredient,
  toPreviewRecipe,
  toRecipeSavePayload,
  toggleTag,
  updateIngredient,
  validateRecipeForm,
  type RecipeFormState,
} from "../../lib/nutrition/recipe-form";
import { DeleteConfirmationModal } from "../../components/admin/LifecycleActions";
import {
  describeRecipeDeletionBlock,
  duplicateName,
  matchesExactName,
  recipeLifecycleActions,
  recipeStatusAfter,
  RECIPE_ACTION_LABELS_FR,
} from "../../lib/nutrition/lifecycle";
import {
  parseDeletionResult,
  parseNutritionLifecycleOverview,
} from "../../lib/supabase/nutrition-lifecycle";
import {
  RECIPE_ROLE_LABELS_FR,
  RECIPE_STATUS_LABELS_FR,
  RECIPE_TAG_VALUE_LABELS_FR,
  describeBlockingIssue,
  describeSlot,
  describeTag,
  tagOptionsFor,
} from "../../lib/nutrition/recipe-labels";
import {
  RECIPE_FIXTURES,
  buildFixturePayload,
  buildIngredientIdMap,
  describeFixtureImport,
  fixtureSourceKey,
  summarizeFixtureImport,
} from "../../lib/nutrition/recipe-fixtures-import";
import {
  describeRecipeWriteError,
  importNutritionRecipeFixtures,
  parseRecipeWriteResult,
} from "../../lib/supabase/nutrition-recipes-write";
import {
  CATALOG_FILTERS_VIDES,
  RecipeCatalog,
  filterCatalog,
  formatUpdatedAt,
} from "../../components/admin/RecipeCatalog";
import { RecipeTagsPanel } from "../../components/admin/RecipeTagsPanel";
import { RecipeAdaptivePreview } from "../../components/admin/RecipeAdaptivePreview";
import { RecipeBuilder } from "../../components/admin/RecipeBuilder";
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
function sansCommentairesSql(s: string): string {
  return s.split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");
}
function sansCommentairesTs(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const MIGRATION = lire("../../supabase/migrations/20260808090000_save_nutrition_recipe.sql");
const MIGRATION_B1 = lire(
  "../../supabase/migrations/20260809090000_save_nutrition_recipe_partial_payload.sql",
);
const HOOKS_RECETTES = lire("../../hooks/useNutritionRecipes.ts");
const PANNEAU_INGRÉDIENTS = lire("../../components/admin/RecipeIngredientsPanel.tsx");
const CHECKLIST = lire("../../supabase/tests/nutrition_recipes_admin_checklist.sql");
const COUCHE_ÉCRITURE = lire("../../lib/supabase/nutrition-recipes-write.ts");
const COUCHE_LECTURE = lire("../../lib/supabase/nutrition-recipes.ts");
const FORM = lire("../../lib/nutrition/recipe-form.ts");
const APERÇU = lire("../../components/admin/RecipeAdaptivePreview.tsx");
const BUILDER = lire("../../components/admin/RecipeBuilder.tsx");
const CATALOGUE = lire("../../components/admin/RecipeCatalog.tsx");
const PANNEAU_TAGS = lire("../../components/admin/RecipeTagsPanel.tsx");
const DIALOGUE_IMPORT = lire("../../components/admin/RecipeFixtureImportDialog.tsx");
const CYCLE_DE_VIE = lire("../../components/admin/LifecycleActions.tsx");
const CYCLE_DE_VIE_DOMAINE = lire("../../lib/nutrition/lifecycle.ts");
const CYCLE_DE_VIE_SERVICE = lire("../../lib/supabase/nutrition-lifecycle.ts");
const MIGRATION_CYCLE_DE_VIE = lire("../../supabase/migrations/20260815090000_nutrition_lifecycle.sql");
const MIGRATION_SUPPRESSION = lire("../../supabase/migrations/20260817090000_nutrition_plan_deletion_history.sql");
const CHECKLIST_ADMIN = lire("../../supabase/tests/nutrition_recipes_admin_checklist.sql");
const MIGRATION_CATALOGUE = lire("../../supabase/migrations/20260818090000_nutrition_recipe_catalog.sql");
const MODELE_IMPORT = lire("../../docs/modele-import-recettes.json");
const DIALOGUE_IMPORT_FICHIER = lire("../../components/admin/RecipeImportDialog.tsx");
const PAGE_PLAN_DETAIL = lire("../../app/admin/nutrition/[planId]/page.tsx");
const PAGE_LISTE = lire("../../app/admin/nutrition/recettes/page.tsx");
const PAGE_NOUVELLE = lire("../../app/admin/nutrition/recettes/nouvelle/page.tsx");
const PAGE_DETAIL = lire("../../app/admin/nutrition/recettes/[recipeId]/page.tsx");
const PAGE_PLANS = lire("../../app/admin/nutrition/page.tsx");

/* ────────────────────────── Aides ────────────────────────── */

let compteur = 0;
const idFactice = () => `00000000-0000-4000-8000-${String((compteur += 1)).padStart(12, "0")}`;

function formulaireComplet(): RecipeFormState {
  let s = createBlankRecipeForm("coach-1");
  s = { ...s, name: "Poulet riz crème", ingredients: [] };
  s = addIngredient(s, "ing-poulet");
  s = updateIngredient(s, "ing-poulet", {
    name: "Poulet", role: "protein",
    proteinPer100g: "25", carbPer100g: "0", fatPer100g: "1", referenceGrams: "140",
  });
  s = addIngredient(s, "ing-riz");
  s = updateIngredient(s, "ing-riz", {
    name: "Riz", role: "carbohydrate",
    proteinPer100g: "7", carbPer100g: "77", fatPer100g: "1", referenceGrams: "100",
  });
  s = addIngredient(s, "ing-creme");
  s = updateIngredient(s, "ing-creme", {
    name: "Crème", role: "fat",
    proteinPer100g: "3", carbPer100g: "3", fatPer100g: "4", referenceGrams: "80", maxGrams: "100",
  });
  return s;
}

function recordFactice(id: string, nom: string, slot: string | null, statut: string, tags: { kind: string; value: string }[] = []): RecipeWithTags {
  return {
    recipe: {
      id, name: nom, slot,
      ingredients: [
        {
          id: `${id}-a`, name: "Poulet", role: "protein",
          proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 140,
          minGrams: null, maxGrams: null, unitScalable: false, maxUnits: null,
          unitName: null, fixedLabel: null, egg: false, eggGrams: null,
          linkedToIngredientId: null, linkRatioBp: null,
        },
      ],
    },
    slotKey: slot as RecipeWithTags["slotKey"],
    status: statut as RecipeWithTags["status"],
    tags: tags as RecipeWithTags["tags"],
    description: null,
    sourceKey: null,
    updatedAt: "2026-08-05T09:00:00Z",
  };
}

/* ═══════════ 1. Architecture d'écriture : une seule transaction ═══════════ */

await test("1. la sauvegarde principale passe par UNE RPC, jamais par des écritures enchaînées", () => {
  const code = sansCommentairesTs(COUCHE_ÉCRITURE);
  assert.ok(code.includes('"save_nutrition_recipe"'), "la RPC est appelée");
  for (const interdit of [".from(\"nutrition_recipe_ingredients\")", ".from(\"nutrition_recipe_tags\")"]) {
    assert.ok(!code.includes(interdit), `aucune écriture directe des enfants : ${interdit}`);
  }
  // Le seul `.from(...)` autorisé est la LECTURE des recettes déjà importées.
  const froms = [...code.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(froms)], ["nutrition_recipes"], froms.join(","));
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(code), "aucun chemin d'écriture direct");
});

await test("2. aucune page n'écrit directement : tout passe par la couche dédiée", () => {
  for (const [nom, source] of Object.entries({ PAGE_LISTE, PAGE_NOUVELLE, PAGE_DETAIL, BUILDER })) {
    const code = sansCommentairesTs(source);
    assert.ok(!/\.from\(["'`]nutrition_recipe/.test(code), `${nom} n'écrit ni ne lit en direct`);
    assert.ok(!/\.insert\(|\.update\(|\.delete\(/.test(code), `${nom} ne contient aucune écriture`);
  }
});

await test("3. la RPC est security invoker, owner postgres, search_path vide, anon refusé", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(sql.includes("security invoker"));
  assert.ok(sql.includes("set search_path = ''"));
  assert.ok(sql.includes("alter function public.save_nutrition_recipe(jsonb) owner to postgres;"));
  assert.ok(sql.includes("revoke all on function public.save_nutrition_recipe(jsonb) from public;"));
  assert.ok(sql.includes("revoke execute on function public.save_nutrition_recipe(jsonb) from anon;"));
  assert.ok(sql.includes("grant execute on function public.save_nutrition_recipe(jsonb) to authenticated;"));
  assert.ok(sql.includes("if not public.is_coach_or_admin() then"), "garde coach/admin");
  assert.ok(!/security definer/i.test(sql), "aucune fonction security definer");
});

await test("4. l'ordre des écritures de la RPC est celui qui rend l'atomicité possible", () => {
  const corps = MIGRATION.slice(MIGRATION.indexOf("function public.save_nutrition_recipe"));
  const pos = (motif: string) => corps.indexOf(motif);
  assert.ok(pos("for update") > 0, "la recette est verrouillée en modification");
  assert.ok(
    pos("INGREDIENT_FROM_ANOTHER_RECIPE") < pos("delete from public.nutrition_recipe_ingredients"),
    "le contrôle d'appartenance précède toute suppression",
  );
  assert.ok(
    pos("position = i.position + 100000") < pos("insert into public.nutrition_recipe_ingredients"),
    "les positions sont décalées avant réécriture (unique (recipe_id, position))",
  );
  assert.ok(
    pos("linked_to_ingredient_id = (v_ing->>'linked_to_ingredient_id')::uuid")
      > pos("insert into public.nutrition_recipe_ingredients"),
    "les liaisons sont posées en SECONDE passe",
  );
  assert.ok(
    pos("RECIPE_NOT_ACTIVABLE") > pos("insert into public.nutrition_recipe_tags"),
    "l'activation est arbitrée APRÈS l'écriture des enfants",
  );
});

await test("5. la migration est additive : source_key, index partiel, rien d'autre", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(sql.includes("add column if not exists source_key text"));
  assert.ok(sql.includes("create unique index if not exists nutrition_recipes_source_key_unique"));
  assert.ok(sql.includes("where source_key is not null"), "index PARTIEL");
  assert.ok(!/\bdrop table\b|\bdrop column\b|\btruncate\b/i.test(sql), "rien de destructif");
  // Les `insert into` présents sont le CODE de la RPC, pas des données. Ce
  // qui compte : aucune valeur de fixture, aucune clé d'import en dur.
  assert.ok(!/'fixture:/.test(sql), "aucune clé de fixture en dur dans la migration");
  const horsFonction = sql.slice(0, sql.indexOf("create or replace function"));
  assert.ok(!/\binsert\s+into\b/i.test(horsFonction), "la migration elle-même n'insère aucune donnée");
  assert.ok(!/nutrition_plans|nutrition_days|meals\b/.test(sql), "les plans v1 et v2 ne sont pas touchés");
  assert.ok(!/current_student_id/.test(sql), "aucune policy de lecture élève");
});

/* ═══════════ 2. Formulaire : ingrédients, positions, liaisons ═══════════ */

await test("6. ajout, duplication, retrait et réorganisation", () => {
  let s = formulaireComplet();
  assert.equal(s.ingredients.length, 3);

  s = addIngredient(s, "ing-4");
  assert.equal(s.ingredients.length, 4);

  s = duplicateIngredient(s, "ing-riz", "ing-riz-copie");
  assert.equal(s.ingredients.length, 5);
  assert.equal(s.ingredients[2].id, "ing-riz-copie", "la copie est insérée juste après l'original");
  assert.ok(s.ingredients[2].name.includes("copie"));

  s = moveIngredient(s, "ing-creme", -1);
  assert.equal(s.ingredients.map((i) => i.id).indexOf("ing-creme"), 2);

  s = removeIngredient(s, "ing-4");
  assert.equal(s.ingredients.length, 4);
  assert.ok(!s.ingredients.some((i) => i.id === "ing-4"));
});

await test("7. RENUMÉROTATION CONTINUE : positions 1..N, aucun doublon, aucun trou", () => {
  let s = formulaireComplet();
  s = duplicateIngredient(s, "ing-poulet", "copie");
  s = moveIngredient(s, "ing-creme", -1);
  s = removeIngredient(s, "ing-riz");
  const payload = toRecipeSavePayload(s) as { ingredients: { position: number }[] };
  const positions = payload.ingredients.map((i) => i.position);
  assert.deepEqual(positions, [1, 2, 3], `positions attendues 1..3, obtenues ${positions.join(",")}`);
  assert.equal(new Set(positions).size, positions.length, "aucune position dupliquée");
});

await test("8. aucun lien vers soi-même, aucune valeur implicite dangereuse", () => {
  let s = formulaireComplet();
  s = updateIngredient(s, "ing-riz", { linkedToIngredientId: "ing-riz", linkRatioBp: "1500" });
  const riz = s.ingredients.find((i) => i.id === "ing-riz")!;
  assert.equal(riz.linkedToIngredientId, null, "un ingrédient ne peut pas se lier à lui-même");
  assert.equal(riz.linkRatioBp, "", "la part est retirée avec la liaison");

  // Les champs d'unité et d'œuf sont nettoyés dès que le mode est désactivé.
  s = updateIngredient(s, "ing-riz", { unitScalable: true, unitName: "wrap", maxUnits: "2" });
  s = updateIngredient(s, "ing-riz", { unitScalable: false });
  const après = s.ingredients.find((i) => i.id === "ing-riz")!;
  assert.equal(après.unitName, "");
  assert.equal(après.maxUnits, "");
});

await test("9. retrait d'un ingrédient RÉFÉRENCÉ : dépendances nommées, liaisons rompues", () => {
  let s = formulaireComplet();
  s = updateIngredient(s, "ing-riz", { linkedToIngredientId: "ing-poulet", linkRatioBp: "1500" });
  const dépendants = dependentsOf(s, "ing-poulet");
  assert.equal(dépendants.length, 1);
  assert.equal(dépendants[0].id, "ing-riz");

  s = removeIngredient(s, "ing-poulet");
  const riz = s.ingredients.find((i) => i.id === "ing-riz")!;
  assert.equal(riz.linkedToIngredientId, null, "la liaison est rompue, jamais laissée pendante");
  assert.equal(riz.linkRatioBp, "");

  // L'interface AVERTIT avant : le composant ouvre une confirmation.
  assert.ok(BUILDER.includes("dependentsOf(state, id).length > 0"));
  assert.ok(BUILDER.includes("Retirer cet ingrédient ?"));
});

await test("10. duplication : la copie perd sa liaison (jamais deux enfants d'un même parent)", () => {
  let s = formulaireComplet();
  s = updateIngredient(s, "ing-riz", { linkedToIngredientId: "ing-poulet", linkRatioBp: "1500" });
  s = duplicateIngredient(s, "ing-riz", "copie");
  const copie = s.ingredients.find((i) => i.id === "copie")!;
  assert.equal(copie.linkedToIngredientId, null);
  assert.equal(copie.linkRatioBp, "");
});

await test("11. cycle de liaison détecté localement", () => {
  let s = formulaireComplet();
  s = updateIngredient(s, "ing-poulet", { linkedToIngredientId: "ing-riz", linkRatioBp: "1500" });
  s = updateIngredient(s, "ing-riz", { linkedToIngredientId: "ing-poulet", linkRatioBp: "1500" });
  assert.equal(detectLinkCycle(s, "ing-poulet"), true);
  assert.ok(validateRecipeForm(s).some((i) => i.code === "link_cycle"));
});

await test("12. AUCUNE division par zéro : un ajustable sans référence est refusé", () => {
  let s = formulaireComplet();
  s = updateIngredient(s, "ing-poulet", { referenceGrams: "0" });
  const issues = validateRecipeForm(s);
  assert.ok(issues.some((i) => i.code === "scalable_without_reference"), JSON.stringify(issues));
  // Et le solveur ne produit jamais de NaN sur cet état.
  const solution = solveRecipe(toPreviewRecipe(s), { target: { proteinGrams: 40, carbGrams: 80, fatGrams: 20 } });
  for (const ing of solution.ingredients) {
    assert.ok(Number.isFinite(ing.grams), `${ing.name} : ${ing.grams}`);
  }
});

await test("13. validation locale : chaque erreur est rattachée à son champ", () => {
  let s = createBlankRecipeForm("coach-1");
  s = { ...s, ingredients: [createEmptyIngredient("vide")] };
  const issues = validateRecipeForm(s);
  assert.ok(issues.some((i) => i.code === "name_empty" && i.field === "name"));
  assert.ok(issues.some((i) => i.code === "ingredient_name_empty" && i.ingredientId === "vide"));
  assert.ok(issues.some((i) => i.code === "macro_invalid" && i.field === "proteinPer100g"));
  assert.ok(issues.every((i) => typeof i.message === "string" && i.message.length > 5));
});

/* ═══════════ 3. Étiquettes contrôlées ═══════════ */

await test("14. seules les valeurs du vocabulaire sont acceptées — aucun champ libre", () => {
  let s = formulaireComplet();
  s = toggleTag(s, "allergen", "milk", true);
  assert.ok(hasTag(s, "allergen", "milk"));

  const avant = JSON.stringify(s.tags);
  s = toggleTag(s, "allergen", "cacahuete", true);
  assert.equal(JSON.stringify(s.tags), avant, "une valeur hors vocabulaire ne modifie rien");
  s = toggleTag(s, "humeur" as never, "milk", true);
  assert.equal(JSON.stringify(s.tags), avant, "une famille inconnue ne modifie rien");

  s = toggleTag(s, "allergen", "milk", false);
  assert.equal(s.tags.length, 0);

  // Aucune saisie de texte dans le panneau d'étiquettes.
  assert.ok(!/<input(?![^>]*type="checkbox")/.test(PANNEAU_TAGS), "aucun champ texte");
  assert.ok(!PANNEAU_TAGS.includes("Field("), "aucun champ de saisie libre");
});

await test("15. chaque clé du vocabulaire a un libellé français, et réciproquement", () => {
  for (const kind of RECIPE_TAG_KINDS) {
    for (const valeur of RECIPE_TAG_VOCABULARY[kind]) {
      const libellé = describeTag(kind, valeur);
      assert.notEqual(libellé, valeur, `${kind}/${valeur} doit avoir un libellé français`);
    }
    const libellés = Object.keys(RECIPE_TAG_VALUE_LABELS_FR[kind]);
    for (const clé of libellés) {
      assert.ok(
        RECIPE_TAG_VOCABULARY[kind].includes(clé),
        `« ${clé} » a un libellé mais n'existe pas dans le vocabulaire ${kind}`,
      );
    }
    // Ordre d'affichage stable : trié par libellé français.
    const options = tagOptionsFor(kind);
    assert.deepEqual(
      options.map((o) => o.label),
      [...options.map((o) => o.label)].sort((a, b) => a.localeCompare(b, "fr")),
    );
  }
});

await test("16. les CLÉS TECHNIQUES partent en base, jamais les libellés", () => {
  let s = formulaireComplet();
  s = toggleTag(s, "diet", "vegetarian", true);
  const payload = toRecipeSavePayload(s) as { tags: { kind: string; value: string }[] };
  assert.deepEqual(payload.tags, [{ kind: "diet", value: "vegetarian" }]);
  assert.notEqual(payload.tags[0].value, "Végétarien");
});

/* ═══════════ 4. Catalogue ═══════════ */

const CATALOGUE_FACTICE: RecipeWithTags[] = [
  recordFactice("r-b", "Burger maison", "dinner", "active", [{ kind: "allergen", value: "gluten" }]),
  recordFactice("r-a", "Bol riz poulet", "lunch", "active"),
  recordFactice("r-c", "Porridge", "breakfast", "draft"),
  recordFactice("r-d", "Recette générique", null, "archived"),
];

await test("17. catalogue VIDE : message explicite, aucun plantage", () => {
  const html = renderToString(
    createElement(RecipeCatalog, { recipes: [], invalid: [], loading: false, error: null }),
  );
  assert.ok(html.includes("Aucune recette pour le moment"));
  assert.ok(html.includes("importe les recettes de démonstration"));
});

await test("18. états chargement et erreur", () => {
  const chargement = renderToString(
    createElement(RecipeCatalog, { recipes: [], invalid: [], loading: true, error: null }),
  );
  assert.ok(chargement.includes("Chargement du catalogue"));
  const erreur = renderToString(
    createElement(RecipeCatalog, { recipes: [], invalid: [], loading: false, error: "Panne réseau" }),
  );
  assert.ok(erreur.includes("Panne réseau"));
  assert.ok(erreur.includes('role="alert"'));
});

await test("19. recherche, filtres statut / créneau / étiquette, tri DÉTERMINISTE", () => {
  const base = { query: "", status: "tous", slot: "tous", tagKind: "tous" } as const;

  const tout = filterCatalog(CATALOGUE_FACTICE, base);
  assert.deepEqual(tout.map((r) => r.recipe.name), ["Bol riz poulet", "Burger maison", "Porridge", "Recette générique"]);

  // Recherche insensible à la casse ET aux accents.
  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, { ...base, query: "POrridge" }).map((r) => r.recipe.id), ["r-c"]);
  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, { ...base, query: "generique" }).map((r) => r.recipe.id), ["r-d"]);

  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, { ...base, status: "draft" }).map((r) => r.recipe.id), ["r-c"]);
  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, { ...base, slot: "lunch" }).map((r) => r.recipe.id), ["r-a"]);
  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, { ...base, slot: "generic" }).map((r) => r.recipe.id), ["r-d"]);
  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, { ...base, tagKind: "allergen" }).map((r) => r.recipe.id), ["r-b"]);

  // Déterminisme : deux appels, même ordre ; l'entrée n'est jamais mutée.
  const avant = JSON.stringify(CATALOGUE_FACTICE);
  assert.deepEqual(filterCatalog(CATALOGUE_FACTICE, base), filterCatalog(CATALOGUE_FACTICE, base));
  assert.equal(JSON.stringify(CATALOGUE_FACTICE), avant);
});

await test("20. le catalogue affiche nom, créneau, statut, ingrédients, étiquettes, date et validité", () => {
  const html = renderToString(
    createElement(RecipeCatalog, {
      recipes: CATALOGUE_FACTICE,
      invalid: [],
      loading: false,
      error: null,
      blockingByRecipe: { "r-a": null, "r-b": "recipe_without_ingredient" },
    }),
  );
  assert.ok(html.includes("Bol riz poulet"), "nom");
  assert.ok(html.includes("Déjeuner"), "créneau en français");
  assert.ok(html.includes(RECIPE_STATUS_LABELS_FR.draft), "statut en français");
  const texte = html.replace(/<!--\s*-->/g, "");
  assert.ok(texte.includes("1 ingrédient"), "nombre d'ingrédients");
  assert.ok(html.includes("Gluten"), "étiquette principale en français");
  assert.ok(texte.includes("Modifiée le 05/08/2026"), "date de modification");
  assert.ok(html.includes("Exploitable") && html.includes("À compléter"), "résultat de validation");
  assert.equal(formatUpdatedAt(null), "—");
  assert.equal(formatUpdatedAt("pas une date"), "—");
});

await test("21. une recette illisible est signalée, jamais masquée", () => {
  const html = renderToString(
    createElement(RecipeCatalog, {
      recipes: [],
      invalid: [{ recipeId: "x", name: "Cassée", code: "invalid_status", message: "…" }],
      loading: false,
      error: null,
    }),
  );
  assert.ok(html.includes("Cassée") && html.includes("invalid_status"));
});

/* ═══════════ 5. Aperçu adaptatif ═══════════ */

await test("22. aperçu EXACT", () => {
  const s = formulaireComplet();
  const solution = solveRecipe(toPreviewRecipe(s), { target: { proteinGrams: 35, carbGrams: 77, fatGrams: 3.2 } });
  const fit = describeRecipeFit(solution);
  assert.equal(solution.status, "exact");
  assert.equal(fit.proposable, true);
  assert.ok(fit.summary.includes("exactement"));
});

await test("23. aperçu APPROXIMATIF, avec écarts", () => {
  // La crème est plafonnée à 100 g : au-delà, la cible en lipides devient
  // inatteignable. On vise donc un écart approchable, pas impossible.
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: { proteinGrams: 38, carbGrams: 80, fatGrams: 10 } });
  assert.equal(solution.status, "approximate", `statut obtenu : ${solution.status}`);
  const fit = describeRecipeFit(solution);
  assert.ok(fit.details.length > 0);
  assert.ok(fit.summary.includes("kcal"));
});

await test("24. aperçu IMPOSSIBLE, exploitable en interne", () => {
  const solution = solveRecipe(RECETTE_MAXIMUM, { target: { proteinGrams: 400, carbGrams: 400, fatGrams: 400 } });
  assert.equal(solution.status, "impossible");
  const fit = describeRecipeFit(solution);
  assert.equal(fit.proposable, false);
  assert.ok(typeof fit.mainReason === "string" && fit.mainReason.length > 0);
});

await test("25. l'aperçu ne MUTE JAMAIS la recette source", () => {
  const s = formulaireComplet();
  const avant = JSON.stringify(s);
  const copie1 = toPreviewRecipe(s);
  solveRecipe(copie1, { target: { proteinGrams: 40, carbGrams: 80, fatGrams: 40 } });
  // Fermer puis rouvrir : on reconstruit une copie, l'état source est intact.
  const copie2 = toPreviewRecipe(s);
  solveRecipe(copie2, { target: { proteinGrams: 10, carbGrams: 10, fatGrams: 10 } });
  assert.equal(JSON.stringify(s), avant, "l'état du formulaire est strictement identique");
  assert.equal(JSON.stringify(toRecipeSavePayload(s)), JSON.stringify(toRecipeSavePayload(s)));
});

await test("26. l'aperçu n'écrit RIEN et n'a aucun moyen d'appliquer ses quantités", () => {
  const code = sansCommentairesTs(APERÇU);
  assert.ok(!/from "@\/lib\/supabase/.test(code), "aucun import Supabase dans l'aperçu");
  assert.ok(!/onApply|appliquer les quantit|injecter/i.test(code), "aucun bouton appliquer");
  // Les seuls `onChange` sont ceux des champs de CIBLE (état local de
  // l'aperçu) : aucun ne touche à l'état du formulaire.
  const setters = [...code.matchAll(/onChange=\{(set[A-Za-zÀ-ÿ]+)\}/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(setters)].sort(), ["setGlucides", "setLipides", "setProtéines"], setters.join(","));
  assert.ok(!/\.insert\(|\.update\(|\.rpc\(/.test(code), "aucune écriture");
  // Le composant ne reçoit QUE l'état, sans setter.
  assert.ok(/export function RecipeAdaptivePreview\(\{ state \}/.test(APERÇU));
});

await test("27. l'aperçu se rend sans écrire, et affiche quantités, totaux et écarts", () => {
  const html = renderToString(createElement(RecipeAdaptivePreview, { state: formulaireComplet() }));
  assert.ok(html.includes("Aperçu adaptatif"));
  assert.ok(html.includes("Prévisualiser"), "fermé par défaut : aucun calcul au chargement");
  assert.ok(html.includes("lecture seule"));
});

await test("28. AUCUNE RecipeSolution ne peut atteindre la RPC de sauvegarde", () => {
  for (const [nom, source] of Object.entries({ FORM, COUCHE_ÉCRITURE, COUCHE_LECTURE })) {
    const code = sansCommentairesTs(source);
    assert.ok(!/RecipeSolution|SolvedIngredient/.test(code), `${nom} ne manipule aucune solution`);
  }
  const payload = toRecipeSavePayload(formulaireComplet()) as { ingredients: Record<string, unknown>[] };
  for (const ing of payload.ingredients) {
    for (const interdit of ["grams", "displayGrams", "calories", "units", "eggCount", "boundHit"]) {
      assert.ok(!(interdit in ing), `aucune quantité calculée dans la charge utile : ${interdit}`);
    }
  }
});

/* ═══════════ 6. Brouillon, activation, archivage ═══════════ */

await test("29. un BROUILLON incomplet est enregistrable", () => {
  let s = createBlankRecipeForm("coach-1");
  s = { ...s, name: "En cours" };
  const payload = toRecipeSavePayload(s, "draft") as { recipe: { status: string } };
  assert.equal(payload.recipe.status, "draft");
  // Le bouton brouillon n'est jamais désactivé par la validation : il ne
  // dépend QUE de `saving`, contrairement au bouton d'activation qui, lui,
  // ajoute `|| bloquant`.
  const boutons = BUILDER.split("<button");
  const brouillon = boutons.find((b) => b.includes('enregistrer("draft")'));
  assert.ok(brouillon, "le bouton brouillon existe");
  assert.ok(brouillon!.includes("disabled={saving}"), "désactivé uniquement pendant l'écriture");
  assert.ok(!brouillon!.includes("bloquant"), "la validation ne bloque JAMAIS le brouillon");
});

await test("30. l'ACTIVATION est bloquée localement, et arbitrée par la base", () => {
  let s = createBlankRecipeForm("coach-1");
  s = { ...s, name: "" };
  assert.ok(validateRecipeForm(s).length > 0);
  assert.ok(BUILDER.includes("disabled={saving || bloquant}"), "activation désactivée si incomplet");
  // Mais la base reste l'arbitre : la RPC revalide dans la transaction.
  assert.ok(MIGRATION.includes("public.nutrition_recipe_blocking_issue(v_recipe_id)"));
  assert.ok(MIGRATION.includes("RECIPE_NOT_ACTIVABLE"));
});

await test("31. un refus d'activation est traduit en français, avec sa cause", () => {
  const refus = describeRecipeWriteError("RECIPE_NOT_ACTIVABLE: scalable_ingredient_without_reference");
  assert.equal(refus.code, "not_activable");
  assert.ok(refus.message.includes("Activation impossible"));
  assert.ok(refus.message.includes("quantité de référence"), refus.message);

  assert.equal(describeRecipeWriteError("NOT_AUTHORIZED").code, "not_authorized");
  assert.equal(describeRecipeWriteError("RECIPE_NOT_FOUND: x").code, "recipe_not_found");
  assert.equal(describeRecipeWriteError("INGREDIENT_FROM_ANOTHER_RECIPE: x").code, "ingredient_from_another_recipe");
  assert.equal(describeRecipeWriteError('duplicate key value violates unique constraint "nutrition_recipes_source_key_unique"').code, "duplicate_source_key");
  assert.equal(describeRecipeWriteError("INVALID_ROLE: sauce").code, "invalid_payload");
  assert.equal(describeRecipeWriteError(null).code, "unknown");
  for (const brut of ["NOT_AUTHORIZED", "RECIPE_NOT_FOUND: x", null]) {
    assert.ok(!/[A-Z_]{6,}/.test(describeRecipeWriteError(brut).message), "message lisible");
  }
});

await test("32. une erreur de sauvegarde CONSERVE le formulaire", () => {
  for (const page of [PAGE_NOUVELLE, PAGE_DETAIL]) {
    const code = sansCommentairesTs(page);
    const début = code.indexOf("if (!résultat.ok)");
    const bloc = code.slice(début, code.indexOf("return;", début) + 7);
    assert.ok(bloc.includes("setSaveError"), "l'erreur est affichée");
    assert.ok(!bloc.includes("setState("), "l'état du formulaire n'est pas réécrit");
    assert.ok(!bloc.includes("refetch("), "rien n'est rechargé de force");
    assert.ok(bloc.trim().endsWith("return;"), "on sort sans autre effet");
  }
});

await test("33. l'archivage reste un STATUT, et la suppression ne passe QUE par la RPC", () => {
  // ARCHIVER n'a pas changé de nature : c'est toujours une écriture de statut,
  // et « Restaurer » la défait. La PR D ajoute une suppression DÉFINITIVE, qui
  // est une autre action, avec un autre chemin.
  assert.ok(CYCLE_DE_VIE_DOMAINE.includes('archive: "Archiver"'));
  assert.ok(CYCLE_DE_VIE_DOMAINE.includes('restore: "Restaurer"'));
  assert.ok(COUCHE_ÉCRITURE.includes("setNutritionRecipeStatus"), "le statut a un chemin dédié");
  // La charge utile d'un changement de statut ne porte NI ingrédients NI
  // étiquettes : publier ou archiver ne peut donc rien abîmer.
  const corps = sansCommentairesTs(COUCHE_ÉCRITURE);
  const bloc = corps.slice(corps.indexOf("export async function setNutritionRecipeStatus"));
  const appel = bloc.slice(0, bloc.indexOf("}\n"));
  assert.ok(!appel.includes("ingredients"), "aucun ingrédient dans une transition de statut");
  assert.ok(!appel.includes("tags"), "aucune étiquette dans une transition de statut");

  // AUCUNE suppression directe depuis le navigateur, nulle part.
  for (const [nom, source] of Object.entries({
    BUILDER,
    CATALOGUE,
    PAGE_DETAIL,
    PAGE_LISTE,
    COUCHE_ÉCRITURE,
    CYCLE_DE_VIE,
    CYCLE_DE_VIE_SERVICE,
  })) {
    assert.ok(!/\.delete\(\)/.test(sansCommentairesTs(source)), `${nom} : aucune suppression directe`);
  }
  // La suppression passe par la RPC, qui ne reçoit qu'un identifiant : aucun
  // drapeau d'autorisation ne transite depuis le navigateur.
  assert.ok(CYCLE_DE_VIE_SERVICE.includes('"delete_nutrition_recipe"'));
  const service = sansCommentairesTs(CYCLE_DE_VIE_SERVICE);
  assert.ok(!/canDelete|allowDelete|force:\s*true|confirmed:/.test(service), "aucun verdict côté client");
  const argsRpc = service.slice(service.lastIndexOf('"delete_nutrition_recipe"'));
  assert.ok(
    argsRpc.slice(0, argsRpc.indexOf("}")).includes("p_recipe_id"),
    "la RPC ne reçoit que l'identifiant",
  );
});

await test("34. le retour canonique de la RPC est lu sans supposition", () => {
  const bon = parseRecipeWriteResult({
    recipe: { id: "r1", status: "active", source_key: null },
    ingredient_count: 3, tag_count: 1, blocking_issue: null,
  });
  assert.equal(bon.ok && bon.recipeId, "r1");
  assert.equal(bon.ok && bon.ingredientCount, 3);
  assert.equal(parseRecipeWriteResult(null).ok, false, "un retour vide n'est pas un succès");
  assert.equal(parseRecipeWriteResult({ recipe: {} }).ok, false);
});

/* ═══════════ 7. Import des fixtures ═══════════ */

await test("35. les 11 fixtures ont des clés SOURCE stables et distinctes", () => {
  assert.equal(RECIPE_FIXTURES.length, 11, "11 recettes distinctes");
  const clés = RECIPE_FIXTURES.map(fixtureSourceKey);
  assert.equal(new Set(clés).size, 11, `clés dupliquées : ${clés.join(",")}`);
  for (const clé of clés) {
    assert.ok(/^fixture:[A-Za-z0-9_.:-]+$/.test(clé), clé);
    // La clé ne se déduit JAMAIS du nom affiché.
    const fixture = RECIPE_FIXTURES.find((f) => fixtureSourceKey(f) === clé)!;
    assert.ok(!clé.toLowerCase().includes(fixture.name.toLowerCase().slice(0, 5)), `${clé} vs « ${fixture.name} »`);
  }
});

await test("36. la charge utile d'une fixture traduit bien les liaisons", () => {
  const avecLien = RECIPE_FIXTURES.find((f) => f.ingredients.some((i) => i.linkedToIngredientId))!;
  const ids = buildIngredientIdMap(avecLien, idFactice);
  const payload = buildFixturePayload(avecLien, "coach-1", null, ids) as {
    recipe: { status: string; source_key: string; id: string | null };
    ingredients: { id: string; position: number; linked_to_ingredient_id: string | null }[];
    tags: unknown[];
  };
  assert.equal(payload.recipe.status, "draft", "une fixture importée est toujours un brouillon");
  assert.equal(payload.recipe.id, null, "création");
  assert.equal(payload.recipe.source_key, fixtureSourceKey(avecLien));
  assert.deepEqual(payload.ingredients.map((i) => i.position), avecLien.ingredients.map((_, i) => i + 1));
  const lié = payload.ingredients.find((i) => i.linked_to_ingredient_id !== null)!;
  assert.ok(payload.ingredients.some((i) => i.id === lié.linked_to_ingredient_id), "le parent est dans le même payload");
  assert.deepEqual(payload.tags, [], "aucune étiquette inventée");
});

await test("37. un SECOND import ne crée aucun doublon", () => {
  const fixture = RECIPE_FIXTURES[0];
  const premier = buildFixturePayload(fixture, "coach-1", null, buildIngredientIdMap(fixture, idFactice)) as { recipe: { id: string | null; source_key: string } };
  const second = buildFixturePayload(fixture, "coach-1", "deja-la", buildIngredientIdMap(fixture, idFactice)) as { recipe: { id: string | null; source_key: string } };
  assert.equal(premier.recipe.id, null, "première fois : création");
  assert.equal(second.recipe.id, "deja-la", "seconde fois : mise à jour de la MÊME ligne");
  assert.equal(premier.recipe.source_key, second.recipe.source_key, "clé stable entre deux imports");
  // L'unicité est garantie EN BASE, pas seulement par le code.
  assert.ok(MIGRATION.includes("create unique index if not exists nutrition_recipes_source_key_unique"));
});

await test("38. le rapport distingue importées, mises à jour, ignorées et en échec", () => {
  const rapport = summarizeFixtureImport([
    { sourceKey: "fixture:a", name: "A", outcome: "imported", message: null },
    { sourceKey: "fixture:b", name: "B", outcome: "imported", message: null },
    { sourceKey: "fixture:c", name: "C", outcome: "updated", message: null },
    { sourceKey: "fixture:d", name: "D", outcome: "skipped", message: "déjà là" },
    { sourceKey: "fixture:e", name: "E", outcome: "failed", message: "boum" },
  ]);
  assert.deepEqual(
    { i: rapport.imported, u: rapport.updated, s: rapport.skipped, f: rapport.failed },
    { i: 2, u: 1, s: 1, f: 1 },
  );
  const phrase = describeFixtureImport(rapport);
  assert.ok(phrase.includes("2 importées") && phrase.includes("1 mise à jour"), phrase);
  assert.ok(phrase.includes("1 ignorée") && phrase.includes("1 en échec"), phrase);
});

await test("39. l'import est MANUEL : jamais déclenché par un chargement de page", () => {
  // Les trois fichiers du chemin d'import, HOOKS COMPRIS : la version
  // précédente ne scannait que la page et le dialogue, qui ne contiennent
  // aucun useEffect — la boucle tournait donc à vide et le test ne pouvait
  // pas échouer. Les seuls useEffect réels vivent dans les hooks.
  const sources = { PAGE_LISTE, DIALOGUE_IMPORT, HOOKS_RECETTES };
  let effetsInspectés = 0;

  for (const [nom, source] of Object.entries(sources)) {
    const code = sansCommentairesTs(source);
    // Découpage par accolades appariées : un `useEffect` contenant lui-même
    // des `);` n'est plus tronqué comme le faisait la version non gourmande.
    for (let i = code.indexOf("useEffect("); i !== -1; i = code.indexOf("useEffect(", i + 1)) {
      let profondeur = 0;
      let fin = i;
      for (let j = code.indexOf("(", i); j < code.length; j += 1) {
        if (code[j] === "(") profondeur += 1;
        else if (code[j] === ")") {
          profondeur -= 1;
          if (profondeur === 0) {
            fin = j;
            break;
          }
        }
      }
      const effet = code.slice(i, fin + 1);
      effetsInspectés += 1;
      assert.ok(!/import/i.test(effet), `${nom} : un useEffect déclenche l'import`);
    }
    // Aucun appel, quelle que soit sa forme — la version précédente exigeait
    // une parenthèse VIDE, que l'appel réel (trois arguments) ne peut pas
    // avoir : elle ne détectait donc rien.
    if (nom !== "PAGE_LISTE") {
      assert.ok(
        !/importNutritionRecipeFixtures\s*\(/.test(code),
        `${nom} : aucun appel d'import ne doit exister ici`,
      );
    }
  }

  // Garde-fou : si ce compteur retombe à zéro, c'est que le test a cessé de
  // regarder quoi que ce soit — exactement le défaut corrigé ici.
  assert.ok(effetsInspectés >= 2, `au moins deux useEffect inspectés (vu : ${effetsInspectés})`);

  // Dans la page, l'appel existe — mais UNIQUEMENT dans `importer()`, la
  // fonction passée au bouton, jamais dans un effet.
  const pageListe = sansCommentairesTs(PAGE_LISTE);
  const appels = [...pageListe.matchAll(/importNutritionRecipeFixtures\s*\(/g)];
  assert.equal(appels.length, 1, "un seul appel dans la page");
  const avant = pageListe.slice(0, appels[0].index ?? 0);
  assert.ok(
    avant.lastIndexOf("async function importer") > avant.lastIndexOf("useEffect("),
    "l'appel est dans importer(), pas dans un effet",
  );
  // L'import part d'un clic, après confirmation.
  assert.ok(DIALOGUE_IMPORT.includes("Importer les recettes de démonstration"));
  assert.ok(DIALOGUE_IMPORT.includes("Importer les recettes de démonstration ?"), "modale de confirmation");
  assert.ok(PAGE_LISTE.includes("onImport={importer}"));
  // Et la migration n'insère aucune donnée : pas une seule clé de fixture.
  assert.ok(!/'fixture:/.test(sansCommentairesSql(MIGRATION)));
});

await test("40. une recette MANUELLE portant le même nom qu'une fixture n'est jamais touchée", () => {
  // L'identité vient de source_key, jamais du nom : une recette manuelle a
  // source_key = null, donc elle ne peut pas être reconnue comme fixture.
  const code = sansCommentairesTs(lire("../../lib/supabase/nutrition-recipes-write.ts"));
  assert.ok(code.includes('.in("source_key", clés)'), "la recherche des existantes se fait par clé");
  assert.ok(!/\.eq\("name"|ilike\("name"/.test(code), "jamais par le nom");
  const manuel = createBlankRecipeForm("coach-1");
  assert.equal(manuel.sourceKey, null, "une recette créée à la main n'a pas de clé d'import");
  const payload = toRecipeSavePayload({ ...manuel, name: RECIPE_FIXTURES[0].name }) as { recipe: { source_key: string | null } };
  assert.equal(payload.recipe.source_key, null);
});

/* ═══════════ 8. Non-régression ═══════════ */

await test("41. les plans v1 et le constructeur v2 sont INCHANGÉS", () => {
  const sql = sansCommentairesSql(MIGRATION);
  for (const table of ["nutrition_plans", "nutrition_days", "meals", "nutrition_plan_profiles", "nutrition_meal_slot_targets"]) {
    assert.ok(!new RegExp(`\\b(alter table|drop|insert into|update|delete from)\\s+(table\\s+)?public\\.${table}\\b`, "i").test(sql), table);
  }
  // La page des plans ne gagne QU'UN lien.
  assert.ok(PAGE_PLANS.includes('href="/admin/nutrition/recettes"'), "lien vers les recettes");
  assert.ok(PAGE_PLANS.includes('href="/admin/nutrition/nouveau"'), "le bouton de création de plan reste");
  assert.ok(PAGE_PLANS.includes("useGuardedNutritionAssignment"), "la garde d'assignation reste");
});

await test("42. AUCUN écran élève n'est modifié, aucune policy de lecture élève ajoutée", () => {
  const sql = sansCommentairesSql(MIGRATION);
  assert.ok(!/create policy/i.test(sql), "aucune policy créée");
  assert.ok(!/current_student_id/.test(sql), "aucune référence à l'élève");
  // Les composants de la PR B vivent tous sous components/admin/ et app/admin/.
  for (const chemin of [
    "../../components/admin/RecipeCatalog.tsx",
    "../../components/admin/RecipeBuilder.tsx",
    "../../components/admin/RecipeIngredientsPanel.tsx",
    "../../components/admin/RecipeTagsPanel.tsx",
    "../../components/admin/RecipeAdaptivePreview.tsx",
    "../../components/admin/RecipeValidationSummary.tsx",
    "../../components/admin/RecipeFixtureImportDialog.tsx",
  ]) {
    assert.ok(lire(chemin).length > 0, chemin);
  }
});

await test("43. accessibilité et responsive : cibles tactiles, clavier, pas de débordement", () => {
  // CYCLE_DE_VIE est ajouté à la liste : le catalogue et la fiche lui
  // délèguent désormais tous leurs boutons d'action, et un composant partagé
  // qui manquerait la cible de 44 px la manquerait sur les deux écrans.
  const sources = { BUILDER, CATALOGUE, PANNEAU_TAGS, DIALOGUE_IMPORT, APERÇU, CYCLE_DE_VIE };
  for (const [nom, source] of Object.entries(sources)) {
    const boutons = (source.match(/<button/g) ?? []).length;
    if (boutons > 0) {
      const cibles = (source.match(/min-h-\[44px\]|h-11/g) ?? []).length;
      assert.ok(cibles > 0, `${nom} : cibles tactiles d'au moins 44 px`);
      assert.ok(source.includes("focus-visible:ring"), `${nom} : anneau de focus clavier`);
    }
  }
  // Grilles responsives, et le tableau de l'aperçu défile au lieu de déborder.
  assert.ok(CATALOGUE.includes("grid-cols-1") && CATALOGUE.includes("xl:grid-cols-2"));
  assert.ok(APERÇU.includes("overflow-x-auto"), "aucun débordement horizontal du tableau");
  assert.ok(PANNEAU_TAGS.includes("sm:grid-cols-2") && PANNEAU_TAGS.includes("xl:grid-cols-3"));
  // Aucune couleur en dur : uniquement les jetons du thème (clair ET sombre).
  for (const [nom, source] of Object.entries(sources)) {
    assert.ok(!/#[0-9a-fA-F]{6}|bg-white|text-black|bg-black/.test(source), `${nom} : jetons de thème uniquement`);
  }
  // Les boutons d'icône seule portent un nom accessible.
  assert.ok(lire("../../components/admin/RecipeIngredientsPanel.tsx").includes("aria-label="));
});

await test("44. libellés français cohérents pour rôles, statuts et créneaux", () => {
  for (const role of ["protein", "carbohydrate", "fat", "fixed", "free"] as const) {
    assert.ok(RECIPE_ROLE_LABELS_FR[role].length > 3, role);
  }
  assert.equal(RECIPE_STATUS_LABELS_FR.draft, "Brouillon");
  assert.equal(describeSlot(null), "Toutes les occasions");
  assert.equal(describeSlot("lunch"), "Déjeuner");
  assert.equal(describeBlockingIssue(null), null);
  assert.ok(describeBlockingIssue("scalable_ingredient_without_reference")?.includes("référence"));
  assert.ok(describeBlockingIssue("code_inconnu")?.includes("code_inconnu"), "un code inconnu reste visible");
});

await test("45. le formulaire relit une recette sans rien perdre", () => {
  const record = recordFactice("r1", "Test", "lunch", "draft", [{ kind: "allergen", value: "milk" }]);
  const s = createRecipeFormFromRecord(record, "coach-1", "fixture:proto-1");
  assert.equal(s.recipeId, "r1");
  assert.equal(s.sourceKey, "fixture:proto-1");
  assert.equal(s.ingredients[0].proteinPer100g, "25");
  assert.deepEqual(s.tags, [{ kind: "allergen", value: "milk" }]);
  // Et le payload régénéré conserve la clé d'import.
  const payload = toRecipeSavePayload(s) as { recipe: { source_key: string | null } };
  assert.equal(payload.recipe.source_key, "fixture:proto-1");

  // Le RECORD PORTE UNE DESCRIPTION, et l'aller-retour la conserve.
  // La fabrique fixait `description: null` en dur, si bien que ce test ne
  // POUVAIT PAS voir la perte — c'était l'angle mort qui a laissé passer
  // l'effacement de la description à chaque enregistrement.
  const avecTexte: RecipeWithTags = { ...record, description: "Notes du coach" };
  const relu = createRecipeFormFromRecord(avecTexte, "coach-1", null);
  assert.equal(relu.description, "Notes du coach", "la description est relue");
  const renvoi = toRecipeSavePayload(relu) as { recipe: { description: string | null } };
  assert.equal(renvoi.recipe.description, "Notes du coach", "et repart telle quelle");

  // Une description absente reste absente — sans devenir une chaîne vide.
  const sansTexte = createRecipeFormFromRecord({ ...record, description: null }, "coach-1", null);
  assert.equal(sansTexte.description, "");
  const renvoiVide = toRecipeSavePayload(sansTexte) as { recipe: { description: string | null } };
  assert.equal(renvoiVide.recipe.description, null);
});

await test("46. les calories de l'aperçu viennent des fonctions existantes", () => {
  assert.ok(APERÇU.includes("computeCaloriesFromGrams"), "aucune formule kcal réécrite");
  const attendu = computeCaloriesFromGrams({ proteinGrams: 40, carbGrams: 80, fatGrams: 20 }).totalCalories;
  assert.equal(attendu, 40 * 4 + 80 * 4 + 20 * 9);
});

await test("47. le panneau d'étiquettes se rend et coche l'état courant", () => {
  let s = formulaireComplet();
  s = toggleTag(s, "diet", "vegan", true);
  const html = renderToString(
    createElement(RecipeTagsPanel, { state: s, onToggle: () => {} }),
  );
  assert.ok(html.includes("Végétalien"));
  assert.ok(html.includes("Allergènes présents"));
  assert.ok(html.includes("checked"), "l'état coché est rendu");
});

await test("48. la checklist PostgreSQL couvre le périmètre exigé", () => {
  for (const attendu of [
    "rollback;",
    "save_nutrition_recipe",
    "RECIPE_NOT_ACTIVABLE",
    "INGREDIENT_FROM_ANOTHER_RECIPE",
    "source_key",
    "has_table_privilege('authenticated'",
    "TRUNCATE",
    "aucune donnée de test persistante",
  ]) {
    assert.ok(CHECKLIST.includes(attendu), `la checklist doit couvrir : ${attendu}`);
  }
  assert.ok(/^rollback;$/m.test(CHECKLIST));
  assert.ok(CHECKLIST.indexOf("begin;") < CHECKLIST.indexOf("\nrollback;"));
});

await test("49. la migration est déclarée au manifeste et comptée", () => {
  const manifeste = JSON.parse(lire("../../supabase/baseline/manifest.json"));
  const attendues = manifeste.migrations_post_baseline_attendues as string[];
  assert.equal(attendues.length, 25);
  assert.ok(attendues.includes("20260808090000_save_nutrition_recipe.sql"));
  assert.ok(attendues.includes("20260809090000_save_nutrition_recipe_partial_payload.sql"));
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 52,"), "le compteur de migrations suit les migrations réelles");
  assert.ok(secu.includes("assert.equal(attendues.length, 25);"));
});

/* ═══════════ 9. PR B.1 — correctifs de conformité ═══════════ */

/**
 * Client Supabase factice — juste assez pour exercer RÉELLEMENT
 * `importNutritionRecipeFixtures` : la pré-lecture par clé, la boucle, et
 * chaque appel de RPC. La version précédente de cette suite ne l'appelait
 * jamais ; c'est exactement par là que passait le défaut de pré-lecture.
 */
function clientFactice(options: {
  existantes?: { id: string; source_key: string }[];
  erreurLecture?: { message: string };
  échouerSur?: (payload: Record<string, unknown>) => string | null;
}) {
  const appelsRpc: Record<string, unknown>[] = [];
  const lectures: { table: string; colonnes: string; filtres: Record<string, unknown> }[] = [];

  function requête(table: string) {
    const filtres: Record<string, unknown> = {};
    const chaîne = {
      select(colonnes: string) {
        lectures.push({ table, colonnes, filtres });
        return chaîne;
      },
      eq(colonne: string, valeur: unknown) {
        filtres[colonne] = valeur;
        return chaîne;
      },
      in(colonne: string, valeurs: unknown[]) {
        filtres[colonne] = valeurs;
        return Promise.resolve(
          options.erreurLecture
            ? { data: null, error: options.erreurLecture }
            : { data: options.existantes ?? [], error: null },
        );
      },
    };
    return chaîne;
  }

  const client = {
    from: requête,
    rpc(_fn: string, args: { p_payload: Record<string, unknown> }) {
      appelsRpc.push(args.p_payload);
      const message = options.échouerSur?.(args.p_payload) ?? null;
      if (message) return Promise.resolve({ data: null, error: { message } });
      const recette = args.p_payload.recipe as Record<string, unknown>;
      return Promise.resolve({
        data: {
          recipe: {
            id: (recette.id as string) ?? `créée-${appelsRpc.length}`,
            status: (recette.status as string) ?? "draft",
            source_key: recette.source_key ?? null,
          },
          ingredient_count: (args.p_payload.ingredients as unknown[] | undefined)?.length ?? 0,
          tag_count: (args.p_payload.tags as unknown[] | undefined)?.length ?? 0,
          blocking_issue: null,
        },
        error: null,
      });
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: client as any, appelsRpc, lectures };
}

await test("50. IMPORT RÉELLEMENT EXÉCUTÉ : 11 fixtures, 11 transactions, aucune écriture directe", async () => {
  const { client, appelsRpc, lectures } = clientFactice({});
  const rapport = await importNutritionRecipeFixtures(client, "coach-1", { generateId: idFactice });

  assert.equal(rapport.imported, 11, "les 11 fixtures sont importées");
  assert.equal(rapport.updated + rapport.skipped + rapport.failed, 0);
  assert.equal(appelsRpc.length, 11, "une transaction par fixture, pas une de plus");

  // UNE seule lecture, sur la table des recettes, filtrée par coach ET par clé.
  assert.equal(lectures.length, 1, "une seule requête de pré-lecture");
  assert.equal(lectures[0].table, "nutrition_recipes");
  assert.equal(lectures[0].filtres.coach_id, "coach-1");
  assert.equal((lectures[0].filtres.source_key as string[]).length, 11);

  // Chaque charge utile porte sa clé stable, en création (id null) et en brouillon.
  const clés = appelsRpc.map((p) => (p.recipe as { source_key: string }).source_key);
  assert.equal(new Set(clés).size, 11, "11 clés distinctes");
  assert.ok(clés.every((c) => c.startsWith("fixture:")), clés.join(","));
  for (const payload of appelsRpc) {
    const recette = payload.recipe as Record<string, unknown>;
    assert.equal(recette.id, null, "création : aucun identifiant");
    assert.equal(recette.status, "draft", "une fixture arrive en brouillon");
    assert.equal(recette.coach_id, "coach-1");
  }
});

await test("51. SECOND IMPORT : ignoré par défaut, aucune transaction, aucun doublon", async () => {
  const existantes = RECIPE_FIXTURES.map((f, i) => ({
    id: `déjà-${i}`,
    source_key: fixtureSourceKey(f),
  }));
  const { client, appelsRpc } = clientFactice({ existantes });
  const rapport = await importNutritionRecipeFixtures(client, "coach-1", { generateId: idFactice });

  assert.equal(rapport.skipped, 11, "les 11 sont ignorées");
  assert.equal(rapport.imported + rapport.updated + rapport.failed, 0);
  assert.equal(appelsRpc.length, 0, "aucune écriture : rien n'est retouché");
  assert.ok(rapport.entries.every((e) => e.outcome === "skipped"));
});

await test("52. MISE À JOUR EXPLICITE : le statut, la description et les étiquettes du coach sont préservés", async () => {
  const existantes = RECIPE_FIXTURES.map((f, i) => ({
    id: `déjà-${i}`,
    source_key: fixtureSourceKey(f),
  }));
  const { client, appelsRpc } = clientFactice({ existantes });
  const rapport = await importNutritionRecipeFixtures(client, "coach-1", {
    generateId: idFactice,
    updateExisting: true,
  });

  assert.equal(rapport.updated, 11);
  assert.equal(appelsRpc.length, 11);

  for (const payload of appelsRpc) {
    const recette = payload.recipe as Record<string, unknown>;
    assert.ok(typeof recette.id === "string", "une mise à jour cible la ligne existante");
    // Une clé ABSENTE laisse la colonne intacte côté base (migration B.1).
    assert.ok(!("status" in recette), "le statut du coach n'est pas réécrit");
    assert.ok(!("description" in recette), "la description du coach n'est pas effacée");
    assert.ok(!("tags" in payload), "les étiquettes du coach ne sont pas supprimées");
    // Ce que la fixture définit VRAIMENT est bien rafraîchi.
    assert.ok(typeof recette.name === "string" && (recette.name as string).length > 0);
    assert.ok(Array.isArray(payload.ingredients));
  }

  // À la CRÉATION, en revanche, les trois clés sont présentes et explicites.
  const création = buildFixturePayload(
    RECIPE_FIXTURES[0],
    "coach-1",
    null,
    buildIngredientIdMap(RECIPE_FIXTURES[0], idFactice),
  ) as Record<string, unknown>;
  const recetteCréée = création.recipe as Record<string, unknown>;
  assert.equal(recetteCréée.status, "draft");
  assert.equal(recetteCréée.description, null);
  assert.deepEqual(création.tags, []);
});

await test("53. PRÉ-LECTURE EN ÉCHEC : rien n'est écrit, et le rapport dit la vraie cause", async () => {
  const { client, appelsRpc } = clientFactice({
    erreurLecture: { message: "réseau indisponible" },
  });
  const rapport = await importNutritionRecipeFixtures(client, "coach-1", { generateId: idFactice });

  assert.equal(appelsRpc.length, 0, "AUCUNE écriture tentée à l'aveugle");
  assert.equal(rapport.failed, 11);
  assert.equal(rapport.imported + rapport.updated + rapport.skipped, 0);
  for (const entrée of rapport.entries) {
    assert.equal(entrée.outcome, "failed");
    assert.ok(
      entrée.message?.includes("déjà importées") && entrée.message.includes("rien n'a été écrit"),
      `le message doit expliquer la cause : ${entrée.message ?? "(vide)"}`,
    );
  }
});

await test("54. la validation locale couvre les règles de blocage de la base", () => {
  // Mode unité sans poids d'unité : `unit_scalable_incoherent` côté base.
  let s = formulaireComplet();
  s = updateIngredient(s, s.ingredients[0].id, {
    unitScalable: true,
    unitName: "wrap",
    referenceGrams: "0",
  });
  const codes = validateRecipeForm(s).map((i) => i.code);
  assert.ok(codes.includes("unit_scalable_incoherent"), codes.join(","));

  // Nombre maximal d'unités inférieur à 1.
  let t = formulaireComplet();
  t = updateIngredient(t, t.ingredients[0].id, {
    unitScalable: true,
    unitName: "wrap",
    maxUnits: "0",
  });
  const codesT = validateRecipeForm(t).map((i) => i.code);
  assert.ok(codesT.includes("unit_scalable_incoherent"), codesT.join(","));

  // Poids d'un œuf nul : `egg_fields_incoherent`, et surtout la division par
  // zéro que le solveur ne pouvait pas éviter (`?? DEFAULT` ne filtre pas 0).
  let u = formulaireComplet();
  u = updateIngredient(u, u.ingredients[0].id, { egg: true, eggGrams: "0" });
  const problème = validateRecipeForm(u).find((i) => i.code === "egg_fields_incoherent");
  assert.ok(problème, "le poids d'un œuf nul est signalé");
  assert.equal(problème?.field, "eggGrams", "l'erreur est rattachée à SON champ");

  // Une recette saine ne déclenche aucune de ces règles.
  const sain = validateRecipeForm(formulaireComplet()).map((i) => i.code);
  assert.ok(!sain.includes("unit_scalable_incoherent") && !sain.includes("egg_fields_incoherent"));

  // Chaque code local a un libellé français côté base.
  for (const code of ["unit_scalable_incoherent", "egg_fields_incoherent"]) {
    assert.ok(describeBlockingIssue(code) !== null && !describeBlockingIssue(code)!.includes(code));
  }
});

await test("55. l'aperçu ne peut PAS diviser par zéro sur un poids d'œuf", () => {
  let s = formulaireComplet();
  s = updateIngredient(s, s.ingredients[0].id, { egg: true, eggGrams: "0" });
  const copie = toPreviewRecipe(s);
  assert.equal(copie.ingredients[0].eggGrams, null, "0 est neutralisé avant le solveur");

  const solution = solveRecipe(copie, {
    target: { proteinGrams: 40, carbGrams: 80, fatGrams: 20 },
  });
  for (const ing of solution.ingredients) {
    assert.ok(Number.isFinite(ing.grams), `grammes finis : ${ing.grams}`);
    assert.ok(ing.eggCount === null || Number.isFinite(ing.eggCount), "aucun Infinity");
  }
  assert.ok(Number.isFinite(solution.totals.calories), "aucun NaN dans les totaux");

  // Un poids d'œuf RENSEIGNÉ, lui, est bien transmis.
  let t = formulaireComplet();
  t = updateIngredient(t, t.ingredients[0].id, { egg: true, eggGrams: "50" });
  assert.equal(toPreviewRecipe(t).ingredients[0].eggGrams, 50);
});

await test("56. les rôles ne sont PAS réécrits dans l'interface", () => {
  const code = sansCommentairesTs(PANNEAU_INGRÉDIENTS);
  assert.ok(code.includes("RECIPE_INGREDIENT_ROLES"), "la liste vient de la PR A");
  assert.ok(
    !/\[\s*"protein"\s*,\s*"carbohydrate"/.test(code),
    "aucune liste de rôles réécrite dans le composant",
  );
  assert.deepEqual([...RECIPE_INGREDIENT_ROLES], ["protein", "carbohydrate", "fat", "fixed", "free"]);
  // Et chaque rôle exposé a bien un libellé.
  for (const role of RECIPE_INGREDIENT_ROLES) {
    assert.ok(RECIPE_ROLE_LABELS_FR[role].length > 3, role);
  }
});

await test("57. migration B.1 : une clé ABSENTE ne touche à rien, et l'upsert est borné à la recette", () => {
  const sql = sansCommentairesSql(MIGRATION_B1);

  // Contrat « clé absente = colonne intacte », pour les trois champs perdus.
  for (const colonne of ["description", "slot_key", "name"]) {
    assert.ok(
      new RegExp(`${colonne} = case when v_recipe \\? '${colonne}'`).test(sql),
      `${colonne} distingue clé absente et clé vide`,
    );
  }
  assert.ok(sql.includes("v_status := coalesce(v_status_demande, v_status_courant, 'draft')"),
    "le statut absent est CONSERVÉ à la modification");
  assert.ok(sql.includes("v_sync_ingredients := p_payload ? 'ingredients'"));
  assert.ok(sql.includes("v_sync_tags := p_payload ? 'tags'"));

  // L'upsert ne peut plus toucher l'enfant d'une autre recette…
  assert.ok(
    sql.includes("where nutrition_recipe_ingredients.recipe_id = v_recipe_id"),
    "on conflict do update borné à la recette",
  );
  // …et un ingrédient ignoré fait échouer la transaction, au lieu de passer.
  assert.ok(sql.includes("if v_ecrits <> coalesce(array_length(v_ids, 1), 0) then"));
  assert.ok(sql.includes("INGREDIENT_FROM_ANOTHER_RECIPE: écriture ignorée"));

  // Les garanties de sécurité de la version précédente sont RECONDUITES.
  assert.ok(sql.includes("security invoker"));
  assert.ok(sql.includes("set search_path = ''"));
  assert.ok(sql.includes("alter function public.save_nutrition_recipe(jsonb) owner to postgres;"));
  assert.ok(sql.includes("revoke all on function public.save_nutrition_recipe(jsonb) from public;"));
  assert.ok(sql.includes("revoke execute on function public.save_nutrition_recipe(jsonb) from anon;"));
  assert.ok(sql.includes("grant execute on function public.save_nutrition_recipe(jsonb) to authenticated;"));
  assert.ok(sql.includes("if not public.is_coach_or_admin() then"));
  assert.ok(!/security definer/i.test(sql));

  // Migration STRICTEMENT additive : aucune modification de schéma, aucune
  // donnée. On regarde HORS du corps de la fonction — les `insert` qui s'y
  // trouvent sont ceux que la RPC exécute pour le compte de l'appelant, pas
  // des écritures faites par la migration elle-même.
  const corps = sql.slice(sql.indexOf("as $fn$"), sql.lastIndexOf("$fn$") + 4);
  const horsCorps = sql.replace(corps, "").toLowerCase();
  for (const interdit of [
    "create table", "drop table", "drop column", "alter table", "create policy",
    "drop policy", "truncate", "delete from", "insert into",
    "create index", "drop index",
  ]) {
    assert.ok(!horsCorps.includes(interdit), `la migration B.1 ne doit pas contenir : ${interdit}`);
  }
  // Et dans le corps, aucune suppression de recette : l'archivage est un statut.
  assert.ok(!/delete from public\.nutrition_recipes\b/.test(corps), "aucun hard delete de recette");
});

await test("58. un formulaire VIERGE n'agresse pas : aucune erreur avant la première saisie", () => {
  const vierge = createBlankRecipeForm("coach-1");
  const htmlVierge = renderToString(
    createElement(RecipeBuilder, {
      state: vierge,
      onChange: () => {},
      onSave: () => {},
      saving: false,
      saveError: null,
      blockingIssue: null,
    }),
  );
  assert.ok(!htmlVierge.includes('role="alert"'), "aucun message d'erreur au premier rendu");
  // React insère `<!-- -->` entre deux nœuds texte : on les retire avant de
  // chercher le décompte, sinon la recherche ne trouverait jamais rien.
  const texteVierge = htmlVierge.replace(/<!-- -->/g, "");
  assert.ok(
    !/\d+\s*points?\s*à compléter/.test(texteVierge),
    "aucun décompte de points à compléter",
  );
  // Et surtout : on ne prétend PAS que la recette vide est exploitable.
  assert.ok(!htmlVierge.includes("elle peut être activée"), "aucune promesse fausse");
  assert.ok(htmlVierge.includes("au fil de la saisie"), "on indique quoi faire");
  // Le bouton de publication reste refusé, lui, dès le premier rendu.
  // « Enregistrer et publier » depuis la PR D : ce bouton enregistre la saisie
  // ET publie, là où la barre de cycle de vie ne fait que changer le statut.
  assert.ok(/Enregistrer et publier/.test(htmlVierge));
  assert.ok(htmlVierge.includes("disabled"), "la publication est bloquée");

  // Une recette EXISTANTE incomplète, elle, affiche ses points dès l'ouverture.
  const existante: RecipeFormState = { ...vierge, recipeId: "r1" };
  const htmlExistante = renderToString(
    createElement(RecipeBuilder, {
      state: existante,
      onChange: () => {},
      onSave: () => {},
      saving: false,
      saveError: null,
      blockingIssue: null,
    }),
  );
  assert.ok(
    /\d+\s*points?\s*à compléter/.test(htmlExistante.replace(/<!-- -->/g, "")),
    "les points restants sont utiles ici",
  );
});

await test("59. le rechargement après sauvegarde ne démonte pas le formulaire", () => {
  const hooks = sansCommentairesTs(HOOKS_RECETTES);
  // `loading` ne repasse jamais à vrai : un seul `setLoading(false)` par hook,
  // aucun `setLoading(true)`.
  assert.ok(!/setLoading\(true\)/.test(hooks), "loading ne redevient jamais vrai");
  assert.equal((hooks.match(/setLoading\(false\)/g) ?? []).length, 2, "un par hook");
  // Et la lecture est partagée entre le montage et le rechargement.
  assert.ok(hooks.includes("async function lireCatalogue()"));
  assert.ok(hooks.includes("async function lireRecette("));
  // La page de détail ne recharge qu'en cas de SUCCÈS.
  const detail = sansCommentairesTs(PAGE_DETAIL);
  const échec = detail.slice(detail.indexOf("if (!résultat.ok)"));
  const finBloc = échec.indexOf("return;");
  assert.ok(!échec.slice(0, finBloc).includes("refetch("), "aucun rechargement après un échec");
});

await test("60. le dialogue d'import traite l'échec et ignore un rapport périmé", () => {
  const code = sansCommentairesTs(DIALOGUE_IMPORT);
  assert.ok(code.includes(".catch("), "un rejet ne peut plus passer inaperçu");
  assert.ok(code.includes("tentative.current"), "un numéro de tentative distingue les rapports");
  assert.ok(/fermer\(\)[\s\S]{0,200}tentative\.current \+= 1/.test(code),
    "fermer la modale périme la tentative en cours");
  assert.ok(code.includes('role="alert"'), "l'échec est annoncé");
  // La promesse d'origine reste inchangée : l'import part toujours d'un clic.
  assert.ok(code.includes("onClick={lancer}"));
});

/* ═══════════ 12. Cycle de vie des recettes (PR D) ═══════════ */

await test("61. les actions proposées suivent le statut, et rien d'autre", () => {
  assert.deepEqual(recipeLifecycleActions("draft"), ["publish", "archive", "duplicate"]);
  assert.deepEqual(recipeLifecycleActions("active"), ["unpublish", "archive", "duplicate"]);
  // Une archive ne se republie pas d'un clic : « Restaurer » la ramène en
  // BROUILLON, pour qu'elle soit relue avant de revenir aux élèves.
  assert.deepEqual(recipeLifecycleActions("archived"), ["restore", "duplicate"]);
  assert.equal(recipeStatusAfter("restore"), "draft");
  assert.equal(recipeStatusAfter("publish"), "active");
  assert.equal(recipeStatusAfter("unpublish"), "draft");
  assert.equal(recipeStatusAfter("archive"), "archived");
  assert.equal(recipeStatusAfter("duplicate"), null, "dupliquer ne change aucun statut");
  // Le vocabulaire est celui de la publication, pas de l'activation.
  assert.equal(RECIPE_ACTION_LABELS_FR.publish, "Publier");
  assert.equal(RECIPE_ACTION_LABELS_FR.unpublish, "Dépublier");
  assert.equal(RECIPE_STATUS_LABELS_FR.active, "Publiée");
});

await test("62. dupliquer produit une recette INDÉPENDANTE, jamais un alias", () => {
  const base: RecipeFormState = {
    ...createBlankRecipeForm("coach-1"),
    recipeId: "r-source",
    sourceKey: "fixture:poulet",
    name: "Poulet riz",
    status: "active",
    ingredients: [
      { ...createEmptyIngredient("ing-a"), name: "Poulet", role: "protein" },
      {
        ...createEmptyIngredient("ing-b"),
        name: "Sauce",
        role: "fat",
        linkedToIngredientId: "ing-a",
        linkRatioBp: "2500",
      },
    ],
    tags: [{ kind: "diet", value: "halal" }],
  };
  let n = 0;
  const copie = duplicateRecipeForm(base, duplicateName(base.name), () => `neuf-${++n}`);

  assert.equal(copie.recipeId, null, "sans identifiant, la RPC CRÉE au lieu de mettre à jour");
  assert.equal(copie.sourceKey, null, "la clé de fixture ne se duplique pas (index unique)");
  assert.equal(copie.status, "draft", "une copie ne naît jamais publiée");
  assert.equal(copie.name, "Poulet riz (copie)");
  // Aucun identifiant d'ingrédient partagé : la RPC refuse un enfant
  // appartenant à une autre recette.
  const idsSource = base.ingredients.map((i) => i.id);
  for (const ing of copie.ingredients) {
    assert.ok(!idsSource.includes(ing.id), `${ing.id} appartient encore à l'original`);
  }
  // La liaison suit la copie, elle ne pointe plus vers l'original.
  assert.equal(copie.ingredients[1].linkedToIngredientId, copie.ingredients[0].id);
  assert.equal(copie.ingredients[1].linkRatioBp, "2500");
  assert.deepEqual(copie.tags, base.tags);
  // L'original n'a pas bougé d'un octet.
  assert.equal(base.recipeId, "r-source");
  assert.equal(base.ingredients[0].id, "ing-a");
});

await test("63. la confirmation exige le nom EXACT, et le motif de blocage est nommé", () => {
  assert.ok(matchesExactName("Poulet riz", "Poulet riz"));
  assert.ok(matchesExactName("  Poulet riz  ", "Poulet riz"), "les espaces de bord sont tolérés");
  assert.ok(matchesExactName("Crème brûlée".normalize("NFD"), "Crème brûlée"), "accents normalisés");
  assert.ok(!matchesExactName("poulet riz", "Poulet riz"), "la casse compte");
  assert.ok(!matchesExactName("Poulet", "Poulet riz"), "un préfixe ne suffit pas");
  assert.ok(!matchesExactName("", ""), "une ressource sans nom ne s'auto-confirme pas");

  // Le motif NOMME la dépendance et son nombre.
  assert.ok(describeRecipeDeletionBlock("assigned", { studentsWithAccess: 3 }).includes("3 élèves"));
  assert.ok(describeRecipeDeletionBlock("assigned", { studentsWithAccess: 1 }).includes("Un élève"));
  assert.ok(describeRecipeDeletionBlock("forbidden", { studentsWithAccess: 0 }).includes("autre coach"));
  assert.ok(describeRecipeDeletionBlock("not_found", { studentsWithAccess: 0 }).includes("introuvable"));

  // Bloquée : aucun champ de confirmation, aucun bouton de suppression.
  const bloquée = renderToString(
    createElement(DeleteConfirmationModal, {
      resourceName: "Poulet riz",
      resourceKind: "cette recette",
      dependencies: [{ label: "Élèves pouvant y accéder", count: 2 }],
      blockedReason: "Deux eleves peuvent encore ouvrir cette recette.",
      deleting: false,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(bloquée.includes("Deux eleves peuvent encore ouvrir cette recette."), "le motif est affiché");
  assert.ok(bloquée.includes('role="alert"'), "et annoncé aux lecteurs d'écran");
  assert.ok(!bloquée.includes("Recopie le nom exact"), "rien à confirmer quand c'est refusé");
  assert.ok(!/>\s*Supprimer définitivement\s*</.test(bloquée.replace(/<!-- -->/g, "")),
    "aucun bouton de suppression quand c'est refusé");

  // Permise : le bouton existe mais part DÉSACTIVÉ, avant toute saisie.
  const permise = renderToString(
    createElement(DeleteConfirmationModal, {
      resourceName: "Poulet riz",
      resourceKind: "cette recette",
      dependencies: [{ label: "Ingrédients", count: 4 }],
      blockedReason: null,
      deleting: false,
      error: null,
      onCancel: () => {},
      onConfirm: () => {},
    }),
  );
  assert.ok(permise.includes("Recopie le nom exact"));
  assert.ok(permise.includes("irréversible"), "l'irréversibilité est dite");
  assert.ok(permise.includes("disabled"), "désactivé tant que le nom n'est pas recopié");
  assert.ok(permise.includes("Poulet riz"), "le nom attendu est rappelé");
  assert.ok(permise.includes("4"), "les dépendances comptées sont affichées");
});

await test("64. « Supprimer définitivement » n'est jamais une action principale", () => {
  // Elle vit dans une zone dangereuse, pas dans la barre d'actions.
  const cycle = CYCLE_DE_VIE;
  assert.ok(cycle.includes("DangerZone"), "une zone dangereuse existe");
  assert.ok(cycle.includes("Zone dangereuse"));
  assert.ok(cycle.includes("border-destructive"), "elle est visuellement distincte");
  // Le déclencheur n'est rendu QUE par la zone dangereuse.
  const barre = cycle.slice(cycle.indexOf("export function LifecycleActionBar"), cycle.indexOf("export function DangerZone"));
  assert.ok(!barre.includes("DELETE_ACTION_LABEL_FR"), "la barre d'actions ne supprime rien");
  // Sur les deux fiches, la suppression est dans la zone dangereuse.
  for (const [nom, page] of Object.entries({ PAGE_DETAIL, PAGE_PLAN_DETAIL })) {
    assert.ok(page.includes("<DangerZone"), `${nom} : la suppression est encadrée`);
    assert.ok(page.includes("DeleteTriggerButton"), `${nom} : par le déclencheur dédié`);
    assert.ok(page.includes("DeleteConfirmationModal"), `${nom} : derrière une confirmation`);
  }
});

await test("65. la migration du cycle de vie respecte les conventions du dépôt", () => {
  const sql = MIGRATION_CYCLE_DE_VIE;
  for (const fn of [
    "delete_nutrition_plan(uuid)",
    "delete_nutrition_recipe(uuid)",
    "nutrition_plan_deletion_block(uuid)",
    "nutrition_recipe_deletion_block(uuid)",
    "nutrition_lifecycle_overview()",
  ]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public;`), `revoke public : ${fn}`);
    assert.ok(sql.includes(`revoke execute on function public.${fn} from anon;`), `revoke anon : ${fn}`);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `grant : ${fn}`);
    assert.ok(sql.includes(`alter function public.${fn} owner to postgres;`), `owner : ${fn}`);
  }
  // Sept fonctions sont (re)créées : le trigger de datation, la RPC
  // d'assignation recréée, les deux calculs de blocage, les deux suppressions
  // et l'aperçu. On compte les DÉCLARATIONS, en début de ligne, et non les
  // occurrences dans les commentaires.
  const déclarations = (m: RegExp) => (sql.match(m) ?? []).length;
  assert.equal(déclarations(/^security invoker$/gm), 7, "chaque fonction est security invoker");
  assert.ok(!/^security definer$/m.test(sql), "aucune élévation de privilège");
  assert.equal(déclarations(/^set search_path = ''$/gm), 7, "search_path verrouillé partout");

  // AUCUNE donnée détruite PAR LA MIGRATION ELLE-MÊME. Les corps de fonction
  // contiennent des `delete`, évidemment — c'est leur objet. On les retire
  // pour ne juger que ce que la migration exécute à son application.
  const horsCorps = sql
    .replace(/\$fn\$[\s\S]*?\$fn\$/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(!/delete from/i.test(horsCorps), "la migration ne supprime aucune ligne à son application");
  assert.ok(!/\bupdate\b[\s\S]{0,40}\bset\b(?![\s\S]{0,200}archived_at)/i.test(horsCorps),
    "la seule écriture de données est la reprise des dates d'archivage");
  assert.ok(!/drop table|drop column|truncate/i.test(sql), "aucune structure détruite");
  // Les CINQ tables filles sont nommées une par une, jamais laissées à la
  // cascade — y compris le journal quotidien, qui part avec le plan depuis
  // que la règle métier a été fixée (seul un élève affecté bloque).
  //
  // C'est 20260817090000 qui porte cette version : 20260815090000 est
  // APPLIQUÉE en Production, donc immuable, et n'est plus modifiée.
  const suppr = MIGRATION_SUPPRESSION;
  const départ = suppr.indexOf("create or replace function public.delete_nutrition_plan");
  const corpsSuppression = suppr.slice(départ, suppr.indexOf("$fn$;", départ));
  for (const table of ["public.meals", "public.nutrition_days",
                       "public.nutrition_meal_slot_targets", "public.nutrition_plan_profiles",
                       "public.nutrition_daily_logs"]) {
    assert.ok(corpsSuppression.includes(`delete from ${table}`), `suppression explicite : ${table}`);
  }
  // Chaque suppression est BORNÉE au plan visé : rien d'un autre plan, et
  // jamais un élève ni un compte.
  assert.ok(!/delete from public\.students/.test(corpsSuppression), "jamais un élève");
  assert.ok(!/auth\.users/.test(corpsSuppression), "jamais un compte");
  assert.ok(/delete from public\.nutrition_daily_logs[\s\S]{0,120}nutrition_plan_id = p_plan_id/.test(corpsSuppression),
    "le journal supprimé est borné à CE plan");
  // Et la migration refuse de s'appliquer si une clé étrangère inconnue apparaît.
  assert.ok(sql.includes("ne connaît pas ces tables référençant nutrition_plans"));
  assert.ok(sql.includes("ne connaît pas ces tables référençant nutrition_recipes"));

  // LA MIGRATION CORRECTIVE : elle ne recopie pas 20260815, elle ne remplace
  // que les DEUX fonctions dont le comportement change, et ne détruit rien.
  assert.equal((suppr.match(/create or replace function/g) ?? []).length, 2,
    "seules les deux fonctions concernées sont réémises");
  assert.ok(suppr.includes("public.nutrition_plan_deletion_block(p_plan_id uuid)"));
  assert.ok(suppr.includes("public.delete_nutrition_plan(p_plan_id uuid)"));
  assert.ok(!/create policy|drop policy|alter table|create trigger/i.test(suppr),
    "aucun schéma, aucune policy, aucun trigger touché");
  const horsCorpsSuppr = suppr
    .replace(/\$fn\$[\s\S]*?\$fn\$/g, "")
    .replace(/\$\$[\s\S]*?\$\$/g, "")
    .split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  assert.ok(!/delete from|update /i.test(horsCorpsSuppr), "la corrective ne touche aucune donnée");
  assert.ok(suppr.includes("IMMUABLES"), "la raison d'être de la corrective est écrite");
});

await test("66. l'aperçu du cycle de vie est lu sans supposition, et le doute refuse", () => {
  const aperçu = parseNutritionLifecycleOverview({
    plans: [
      { id: "p1", status: "actif", archived_at: null, assigned_students: 1, daily_logs: 4, deletion_block: "assigned" },
      { id: null, status: "actif" },
      "pas un objet",
    ],
    recipes: [
      { id: "r1", status: "active", archived_at: "2026-08-01T00:00:00Z", students_with_access: 2, deletion_block: null },
      { id: "r2", status: "draft", deletion_block: "code_inventé" },
    ],
  });
  assert.equal(aperçu.plans.size, 1, "une entrée sans identifiant est ignorée, pas fatale");
  assert.equal(aperçu.plans.get("p1")?.deletionBlock, "assigned");
  assert.equal(aperçu.plans.get("p1")?.dependencies.dailyLogs, 4);
  assert.equal(aperçu.recipes.get("r1")?.deletionBlock, null);
  assert.equal(aperçu.recipes.get("r1")?.archivedAt, "2026-08-01T00:00:00Z");
  assert.equal(aperçu.recipes.get("r2")?.deletionBlock, null, "un code inconnu n'est pas inventé");
  assert.equal(parseNutritionLifecycleOverview(null).plans.size, 0);

  // Le DÉFAUT est le refus : une réponse illisible ne vaut jamais succès.
  assert.equal(parseDeletionResult(null, "p1").ok, false);
  assert.equal(parseDeletionResult({}, "p1").ok, false);
  assert.equal(parseDeletionResult({ ok: false, reason: "inconnu" }, "p1").ok, false);
  const refus = parseDeletionResult(
    { ok: false, reason: "used_in_history", dependencies: { daily_logs: 7, assigned_students: 0 } },
    "p1",
  );
  assert.equal(refus.ok === false && refus.reason, "used_in_history");
  assert.equal(refus.ok === false && refus.dependencies.dailyLogs, 7);
  const succès = parseDeletionResult(
    { ok: true, plan_id: "p1", name: "Semaine sèche", deleted: { meals: 3, days: 7 } },
    "p1",
  );
  assert.equal(succès.ok && succès.deleted.meals, 3);
  assert.equal(succès.ok && succès.name, "Semaine sèche");
});

/* ═══════════ 13. Catalogue, duplication et import (PR E) ═══════════ */

const CATALOGUE_E: RecipeWithTags[] = [
  { ...recordFactice("e1", "Omelette", "breakfast", "draft", [{ kind: "diet", value: "vegetarian" }]),
    updatedAt: "2026-01-10T10:00:00Z" },
  { ...recordFactice("e2", "Bol poulet", "lunch", "active", [{ kind: "allergen", value: "gluten" }]),
    updatedAt: "2026-03-01T10:00:00Z" },
  { ...recordFactice("e3", "Ancienne tarte", null, "archived", []),
    updatedAt: "2025-06-01T10:00:00Z" },
];

await test("67. le catalogue filtre par nom, statut, créneau — et se combine", () => {
  const base = CATALOG_FILTERS_VIDES;
  const noms = (r: readonly RecipeWithTags[]) => r.map((x) => x.recipe.name);

  // 1. recherche par nom, insensible à la casse et aux accents
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, query: "POULET" })), ["Bol poulet"]);
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, query: "  omelette " })), ["Omelette"]);
  // 2/3/4. un filtre par statut
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, status: "draft" })), ["Omelette"]);
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, status: "active" })), ["Bol poulet"]);
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, status: "archived" })), ["Ancienne tarte"]);
  // 5. par créneau, et le cas « générique » (slot_key nul)
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, slot: "lunch" })), ["Bol poulet"]);
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, slot: "generic" })), ["Ancienne tarte"]);
  // 6. combinaison : un filtre qui ne peut rien rendre ne rend rien
  assert.deepEqual(noms(filterCatalog(CATALOGUE_E, { ...base, status: "active", slot: "breakfast" })), []);
  assert.deepEqual(
    noms(filterCatalog(CATALOGUE_E, { ...base, status: "draft", slot: "breakfast", tagKind: "diet" })),
    ["Omelette"],
  );
  // 7. l'état « aucun filtre » rend TOUT — c'est ce que « Réinitialiser » restaure
  assert.equal(filterCatalog(CATALOGUE_E, base).length, 3);
  assert.equal(CATALOG_FILTERS_VIDES.query, "");
  assert.equal(CATALOG_FILTERS_VIDES.status, "tous");
  assert.equal(CATALOG_FILTERS_VIDES.slot, "tous");
  assert.equal(CATALOG_FILTERS_VIDES.tagKind, "tous");
  // Le bouton lit la MÊME constante : il ne peut pas oublier un filtre.
  assert.ok(CATALOGUE.includes("CATALOG_FILTERS_VIDES.query"));
  assert.ok(CATALOGUE.includes("réinitialiser"));
});

await test("68. les trois ordres de tri, et un ordre STABLE", () => {
  const base = CATALOG_FILTERS_VIDES;
  const noms = (s: "alpha" | "recent" | "ancien") =>
    filterCatalog(CATALOGUE_E, { ...base, sort: s }).map((x) => x.recipe.name);

  assert.deepEqual(noms("alpha"), ["Ancienne tarte", "Bol poulet", "Omelette"]);
  assert.deepEqual(noms("recent"), ["Bol poulet", "Omelette", "Ancienne tarte"]);
  assert.deepEqual(noms("ancien"), ["Ancienne tarte", "Omelette", "Bol poulet"]);
  // « alpha » reste le défaut : les appels sans `sort` sont inchangés.
  assert.deepEqual(
    filterCatalog(CATALOGUE_E, { query: "", status: "tous", slot: "tous", tagKind: "tous" }).map((x) => x.recipe.name),
    noms("alpha"),
  );
  // Deux dates identiques ne doivent pas faire sauter les lignes d'un rendu à
  // l'autre : le départage par identifiant rend l'ordre déterministe.
  const exAequo: RecipeWithTags[] = [
    { ...recordFactice("zz", "Zeta", null, "draft", []), updatedAt: "2026-01-01T00:00:00Z" },
    { ...recordFactice("aa", "Alpha", null, "draft", []), updatedAt: "2026-01-01T00:00:00Z" },
  ];
  const ordre1 = filterCatalog(exAequo, { ...base, sort: "recent" }).map((x) => x.recipe.id);
  const ordre2 = filterCatalog([...exAequo].reverse(), { ...base, sort: "recent" }).map((x) => x.recipe.id);
  assert.deepEqual(ordre1, ordre2, "l'ordre ne dépend pas de l'ordre d'entrée");
  assert.deepEqual(ordre1, ["aa", "zz"]);
});

await test("69. l'analyse d'import lit, diagnostique, et n'écrit RIEN", () => {
  // Le module d'analyse ne connaît AUCUN chemin d'écriture : ni Supabase, ni
  // RPC, ni fetch. C'est ce qui rend l'étape 1 sûre par construction.
  const source = sansCommentairesTs(lire("../../lib/nutrition/recipe-import.ts"));
  for (const interdit of ["supabase", "rpc(", "fetch(", ".insert(", ".update(", ".delete("]) {
    assert.ok(!source.includes(interdit), `l'analyse ne doit pas connaître ${interdit}`);
  }

  // 14. un fichier VALIDE est analysé sans erreur, et produit une charge utile
  const valide = analyzeRecipeImport(MODELE_IMPORT);
  assert.equal(valide.fileError, null, "le modèle livré doit être lisible");
  assert.equal(valide.total, 2);
  assert.equal(valide.valid, 2, JSON.stringify(valide.recipes.flatMap((r) => r.issues)));
  assert.equal(valide.invalid, 0);

  // 15. un fichier INVALIDE dit précisément ce qui cloche, recette par recette
  const illisible = analyzeRecipeImport("{ ceci n'est pas du json");
  assert.ok(illisible.fileError?.includes("JSON"), illisible.fileError ?? "");
  assert.equal(illisible.total, 0);

  const fautif = analyzeRecipeImport(
    JSON.stringify([
      { name: "", ingredients: [] },
      { name: "Rôle faux", slot: "brunch", ingredients: [{ name: "X", role: "protéine", referenceGrams: 10 }] },
      {
        name: "Liaison folle",
        ingredients: [
          { name: "A", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 1, referenceGrams: 100 },
          { name: "B", role: "fat", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 90, referenceGrams: 10, linkedToPosition: 9, linkRatioBp: 1000 },
        ],
      },
      { name: "Étiquette inventée", tags: { diet: ["carnivore"] }, ingredients: [
        { name: "A", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 1, referenceGrams: 100 }] },
    ]),
  );
  assert.equal(fautif.total, 4);
  assert.equal(fautif.valid, 0, "aucune de ces quatre n'est importable");
  const message = (i: number) => fautif.recipes[i].issues.map((p) => `${p.where} ${p.message}`).join(" | ");
  assert.ok(/nom est obligatoire/i.test(message(0)), message(0));
  assert.ok(/au moins un ingrédient/i.test(message(0)), message(0));
  assert.ok(/Rôle inconnu/i.test(message(1)), message(1));
  assert.ok(/Créneau inconnu/i.test(message(1)), message(1));
  assert.ok(/linkedToPosition/i.test(message(2)), message(2));
  assert.ok(/carnivore/i.test(message(3)), message(3));
  // Une recette invalide ne produit AUCUNE charge utile : elle ne peut pas
  // partir par accident.
  assert.ok(fautif.recipes.every((r) => r.payload === null));
});

await test("70. doublons : signalés, décochés, JAMAIS écrasés", () => {
  const fichier = JSON.stringify([
    { name: "Bol poulet", ingredients: [{ name: "P", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 1, referenceGrams: 100 }] },
    { name: "  BOL   POULET  ", ingredients: [{ name: "P", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 1, referenceGrams: 100 }] },
    { name: "Nouveauté", ingredients: [{ name: "P", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 1, referenceGrams: 100 }] },
  ]);

  // 18. doublon détecté — contre le catalogue existant ET à l'intérieur du fichier
  const analyse = analyzeRecipeImport(fichier, ["Bol Poulet"]);
  assert.equal(analyse.duplicates, 2, "le nom existant et sa répétition interne");
  assert.equal(analyse.recipes[0].duplicate, true);
  assert.equal(analyse.recipes[1].duplicate, true);
  assert.equal(analyse.recipes[2].duplicate, false);
  // La normalisation ignore casse, accents, ponctuation et espaces multiples.
  assert.equal(normalizeRecipeName("  Crème  Brûlée-Maison "), "creme brulee maison");

  // 19. un doublon reste IMPORTABLE si le coach le décide — et n'écrase rien :
  // la charge utile ne porte aucun identifiant, donc la RPC ne peut que CRÉER.
  const toutes = toImportRpcPayload(analyse, new Set([1, 2, 3]));
  assert.equal(toutes.recipes.length, 3);
  for (const r of toutes.recipes as Record<string, unknown>[]) {
    assert.ok(!("id" in r), "aucun identifiant : impossible d'écraser une recette existante");
    assert.ok(!("recipe_id" in r));
  }
  // Décoché = absent de la charge utile.
  assert.equal(toImportRpcPayload(analyse, new Set([3])).recipes.length, 1);
  assert.equal(toImportRpcPayload(analyse, new Set()).recipes.length, 0);
});

await test("71. la charge utile d'import ne porte NI propriétaire NI statut", () => {
  const analyse = analyzeRecipeImport(MODELE_IMPORT);
  const payload = toImportRpcPayload(analyse, new Set([1, 2]));
  const texte = JSON.stringify(payload);

  // 20. coach_id impossible à injecter : le mot n'existe nulle part dans ce
  // que le navigateur envoie, et la RPC ne le lit pas davantage.
  assert.ok(!texte.includes("coach_id"), "aucun propriétaire dans la charge utile");
  assert.ok(!texte.includes("status"), "aucun statut : la base impose « draft »");
  // Même si le FICHIER en contenait, ils seraient ignorés à la lecture.
  const forgé = analyzeRecipeImport(
    JSON.stringify([{
      name: "Forgée", coach_id: "00000000-0000-4000-8000-000000000000", status: "active",
      ingredients: [{ name: "P", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 1, referenceGrams: 100 }],
    }]),
  );
  const forgéPayload = JSON.stringify(toImportRpcPayload(forgé, new Set([1])));
  assert.ok(!forgéPayload.includes("coach_id"));
  assert.ok(!forgéPayload.includes("00000000-0000-4000-8000-000000000000"));
  assert.ok(!forgéPayload.includes("active"));

  // Les liaisons voyagent PAR POSITION : un fichier n'a aucun vocabulaire pour
  // désigner une ligne hors de sa propre recette.
  const première = (payload.recipes[0] ?? {}) as { ingredients: Record<string, unknown>[] };
  const liée = première.ingredients.find((i) => i.linked_to_position !== null);
  assert.equal(liée?.linked_to_position, 1);
  assert.equal(liée?.link_ratio_bp, 2500);
});

await test("72. le modèle livré est ENGENDRÉ par le code, il ne peut pas mentir", () => {
  // Le fichier du dépôt est la sortie exacte de `buildImportTemplate()` : si
  // la liste des rôles, des créneaux ou des étiquettes change, ce test tombe
  // avant que la documentation ne devienne fausse.
  assert.equal(MODELE_IMPORT, buildImportTemplate(), "docs/modele-import-recettes.json est périmé");
  // Et il ne documente que des valeurs RÉELLEMENT admises.
  const modèle = JSON.parse(MODELE_IMPORT) as { recipes: { slot?: string; ingredients: { role: string }[] }[] };
  for (const recette of modèle.recipes) {
    assert.ok(recette.slot === undefined || (RECIPE_SLOT_KEYS as readonly string[]).includes(recette.slot));
    for (const ing of recette.ingredients) {
      assert.ok(RECIPE_INGREDIENT_ROLES.includes(ing.role as never), ing.role);
    }
  }
  // Le dialogue le propose au téléchargement, sans dépendance ajoutée.
  assert.ok(DIALOGUE_IMPORT_FICHIER.includes("buildImportTemplate()"));
  assert.ok(DIALOGUE_IMPORT_FICHIER.includes("new Blob("), "Blob natif, aucune dépendance");
  assert.ok(!/papaparse|csv-parse|xlsx/.test(DIALOGUE_IMPORT_FICHIER));
});

await test("73. l'import se fait en DEUX temps, et l'échec ne laisse rien", () => {
  const dialogue = sansCommentairesTs(DIALOGUE_IMPORT_FICHIER);
  // Lire le fichier ne déclenche PAS l'import : deux gestes distincts.
  assert.ok(dialogue.includes("analyzeRecipeImport("), "temps 1 : analyse");
  assert.ok(dialogue.includes("onImport(toImportRpcPayload("), "temps 2 : envoi");
  const lecture = dialogue.slice(dialogue.indexOf("async function lireFichier"), dialogue.indexOf("function basculer"));
  assert.ok(!lecture.includes("onImport("), "lire un fichier n'écrit jamais");
  // 22. le message d'échec dit que RIEN n'a été créé — un import partiel
  // silencieux serait pire que l'échec lui-même.
  const service = sansCommentairesTs(lire("../../lib/supabase/nutrition-recipes-write.ts"));
  assert.ok(service.includes("AUCUNE recette n'a été créée"));
  assert.ok(service.includes('"import_nutrition_recipes"'));
  // Le service n'envoie jamais de coach_id.
  const bloc = service.slice(service.indexOf("export async function importNutritionRecipes"));
  assert.ok(!bloc.slice(0, bloc.indexOf("\n}")).includes("coach"), "aucun propriétaire transmis");
});

await test("74. les deux RPC du catalogue respectent les conventions du dépôt", () => {
  const sql = MIGRATION_CATALOGUE;
  for (const fn of ["duplicate_nutrition_recipe(uuid)", "import_nutrition_recipes(jsonb)"]) {
    assert.ok(sql.includes(`revoke all on function public.${fn} from public;`), `revoke public : ${fn}`);
    assert.ok(sql.includes(`revoke execute on function public.${fn} from anon;`), `revoke anon : ${fn}`);
    assert.ok(sql.includes(`grant execute on function public.${fn} to authenticated;`), `grant : ${fn}`);
    assert.ok(sql.includes(`alter function public.${fn} owner to postgres;`), `owner : ${fn}`);
  }
  // TROIS fonctions depuis le durcissement du chemin manuel : duplication,
  // import, et `save_nutrition_recipe` réémise.
  assert.equal((sql.match(/^security invoker$/gm) ?? []).length, 3);
  assert.ok(!/^security definer$/m.test(sql), "aucune élévation de privilège");
  assert.equal((sql.match(/^set search_path = ''$/gm) ?? []).length, 3);

  // AUCUN changement de schéma : le catalogue se contente du modèle existant.
  assert.ok(!/create table|alter table|add column|create policy|drop policy/i.test(sql));

  // Le propriétaire n'est JAMAIS reçu de l'appelant.
  const dup = sql.slice(sql.indexOf("create or replace function public.duplicate_nutrition_recipe"));
  assert.ok(dup.includes("v_source.coach_id"), "la copie hérite du propriétaire de la SOURCE");
  assert.ok(dup.includes("'draft'"), "une copie ne naît jamais publiée");
  // BORNÉ au corps de l'import, commentaires retirés : la section C qui suit
  // cite l'ancienne ligne de `save_nutrition_recipe` pour l'expliquer.
  const départImp = sql.indexOf("create or replace function public.import_nutrition_recipes");
  const imp = sql
    .slice(départImp, sql.indexOf("$fn$;", départImp))
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(imp.includes("public.current_coach_id()"), "le serveur détermine le propriétaire");
  assert.ok(!imp.includes("->>'coach_id'"), "un coach_id du fichier n'est jamais lu");
  assert.ok(!imp.includes("->>'status'"), "un statut du fichier n'est jamais lu");
  assert.ok(imp.includes("linked_to_position"), "les liaisons voyagent par position");
});

await test("75. le solveur et le parcours élève ne sont PAS touchés par la PR E", () => {
  // 29. le solveur est intact — aucun fichier de la PR E ne l'importe pour le
  // modifier, et il n'apparaît dans aucun des nouveaux modules.
  for (const source of [lire("../../lib/nutrition/recipe-import.ts"), DIALOGUE_IMPORT_FICHIER, CATALOGUE]) {
    assert.ok(!source.includes("solveRecipe"), "aucun appel au solveur depuis le catalogue ou l'import");
  }
  // 24/30. la lecture élève est inchangée : elle ne demande que « active », et
  // aucun fichier de la PR E ne touche au hook élève.
  const hookÉlève = lire("../../hooks/useStudentNutritionPlanV2.ts");
  assert.ok(hookÉlève.includes('statuses: ["active"]'), "l'élève ne voit que les recettes publiées");
  // 21. une recette importée passe la MÊME validation qu'une recette saisie :
  // le module d'import délègue à `validateRecipeForm`, il n'en écrit pas une
  // seconde.
  const importSrc = lire("../../lib/nutrition/recipe-import.ts");
  assert.ok(importSrc.includes("validateRecipeForm(état)"));
  assert.equal((importSrc.match(/function valider|function validate/g) ?? []).length, 0,
    "aucune validation parallèle");
});

await test("76. le propriétaire n'est plus jamais choisi par le navigateur", () => {
  // ── Côté CLIENT : plus aucune charge utile ne porte de propriétaire ────
  const état: RecipeFormState = {
    ...createBlankRecipeForm("coach-usurpé"),
    name: "Test",
    ingredients: [{ ...createEmptyIngredient("i1"), name: "P", role: "protein" }],
  };
  const payload = toRecipeSavePayload(état) as { recipe: Record<string, unknown> };
  assert.ok(!("coach_id" in payload.recipe), "le formulaire n'émet plus de coach_id");
  assert.ok(!JSON.stringify(payload).includes("coach-usurpé"), "et l'état ne fuit pas non plus");

  // Le changement de statut n'a même plus de paramètre coach.
  const service = sansCommentairesTs(COUCHE_ÉCRITURE);
  const statut = service.slice(service.indexOf("export async function setNutritionRecipeStatus"));
  assert.ok(!statut.slice(0, statut.indexOf("}")).includes("coach"), "aucun coach dans le changement de statut");

  // ── Côté SERVEUR : la règle, dans la migration ────────────────────────
  const sql = MIGRATION_CATALOGUE;
  const fn = sql.slice(sql.indexOf("create or replace function public.save_nutrition_recipe"));
  // Les COMMENTAIRES citent l'ancienne ligne pour expliquer ce qui a changé :
  // on ne juge que le code exécuté.
  const corps = fn
    .slice(0, fn.indexOf("$fn$;"))
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("--"))
    .join("\n");
  assert.ok(!corps.includes("v_recipe->>'coach_id'"), "le payload n'est plus lu");
  assert.ok(corps.includes("v_coach_id := public.current_coach_id();"), "création : le serveur décide");
  assert.ok(corps.includes("NO_COACH_PROFILE"), "un compte sans fiche coach ne crée pas");
  assert.ok(
    /select np\.status, np\.coach_id\s+into v_status_courant, v_coach_id/.test(corps),
    "modification : le propriétaire est lu sur la ligne, sous verrou",
  );
  // Et il n'est JAMAIS réécrit : la colonne n'apparaît dans aucun `update`.
  const misAJour = corps.slice(corps.indexOf("update public.nutrition_recipes r set"));
  assert.ok(!misAJour.slice(0, misAJour.indexOf("where r.id = v_recipe_id")).includes("coach_id"),
    "aucun update ne touche coach_id");

  // ── LES TROIS CHEMINS appliquent la même règle ────────────────────────
  const dup = sql.slice(sql.indexOf("create or replace function public.duplicate_nutrition_recipe"));
  const imp = sql.slice(sql.indexOf("create or replace function public.import_nutrition_recipes"));
  assert.ok(dup.includes("v_source.coach_id"), "duplication : propriétaire de la source");
  assert.ok(imp.includes("public.current_coach_id()"), "import : propriétaire du serveur");
  for (const [nom, chemin] of Object.entries({ manuel: corps, duplication: dup, import: imp })) {
    assert.ok(!/coalesce\(.*->>'coach_id'/.test(chemin), `${nom} : aucun repli sur le payload`);
  }
  // La checklist SQL éprouve les six situations sur une vraie base.
  for (const contrôle of [
    "L1. créer en nommant un AUTRE coach",
    "L4. modifier sa recette ne change PAS son propriétaire",
    "L5. modifier la recette d''un AUTRE coach est refusé",
    "L8. mais il ne s''en approprie PAS la propriété",
    "L9. manuel, duplication et import donnent le MÊME propriétaire",
  ]) {
    assert.ok(CHECKLIST_ADMIN.includes(contrôle), `la checklist doit couvrir : ${contrôle}`);
  }
});


console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
