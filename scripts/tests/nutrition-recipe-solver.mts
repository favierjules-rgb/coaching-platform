/**
 * Harnais — feat/nutrition-adaptive-recipes, PR 1, volets D et E.
 *
 * Solveur adaptatif de recettes : systèmes 1×1, 2×2 et 3×3, ingrédients
 * fixes / libres / œufs / unités entières, ingrédients LIÉS résolus en deux
 * passes, substitutions sans mutation, et surtout RE-RÉSOLUTION après borne
 * atteinte — pas un simple clamp final.
 *
 * Les fixtures viennent du prototype `App.jsx` (voir
 * scripts/tests/fixtures/nutrition-recipes.ts). Aucune dépendance au
 * composant React d'origine à l'exécution.
 *
 * Lancement : npx tsx scripts/tests/nutrition-recipe-solver.mts
 */
import assert from "node:assert/strict";

import {
  APPROXIMATE_TOLERANCE_GRAMS,
  EXACT_TOLERANCE_GRAMS,
  applySubstitutions,
  determineStatus,
  solveRecipe,
} from "../../lib/nutrition/recipe-solver";
import type { Recipe } from "../../lib/nutrition/recipe-types";
import {
  CIBLE_IMPOSSIBLE,
  CIBLE_NULLE,
  CIBLE_PROTOTYPE,
  RECETTE_DEUX_GROUPES,
  RECETTE_FIXE_ET_UNITES,
  RECETTE_MAXIMUM,
  RECETTE_MINIMUM,
  RECETTE_OEUF,
  RECETTE_PANURE_LIEE,
  RECETTE_PROPORTIONNELLE,
  RECETTE_SIMPLE_PGL,
  RECETTE_SINGULIERE,
  RECETTE_UNITE_ENTIERE,
  RECETTE_UN_GROUPE,
  SUBSTITUTION_POULET_VERS_BOEUF,
} from "./fixtures/nutrition-recipes";

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

const grammes = (solution: ReturnType<typeof solveRecipe>, id: string): number =>
  solution.ingredients.find((i) => i.ingredientId === id)?.grams ?? Number.NaN;

const ingr = (solution: ReturnType<typeof solveRecipe>, id: string) =>
  solution.ingredients.find((i) => i.ingredientId === id);

/* ── 1. Un seul groupe (système 1×1) ────────────────────────────────────── */
test("1. un seul groupe : la cible de sa macro est atteinte exactement", () => {
  const solution = solveRecipe(RECETTE_UN_GROUPE, {
    target: { proteinGrams: 50, carbGrams: 0, fatGrams: 0 },
  });
  assert.equal(grammes(solution, "poulet"), 200);
  assert.ok(Math.abs(solution.deltas.proteinGrams) < 1e-9);
  assert.deepEqual(solution.determinism.solvedGroups, ["protein"]);
});

/* ── 2. Deux groupes (système 2×2) ──────────────────────────────────────── */
test("2. deux groupes : les deux cibles sont atteintes simultanément", () => {
  const solution = solveRecipe(RECETTE_DEUX_GROUPES, {
    target: { proteinGrams: 50, carbGrams: 70, fatGrams: 0 },
  });
  assert.ok(Math.abs(grammes(solution, "poulet") - 1920 / 11) < 1e-9);
  assert.ok(Math.abs(grammes(solution, "riz") - 1000 / 11) < 1e-9);
  assert.ok(Math.abs(solution.deltas.proteinGrams) < 1e-9);
  assert.ok(Math.abs(solution.deltas.carbGrams) < 1e-9);
  assert.deepEqual(solution.determinism.solvedGroups, ["protein", "carbohydrate"]);
});

