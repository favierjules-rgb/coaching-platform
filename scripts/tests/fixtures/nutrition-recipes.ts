/**
 * Fixtures de recettes — extraites du prototype `App.jsx` (« Calculateur de
 * Recettes — Vulkan Coaching »).
 *
 * PÉRIMÈTRE. Le prototype porte 41 recettes. On n'en reprend ici QUE
 * quelques cas représentatifs, uniquement comme jeux d'essai autonomes du
 * solveur. Rien n'est importé dans Supabase à ce stade : les tables
 * `recipes`, `recipe_ingredients`, `recipe_steps`, `recipe_meal_slots` et
 * `recipe_substitutions` appartiennent à la PR 3.
 *
 * AUCUNE DÉPENDANCE au composant React d'origine : les valeurs sont
 * recopiées telles quelles (macros POUR 100 g CRU), converties au
 * vocabulaire du solveur.
 *
 *   prototype          solveur
 *   ─────────          ───────
 *   type:"prot"        role:"protein"
 *   type:"gluc"        role:"carbohydrate"
 *   type:"lip"         role:"fat"
 *   type:"fixe"        role:"fixed"
 *   type:"libre"       role:"free"
 *   g_ref              referenceGrams
 *   min_g / max_g      minGrams / maxGrams
 *   egg:true           egg:true (base 50 g/œuf)
 *   unit_scalable      unitScalable + maxUnits + unitName
 *   ratio_of           linkedToIngredientId
 *   ratio_pct:0.15     linkRatioBp:1500 (points de base, jamais un flottant)
 */
import type { Recipe, RecipeMacroTarget, RecipeSubstitution } from "../../../lib/nutrition/recipe-types";

/* ── 1. Recette simple P/G/L (+ ingrédient libre, + plafond) ──────────────
 * Prototype id 13 — « Bol Riz Poulet Curry ». Trois groupes, deux
 * ingrédients à volonté, un plafond sur la crème. */
