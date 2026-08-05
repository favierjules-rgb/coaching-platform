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
  parseRecipeWriteResult,
} from "../../lib/supabase/nutrition-recipes-write";
import { RecipeCatalog, filterCatalog, formatUpdatedAt } from "../../components/admin/RecipeCatalog";
import { RecipeTagsPanel } from "../../components/admin/RecipeTagsPanel";
import { RecipeAdaptivePreview } from "../../components/admin/RecipeAdaptivePreview";
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
const CHECKLIST = lire("../../supabase/tests/nutrition_recipes_admin_checklist.sql");
const COUCHE_ÉCRITURE = lire("../../lib/supabase/nutrition-recipes-write.ts");
const COUCHE_LECTURE = lire("../../lib/supabase/nutrition-recipes.ts");
const FORM = lire("../../lib/nutrition/recipe-form.ts");
const APERÇU = lire("../../components/admin/RecipeAdaptivePreview.tsx");
const BUILDER = lire("../../components/admin/RecipeBuilder.tsx");
const CATALOGUE = lire("../../components/admin/RecipeCatalog.tsx");
const PANNEAU_TAGS = lire("../../components/admin/RecipeTagsPanel.tsx");
const DIALOGUE_IMPORT = lire("../../components/admin/RecipeFixtureImportDialog.tsx");
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
  // Le bouton brouillon n'est jamais désactivé par la validation.
  assert.ok(BUILDER.includes('disabled={saving}\n          onClick={() => onSave("draft")}'));
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

await test("33. l'archivage est un STATUT : aucun chemin de suppression définitive", () => {
  assert.ok(COUCHE_ÉCRITURE.includes('status: "archived"'));
  for (const [nom, source] of Object.entries({ BUILDER, PAGE_DETAIL, PAGE_LISTE, COUCHE_ÉCRITURE })) {
    assert.ok(!/\.delete\(\)/.test(sansCommentairesTs(source)), `${nom} : aucune suppression`);
    assert.ok(!/supprimer définitivement|hard delete/i.test(source), `${nom} : aucun libellé de suppression`);
  }
  assert.ok(BUILDER.includes("Archiver cette recette ?"), "confirmation avant archivage");
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
  for (const [nom, source] of Object.entries({ PAGE_LISTE, DIALOGUE_IMPORT })) {
    const code = sansCommentairesTs(source);
    // Aucun useEffect n'appelle l'import.
    const effets = [...code.matchAll(/useEffect\([\s\S]*?\)\s*;/g)].map((m) => m[0]);
    for (const effet of effets) {
      assert.ok(!/import/i.test(effet), `${nom} : un useEffect déclenche l'import`);
    }
    assert.ok(!/importNutritionRecipeFixtures\(\s*\)/.test(code), `${nom} : appel sans intention`);
  }
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
  const sources = { BUILDER, CATALOGUE, PANNEAU_TAGS, DIALOGUE_IMPORT, APERÇU };
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
  assert.equal(attendues.length, 15);
  assert.ok(attendues.includes("20260808090000_save_nutrition_recipe.sql"));
  const secu = lire("../../scripts/tests/security-hardening.mts");
  assert.ok(secu.includes(".length, 42,"), "le compteur de migrations suit les migrations réelles");
  assert.ok(secu.includes("assert.equal(attendues.length, 15);"));
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