/* ── 3. Trois groupes (système 3×3) ─────────────────────────────────────── */
test("3. trois groupes : les trois cibles sont atteintes exactement", () => {
  const solution = solveRecipe(RECETTE_UNITE_ENTIERE, { target: CIBLE_PROTOTYPE });
  assert.equal(solution.status, "exact");
  assert.deepEqual(solution.determinism.solvedGroups, ["protein", "carbohydrate", "fat"]);
  for (const écart of [
    solution.deltas.proteinGrams,
    solution.deltas.carbGrams,
    solution.deltas.fatGrams,
  ]) {
    assert.ok(Math.abs(écart) <= EXACT_TOLERANCE_GRAMS);
  }
});

/* ── 4. Ingrédient fixe ─────────────────────────────────────────────────── */
test("4. un ingrédient fixe garde sa quantité de référence et son libellé", () => {
  const solution = solveRecipe(RECETTE_FIXE_ET_UNITES, { target: CIBLE_PROTOTYPE });
  const cheddar = ingr(solution, "cheddar");
  assert.equal(cheddar?.grams, 20);
  assert.equal(cheddar?.unitLabel, "1 tranche (fixe)");
  assert.equal(cheddar?.units, null);
  // Ses macros comptent bien dans le total.
  assert.ok(Math.abs((cheddar?.fatGrams ?? 0) - 1.4) < 1e-9);
});

/* ── 5. Ingrédient libre ────────────────────────────────────────────────── */
test("5. un ingrédient libre est à zéro et n'apporte aucune macro", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: CIBLE_PROTOTYPE });
  for (const id of ["haricots", "curry"]) {
    const libre = ingr(solution, id);
    assert.equal(libre?.grams, 0);
    assert.equal(libre?.proteinGrams, 0);
    assert.equal(libre?.carbGrams, 0);
    assert.equal(libre?.fatGrams, 0);
    assert.equal(libre?.calories, 0);
  }
});

/* ── 6. Minimum ─────────────────────────────────────────────────────────── */
test("6. un plancher est respecté et signalé", () => {
  const solution = solveRecipe(RECETTE_MINIMUM, { target: CIBLE_PROTOTYPE });
  const lait = ingr(solution, "lait-amandes");
  assert.equal(lait?.grams, 50);
  assert.equal(lait?.boundHit, "min");
  assert.equal(lait?.pinned, true);
  assert.ok(solution.warnings.some((w) => w.code === "min_reached"));
  assert.ok(solution.boundsHit.some((b) => b.ingredientId === "lait-amandes" && b.bound === "min"));
});

/* ── 7. Maximum ─────────────────────────────────────────────────────────── */
test("7. un plafond est respecté et signalé", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: CIBLE_PROTOTYPE });
  const crème = ingr(solution, "creme");
  assert.equal(crème?.grams, 100);
  assert.equal(crème?.boundHit, "max");
  assert.ok(solution.warnings.some((w) => w.code === "max_reached"));
});

/* ── 8. Œufs ────────────────────────────────────────────────────────────── */
test("8. un ingrédient « œuf » est affiché en nombre d'œufs, jamais en dessous de 1", () => {
  const solution = solveRecipe(RECETTE_OEUF, { target: CIBLE_PROTOTYPE });
  const oeufs = ingr(solution, "oeufs");
  assert.equal(oeufs?.eggCount, Math.round((oeufs?.grams ?? 0) / 50));
  assert.equal(oeufs?.eggCount, 2);
  // Cible minuscule : jamais zéro œuf.
  const minuscule = solveRecipe(RECETTE_OEUF, {
    target: { proteinGrams: 1, carbGrams: 1, fatGrams: 0 },
  });
  assert.equal(ingr(minuscule, "oeufs")?.eggCount, 1);
  // Les macros restent calculées sur les GRAMMES, pas sur les œufs arrondis.
  assert.notEqual(oeufs?.grams, (oeufs?.eggCount ?? 0) * 50);
});