export const RECETTE_SIMPLE_PGL: Recipe = {
  id: "proto-13",
  name: "Bol Riz Poulet Curry",
  slot: "lunch",
  ingredients: [
    { id: "poulet", name: "Blanc de poulet", role: "protein", proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 140 },
    { id: "riz", name: "Riz", role: "carbohydrate", proteinPer100g: 7, carbPer100g: 77, fatPer100g: 1, referenceGrams: 100 },
    { id: "creme", name: "Crème légère 4%", role: "fat", proteinPer100g: 3, carbPer100g: 3, fatPer100g: 4, referenceGrams: 80, maxGrams: 100 },
    { id: "haricots", name: "Haricots verts", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
    { id: "curry", name: "Curry en poudre", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

/* ── 2. Ingrédient FIXE + unité entière ───────────────────────────────────
 * Prototype id 15 — « Burger Maison ». Pain quantifiable (1 ou 2 unités),
 * cheddar figé à une tranche. */
export const RECETTE_FIXE_ET_UNITES: Recipe = {
  id: "proto-15",
  name: "Burger Maison",
  slot: "dinner",
  ingredients: [
    { id: "steak", name: "Steak haché 5%", role: "protein", proteinPer100g: 22, carbPer100g: 0, fatPer100g: 5, referenceGrams: 100 },
    { id: "bacon", name: "Bacon", role: "protein", proteinPer100g: 20, carbPer100g: 0, fatPer100g: 10, referenceGrams: 20 },
    { id: "pdt", name: "Pommes de terre", role: "carbohydrate", proteinPer100g: 2, carbPer100g: 17, fatPer100g: 0, referenceGrams: 200 },
    { id: "pain", name: "Pain burger Jacquet", role: "fixed", proteinPer100g: 8.1, carbPer100g: 47, fatPer100g: 4.7, referenceGrams: 62.5, unitScalable: true, maxUnits: 2, unitName: "pain" },
    { id: "cheddar", name: "Cheddar", role: "fixed", proteinPer100g: 5, carbPer100g: 0, fatPer100g: 7, referenceGrams: 20, fixedLabel: "1 tranche (fixe)" },
    { id: "sauce", name: "Sauce zéro", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
    { id: "crudites", name: "Tomates / oignons", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

/* ── 3. Œufs ──────────────────────────────────────────────────────────────
 * Prototype id 8 — « Pancakes Protéinés ». Œufs entiers affichés en nombre
 * d'œufs (base 50 g), plusieurs ingrédients dans le groupe protéines. */
export const RECETTE_OEUF: Recipe = {
  id: "proto-8",
  name: "Pancakes Protéinés",
  slot: "breakfast",
  ingredients: [
    { id: "oeufs", name: "Œufs entiers", role: "protein", proteinPer100g: 13, carbPer100g: 1, fatPer100g: 10, referenceGrams: 50, egg: true },
    { id: "blanc-oeuf", name: "Blanc d'œuf", role: "protein", proteinPer100g: 11, carbPer100g: 1, fatPer100g: 0, referenceGrams: 80 },
    { id: "banane", name: "Banane", role: "carbohydrate", proteinPer100g: 1, carbPer100g: 23, fatPer100g: 0, referenceGrams: 80 },
    { id: "fromage-blanc", name: "Fromage blanc 0%", role: "protein", proteinPer100g: 8, carbPer100g: 4, fatPer100g: 0, referenceGrams: 100 },
  ],
};

/* ── 4. Unité entière seule ───────────────────────────────────────────────
 * Prototype id 18 — « Tacos poulet ». Wrap quantifiable, deux ingrédients
 * dans le groupe lipides, plafonds sur les deux. */
export const RECETTE_UNITE_ENTIERE: Recipe = {
  id: "proto-18",
  name: "Tacos poulet",
  slot: "dinner",
  ingredients: [
    { id: "poulet", name: "Blanc de poulet", role: "protein", proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 120 },
    { id: "pdt", name: "Pommes de terre", role: "carbohydrate", proteinPer100g: 2, carbPer100g: 17, fatPer100g: 0, referenceGrams: 150 },
    { id: "wrap", name: "Wrap fin Old El Paso", role: "fixed", proteinPer100g: 8.6, carbPer100g: 53.2, fatPer100g: 5.5, referenceGrams: 32, unitScalable: true, maxUnits: 2, unitName: "wrap" },
    { id: "creme", name: "Crème légère 4%", role: "fat", proteinPer100g: 3, carbPer100g: 3, fatPer100g: 4, referenceGrams: 50, maxGrams: 80 },
    { id: "comte", name: "Comté", role: "fat", proteinPer100g: 27, carbPer100g: 0, fatPer100g: 33, referenceGrams: 15, maxGrams: 25 },
    { id: "sauce", name: "Sauce zéro", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

/* ── 5. Minimum (plancher) ────────────────────────────────────────────────
 * Prototype id 1 — « Porridge Protéiné ». Le lait d'amandes porte à la fois
 * un plancher (50 g) et un plafond (250 g). */
export const RECETTE_MINIMUM: Recipe = {
  id: "proto-1",
  name: "Porridge Protéiné",
  slot: "breakfast",
  ingredients: [
    { id: "avoine", name: "Flocons d'avoine", role: "carbohydrate", proteinPer100g: 13, carbPer100g: 68, fatPer100g: 7, referenceGrams: 60 },
    { id: "lait-amandes", name: "Lait d'amandes sans sucre", role: "fat", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 1, referenceGrams: 150, maxGrams: 250, minGrams: 50 },
    { id: "oeuf", name: "Œuf entier", role: "protein", proteinPer100g: 13, carbPer100g: 1, fatPer100g: 10, referenceGrams: 50, egg: true },
    { id: "whey", name: "Whey (topping)", role: "protein", proteinPer100g: 80, carbPer100g: 5, fatPer100g: 2, referenceGrams: 20 },
    { id: "levure", name: "Levure chimique", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
    { id: "sucralose", name: "Sucralose / cannelle", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

/* ── 6. Maximum (plafond serré) ───────────────────────────────────────────
 * Prototype id 3 — « Porridge Whey Banane ». Le beurre de cacahuète est
 * plafonné à 30 g : la cible lipides ne peut pas toujours être atteinte. */
export const RECETTE_MAXIMUM: Recipe = {
  id: "proto-3",
  name: "Porridge Whey Banane",
  slot: "breakfast",
  ingredients: [
    { id: "avoine", name: "Flocons d'avoine", role: "carbohydrate", proteinPer100g: 13, carbPer100g: 68, fatPer100g: 7, referenceGrams: 60 },
    { id: "skyr", name: "Skyr nature", role: "protein", proteinPer100g: 10, carbPer100g: 4, fatPer100g: 0, referenceGrams: 150 },
    { id: "whey", name: "Whey protéine", role: "protein", proteinPer100g: 80, carbPer100g: 5, fatPer100g: 2, referenceGrams: 25 },
    { id: "banane", name: "Banane", role: "carbohydrate", proteinPer100g: 1, carbPer100g: 23, fatPer100g: 0, referenceGrams: 80 },
    { id: "beurre-cacahuete", name: "Beurre cacahuète", role: "fat", proteinPer100g: 25, carbPer100g: 7, fatPer100g: 50, referenceGrams: 15, maxGrams: 30 },
  ],
};

/* ── 7. Panure LIÉE au poulet (deux passes) ───────────────────────────────
 * Prototype id 38 — « Cordon Bleu Maison ». Deux ingrédients liés au poids
 * du poulet (15 % chacun), plus deux ingrédients fixes étiquetés. */
export const RECETTE_PANURE_LIEE: Recipe = {
  id: "proto-38",
  name: "Cordon Bleu Maison",
  slot: "dinner",
  ingredients: [
    { id: "poulet", name: "Blanc de poulet", role: "protein", proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 150 },
    { id: "jambon", name: "Jambon", role: "fixed", proteinPer100g: 18, carbPer100g: 0, fatPer100g: 2, referenceGrams: 20, fixedLabel: "1 tranche (fixe)" },
    { id: "comte", name: "Comté", role: "fixed", proteinPer100g: 27, carbPer100g: 0, fatPer100g: 33, referenceGrams: 20, fixedLabel: "1 tranche (fixe)" },
    { id: "panure", name: "Panure panko", role: "fixed", proteinPer100g: 10, carbPer100g: 70, fatPer100g: 5, referenceGrams: 1, linkedToIngredientId: "poulet", linkRatioBp: 1500 },
    { id: "frites", name: "Pommes de terre (frites)", role: "carbohydrate", proteinPer100g: 2, carbPer100g: 17, fatPer100g: 0, referenceGrams: 200 },
    { id: "fromage-blanc", name: "Fromage blanc 0% (pour tremper)", role: "protein", proteinPer100g: 8, carbPer100g: 4, fatPer100g: 0, referenceGrams: 1, linkedToIngredientId: "poulet", linkRatioBp: 1500 },
    { id: "epices", name: "Épices", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

/* ── 8. Ingrédient PROPORTIONNEL, recette plus simple ─────────────────────
 * Prototype id 39 — « Tenders de Poulet ». Mêmes liaisons, sans les fixes
 * étiquetés : isole nettement l'effet de la deuxième passe. */
export const RECETTE_PROPORTIONNELLE: Recipe = {
  id: "proto-39",
  name: "Tenders de Poulet",
  slot: "dinner",
  ingredients: [
    { id: "poulet", name: "Blanc de poulet", role: "protein", proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 150 },
    { id: "panure", name: "Panure panko", role: "fixed", proteinPer100g: 10, carbPer100g: 70, fatPer100g: 5, referenceGrams: 1, linkedToIngredientId: "poulet", linkRatioBp: 1500 },
    { id: "frites", name: "Pommes de terre (frites)", role: "carbohydrate", proteinPer100g: 2, carbPer100g: 17, fatPer100g: 0, referenceGrams: 200 },
    { id: "fromage-blanc", name: "Fromage blanc 0% (pour tremper)", role: "protein", proteinPer100g: 8, carbPer100g: 4, fatPer100g: 0, referenceGrams: 1, linkedToIngredientId: "poulet", linkRatioBp: 1500 },
    { id: "epices", name: "Épices", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
    { id: "legumes", name: "Légumes", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

/* ── 9. Un seul groupe / deux groupes ─────────────────────────────────────
 * Réductions minimales bâties sur les mêmes valeurs d'ingrédients que le
 * prototype — pour isoler les systèmes 1×1 et 2×2. */
export const RECETTE_UN_GROUPE: Recipe = {
  id: "derive-1g",
  name: "Poulet seul",
  ingredients: [
    { id: "poulet", name: "Blanc de poulet", role: "protein", proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 140 },
    { id: "legumes", name: "Légumes verts", role: "free", proteinPer100g: 0, carbPer100g: 0, fatPer100g: 0, referenceGrams: 0 },
  ],
};

export const RECETTE_DEUX_GROUPES: Recipe = {
  id: "derive-2g",
  name: "Poulet riz",
  ingredients: [
    { id: "poulet", name: "Blanc de poulet", role: "protein", proteinPer100g: 25, carbPer100g: 0, fatPer100g: 1, referenceGrams: 140 },
    { id: "riz", name: "Riz", role: "carbohydrate", proteinPer100g: 7, carbPer100g: 77, fatPer100g: 1, referenceGrams: 100 },
  ],
};

/* ── 10. Matrice singulière ───────────────────────────────────────────────
 * Deux groupes dont les contributions sont proportionnelles : le
 * déterminant est nul, le solveur doit basculer sur la solution de repli
 * sans produire ni NaN ni quantité négative. */
export const RECETTE_SINGULIERE: Recipe = {
  id: "derive-singuliere",
  name: "Deux groupes proportionnels",
  ingredients: [
    { id: "a", name: "Source A", role: "protein", proteinPer100g: 20, carbPer100g: 10, fatPer100g: 0, referenceGrams: 100 },
    { id: "b", name: "Source B", role: "carbohydrate", proteinPer100g: 40, carbPer100g: 20, fatPer100g: 0, referenceGrams: 100 },
  ],
};

/* ── 11. Recette IMPOSSIBLE ───────────────────────────────────────────────
 * Un seul ingrédient lipides, plafonné à 30 g de beurre de cacahuète, donc
 * 15 g de lipides au maximum : une cible de 60 g de lipides est hors
 * d'atteinte, quelles que soient les autres variables. */
export const RECETTE_IMPOSSIBLE: Recipe = RECETTE_MAXIMUM;

/* ── Substitutions du prototype (registre partagé par nom) ────────────────
 * Chaque substitut conserve le rôle macro de l'original. */
export const SUBSTITUTION_POULET_VERS_DINDE: RecipeSubstitution = {
  ingredientId: "poulet",
  name: "Dinde (escalope)",
  proteinPer100g: 25,
  carbPer100g: 0,
  fatPer100g: 1,
};

export const SUBSTITUTION_POULET_VERS_BOEUF: RecipeSubstitution = {
  ingredientId: "poulet",
  name: "Bœuf haché 5%",
  proteinPer100g: 22,
  carbPer100g: 0,
  fatPer100g: 5,
};

export const SUBSTITUTION_RIZ_VERS_QUINOA: RecipeSubstitution = {
  ingredientId: "riz",
  name: "Quinoa",
  proteinPer100g: 14,
  carbPer100g: 64,
  fatPer100g: 6,
};

/* ── Cibles d'essai ───────────────────────────────────────────────────────
 * Valeurs par défaut du prototype : 50 g de protéines, 70 g de glucides,
 * 15 g de lipides. */
export const CIBLE_PROTOTYPE: RecipeMacroTarget = {
  proteinGrams: 50,
  carbGrams: 70,
  fatGrams: 15,
};

export const CIBLE_NULLE: RecipeMacroTarget = {
  proteinGrams: 0,
  carbGrams: 0,
  fatGrams: 0,
};

/** Hors d'atteinte pour RECETTE_IMPOSSIBLE (plafond à 30 g de cacahuète). */
export const CIBLE_IMPOSSIBLE: RecipeMacroTarget = {
  proteinGrams: 50,
  carbGrams: 70,
  fatGrams: 60,
};