/* ── 9. Unité entière ───────────────────────────────────────────────────── */
test("9. un ingrédient quantifiable est résolu en unités entières bornées", () => {
  const solution = solveRecipe(RECETTE_UNITE_ENTIERE, { target: CIBLE_PROTOTYPE });
  const wrap = ingr(solution, "wrap");
  assert.equal(wrap?.units, 2);
  assert.equal(wrap?.grams, 64);
  assert.equal(wrap?.unitLabel, "2 wraps (64 g)");
  // Plafond d'unités respecté même sur une cible glucides énorme.
  const énorme = solveRecipe(RECETTE_UNITE_ENTIERE, {
    target: { proteinGrams: 50, carbGrams: 500, fatGrams: 15 },
  });
  assert.equal(ingr(énorme, "wrap")?.units, 2);
  // Plancher d'une unité même sur une cible glucides nulle.
  const nulle = solveRecipe(RECETTE_UNITE_ENTIERE, {
    target: { proteinGrams: 50, carbGrams: 0, fatGrams: 15 },
  });
  assert.equal(ingr(nulle, "wrap")?.units, 1);
});

/* ── 10. Plusieurs ingrédients d'un même groupe ─────────────────────────── */
test("10. les ingrédients d'un même groupe partagent un ratio unique", () => {
  const solution = solveRecipe(RECETTE_OEUF, { target: CIBLE_PROTOTYPE });
  const ratio = (id: string, référence: number) => grammes(solution, id) / référence;
  const r1 = ratio("oeufs", 50);
  const r2 = ratio("blanc-oeuf", 80);
  const r3 = ratio("fromage-blanc", 100);
  assert.ok(Math.abs(r1 - r2) < 1e-9);
  assert.ok(Math.abs(r1 - r3) < 1e-9);
});

/* ── 11. Ingrédient lié à un parent ─────────────────────────────────────── */
test("11. un ingrédient lié pèse exactement sa part du parent résolu en passe 1", () => {
  const sansLiés: Recipe = {
    ...RECETTE_PROPORTIONNELLE,
    ingredients: RECETTE_PROPORTIONNELLE.ingredients.filter((i) => !i.linkedToIngredientId),
  };
  const passe1 = solveRecipe(sansLiés, { target: CIBLE_PROTOTYPE });
  const complète = solveRecipe(RECETTE_PROPORTIONNELLE, { target: CIBLE_PROTOTYPE });
  const attendu = grammes(passe1, "poulet") * 0.15; // 1 500 points de base
  assert.ok(Math.abs(grammes(complète, "panure") - attendu) < 1e-9);
  assert.ok(Math.abs(grammes(complète, "fromage-blanc") - attendu) < 1e-9);
  assert.equal(ingr(complète, "panure")?.linkedTo, "poulet");
});

/* ── 12. Deuxième passe ─────────────────────────────────────────────────── */
test("12. la présence d'un ingrédient lié déclenche une deuxième passe", () => {
  const avecLiaison = solveRecipe(RECETTE_PANURE_LIEE, { target: CIBLE_PROTOTYPE });
  assert.equal(avecLiaison.determinism.passes, 2);
  const sansLiaison = solveRecipe(RECETTE_SIMPLE_PGL, { target: CIBLE_PROTOTYPE });
  assert.equal(sansLiaison.determinism.passes, 1);
  // La passe 2 corrige bien la solution : les macros apportées par la panure
  // et le fromage blanc sont défalquées du résidu, donc le poulet baisse.
  const sansLiés: Recipe = {
    ...RECETTE_PROPORTIONNELLE,
    ingredients: RECETTE_PROPORTIONNELLE.ingredients.filter((i) => !i.linkedToIngredientId),
  };
  const passe1 = solveRecipe(sansLiés, { target: CIBLE_PROTOTYPE });
  const complète = solveRecipe(RECETTE_PROPORTIONNELLE, { target: CIBLE_PROTOTYPE });
  assert.ok(grammes(complète, "poulet") < grammes(passe1, "poulet"));
});

/* ── 13. Substitution ───────────────────────────────────────────────────── */
test("13. une substitution change les macros sans toucher la recette source", () => {
  const source = RECETTE_SIMPLE_PGL;
  const avant = JSON.stringify(source);
  const solution = solveRecipe(source, {
    target: CIBLE_PROTOTYPE,
    substitutions: [SUBSTITUTION_POULET_VERS_BOEUF],
  });
  assert.equal(ingr(solution, "poulet")?.name, "Bœuf haché 5%");
  assert.equal(JSON.stringify(source), avant, "la recette source a été modifiée");
  assert.equal(source.ingredients[0].name, "Blanc de poulet");
  assert.equal(source.ingredients[0].proteinPer100g, 25);
  // Le bœuf est moins protéiné : il en faut davantage.
  const sans = solveRecipe(source, { target: CIBLE_PROTOTYPE });
  assert.ok(grammes(solution, "poulet") > grammes(sans, "poulet"));
  // applySubstitutions rend bien une COPIE.
  const copie = applySubstitutions(source, [SUBSTITUTION_POULET_VERS_BOEUF]);
  assert.notEqual(copie, source);
  assert.notEqual(copie.ingredients[0], source.ingredients[0]);
});

/* ── 14. Cible nulle ────────────────────────────────────────────────────── */
test("14. une cible nulle donne des quantités nulles, sans NaN", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: CIBLE_NULLE });
  assert.equal(solution.status, "exact");
  for (const item of solution.ingredients) {
    assert.equal(item.grams, 0);
    assert.ok(Number.isFinite(item.calories));
  }
  assert.equal(solution.totals.calories, 0);
});

/* ── 15. Cible impossible ───────────────────────────────────────────────── */
test("15. une cible hors d'atteinte est déclarée impossible, jamais exacte", () => {
  const solution = solveRecipe(RECETTE_MAXIMUM, { target: CIBLE_IMPOSSIBLE });
  assert.equal(solution.status, "impossible");
  assert.notEqual(solution.status, "exact");
  assert.equal(ingr(solution, "beurre-cacahuete")?.grams, 30);
  assert.ok(solution.deltas.fatGrams < -APPROXIMATE_TOLERANCE_GRAMS);
  assert.ok(solution.warnings.some((w) => w.code === "target_not_reached"));
});

/* ── 16. Matrice singulière ─────────────────────────────────────────────── */
test("16. un système dégénéré bascule sur le repli sans produire NaN", () => {
  const solution = solveRecipe(RECETTE_SINGULIERE, {
    target: { proteinGrams: 40, carbGrams: 20, fatGrams: 0 },
  });
  assert.equal(solution.determinism.singular, true);
  assert.ok(solution.warnings.some((w) => w.code === "singular_system"));
  for (const item of solution.ingredients) {
    assert.ok(Number.isFinite(item.grams));
    assert.ok(item.grams >= 0);
  }
  assert.equal(grammes(solution, "a"), 200);
  assert.equal(grammes(solution, "b"), 100);
});

/* ── 17. Aucune quantité négative ───────────────────────────────────────── */
test("17. aucune quantité n'est jamais négative", () => {
  const cas: [Recipe, { proteinGrams: number; carbGrams: number; fatGrams: number }][] = [
    [RECETTE_SIMPLE_PGL, { proteinGrams: 5, carbGrams: 200, fatGrams: 0 }],
    [RECETTE_SIMPLE_PGL, { proteinGrams: 200, carbGrams: 0, fatGrams: 0 }],
    [RECETTE_FIXE_ET_UNITES, { proteinGrams: 0, carbGrams: 0, fatGrams: 0 }],
    [RECETTE_UNITE_ENTIERE, { proteinGrams: 1, carbGrams: 1, fatGrams: 60 }],
    [RECETTE_PANURE_LIEE, { proteinGrams: 10, carbGrams: 300, fatGrams: 5 }],
  ];
  for (const [recette, cible] of cas) {
    const solution = solveRecipe(recette, { target: cible });
    for (const item of solution.ingredients) {
      assert.ok(item.grams >= 0, `${recette.name} / ${item.ingredientId} : ${item.grams}`);
      assert.ok(Number.isFinite(item.grams));
    }
  }
});

/* ── 18. Déterminisme ───────────────────────────────────────────────────── */
test("18. deux résolutions identiques donnent un résultat strictement identique", () => {
  const a = solveRecipe(RECETTE_MINIMUM, { target: CIBLE_PROTOTYPE });
  const b = solveRecipe(RECETTE_MINIMUM, { target: CIBLE_PROTOTYPE });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.deepEqual(a.determinism.pinnedOrder, b.determinism.pinnedOrder);
});

/* ── 19. Macros obtenues par ingrédient ─────────────────────────────────── */
test("19. les macros par ingrédient dérivent de ses grammes et de ses valeurs pour 100 g", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: CIBLE_PROTOTYPE });
  const riz = ingr(solution, "riz");
  assert.ok(Math.abs((riz?.proteinGrams ?? 0) - ((riz?.grams ?? 0) * 7) / 100) < 1e-9);
  assert.ok(Math.abs((riz?.carbGrams ?? 0) - ((riz?.grams ?? 0) * 77) / 100) < 1e-9);
  assert.ok(Math.abs((riz?.fatGrams ?? 0) - ((riz?.grams ?? 0) * 1) / 100) < 1e-9);
  // Le total est bien la somme des ingrédients.
  const sommeProt = solution.ingredients.reduce((s, i) => s + i.proteinGrams, 0);
  assert.ok(Math.abs(sommeProt - solution.totals.proteinGrams) < 1e-9);
});

/* ── 20. Calories ───────────────────────────────────────────────────────── */
test("20. les calories appliquent 4 / 4 / 9 aux macros obtenues", () => {
  const solution = solveRecipe(RECETTE_UNITE_ENTIERE, { target: CIBLE_PROTOTYPE });
  const attendu =
    solution.totals.proteinGrams * 4 + solution.totals.carbGrams * 4 + solution.totals.fatGrams * 9;
  assert.ok(Math.abs(solution.totals.calories - attendu) < 1e-9);
  // Cible 50/70/15 atteinte exactement ⇒ 615 kcal.
  assert.ok(Math.abs(solution.totals.calories - 615) < 1e-9);
});

/* ── 21. Écarts P/G/L ───────────────────────────────────────────────────── */
test("21. les écarts sont signés et cohérents avec les totaux", () => {
  const solution = solveRecipe(RECETTE_MAXIMUM, { target: CIBLE_IMPOSSIBLE });
  assert.ok(
    Math.abs(solution.deltas.fatGrams - (solution.totals.fatGrams - CIBLE_IMPOSSIBLE.fatGrams)) <
      1e-9,
  );
  assert.ok(solution.deltas.fatGrams < 0, "un déficit doit être négatif");
  // Le statut suit exactement la même règle, sans exception.
  assert.equal(determineStatus(solution.deltas, solution.target), solution.status);
  assert.equal(
    determineStatus(
      { proteinGrams: 0.4, carbGrams: -0.4, fatGrams: 0 },
      { proteinGrams: 50, carbGrams: 70, fatGrams: 15 },
    ),
    "exact",
  );
  assert.equal(
    determineStatus(
      { proteinGrams: 3, carbGrams: 0, fatGrams: 0 },
      { proteinGrams: 50, carbGrams: 70, fatGrams: 15 },
    ),
    "approximate",
  );
});

/* ── 22. Avertissement de plafond ───────────────────────────────────────── */
test("22. l'atteinte d'un plafond produit un avertissement nommé et lisible", () => {
  const solution = solveRecipe(RECETTE_MAXIMUM, { target: CIBLE_IMPOSSIBLE });
  const avertissement = solution.warnings.find((w) => w.code === "max_reached");
  assert.ok(avertissement);
  assert.equal(avertissement?.ingredientId, "beurre-cacahuete");
  assert.ok(avertissement?.message.includes("plafond"));
  assert.ok(avertissement?.message.includes("Beurre cacahuète"));
});

/* ── 23. Source immuable ────────────────────────────────────────────────── */
test("23. le solveur ne modifie ni la recette, ni ses ingrédients, ni la cible", () => {
  const recette: Recipe = {
    ...RECETTE_SIMPLE_PGL,
    ingredients: RECETTE_SIMPLE_PGL.ingredients.map((i) => Object.freeze({ ...i })),
  };
  Object.freeze(recette);
  Object.freeze(recette.ingredients);
  const cible = Object.freeze({ ...CIBLE_PROTOTYPE });
  const avantRecette = JSON.stringify(recette);
  const avantCible = JSON.stringify(cible);
  const solution = solveRecipe(recette, { target: cible });
  assert.equal(JSON.stringify(recette), avantRecette);
  assert.equal(JSON.stringify(cible), avantCible);
  assert.notEqual(solution.target, cible);
  assert.deepEqual(solution.target, { ...CIBLE_PROTOTYPE });
});

/* ── 24. Rejeu identique après substitution ─────────────────────────────── */
test("24. le rejeu d'une résolution avec substitution est strictement identique", () => {
  const options = {
    target: CIBLE_PROTOTYPE,
    substitutions: [SUBSTITUTION_POULET_VERS_BOEUF],
  } as const;
  const a = solveRecipe(RECETTE_SIMPLE_PGL, options);
  const b = solveRecipe(RECETTE_SIMPLE_PGL, options);
  const c = solveRecipe(RECETTE_SIMPLE_PGL, {
    target: { ...CIBLE_PROTOTYPE },
    substitutions: [{ ...SUBSTITUTION_POULET_VERS_BOEUF }],
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(JSON.stringify(a), JSON.stringify(c));
});

/* ── 25. Re-résolution après borne — PAS un simple clamp final ──────────── */
test("25. atteindre une borne relance la résolution sur les variables restantes", () => {
  const solution = solveRecipe(RECETTE_SIMPLE_PGL, { target: CIBLE_PROTOTYPE });

  // Ce qu'aurait donné un simple clamp final : résolution 3×3 unique, puis
  // écrêtage de la crème à 100 g SANS toucher au poulet ni au riz.
  const clampNaïf = { poulet: 139.58192852326363, riz: 78.422117329737, creme: 100 };

  assert.equal(grammes(solution, "creme"), clampNaïf.creme);
  assert.notEqual(grammes(solution, "poulet"), clampNaïf.poulet);
  assert.notEqual(grammes(solution, "riz"), clampNaïf.riz);
  assert.ok(Math.abs(grammes(solution, "poulet") - 1800 / 11) < 1e-9);
  assert.ok(Math.abs(grammes(solution, "riz") - 6700 / 77) < 1e-9);

  // La preuve tient dans le résultat : après re-résolution, protéines et
  // glucides retombent EXACTEMENT sur la cible, ce qu'un clamp naïf ne fait pas.
  assert.ok(Math.abs(solution.deltas.proteinGrams) < 1e-9);
  assert.ok(Math.abs(solution.deltas.carbGrams) < 1e-9);
  assert.deepEqual(solution.determinism.pinnedOrder, ["creme"]);
  assert.equal(solution.determinism.iterations, 2);

  // …et le manque de lipides est reporté honnêtement, jamais masqué.
  assert.ok(solution.deltas.fatGrams < 0);
  assert.notEqual(solution.status, "exact");
});

console.log(`\n${réussis} réussis, ${échecs} échecs`);
if (échecs > 0) process.exit(1);
