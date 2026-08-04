/**
 * Types PURS des recettes adaptatives — aucun accès Supabase.
 *
 * PÉRIMÈTRE PR 1. Les tables `recipes`, `recipe_meal_slots`,
 * `recipe_ingredients`, `recipe_steps` et `recipe_substitutions`
 * appartiennent à la PR 3. Ce fichier ne décrit QUE les objets manipulés en
 * mémoire par le solveur et ses tests : rien n'est importé dans Supabase à
 * ce stade.
 *
 * CONVENTION IMPOSÉE PAR LE PROTOTYPE : toutes les macros sont données
 * POUR 100 g CRU.
 */

/**
 * Rôle d'un ingrédient dans la résolution.
 *
 *   protein / carbohydrate / fat — variable d'ajustement. Tous les
 *     ingrédients d'un même rôle partagent UN ratio commun, appliqué à leur
 *     quantité de référence.
 *   fixed — quantité figée (pain, tranche de fromage, œuf entier compté à
 *     l'unité). Peut être quantifiée en unités entières (`unitScalable`).
 *   free — à volonté, exclu du calcul (légumes verts, épices, édulcorant).
 */
export type RecipeIngredientRole = "protein" | "carbohydrate" | "fat" | "fixed" | "free";

/** Les trois rôles qui portent une variable d'ajustement. */
export const SCALABLE_ROLES = ["protein", "carbohydrate", "fat"] as const;
export type ScalableRole = (typeof SCALABLE_ROLES)[number];

/** Clés de macro utilisées par le solveur. */
export const SOLVER_MACRO_KEYS = ["protein", "carb", "fat"] as const;
export type SolverMacroKey = (typeof SOLVER_MACRO_KEYS)[number];

/** Macro visée par chaque rôle ajustable. */
export const ROLE_TO_MACRO: Readonly<Record<ScalableRole, SolverMacroKey>> = {
  protein: "protein",
  carbohydrate: "carb",
  fat: "fat",
};

export interface RecipeIngredient {
  /** Identifiant stable DANS la recette — sert aux liaisons et aux substitutions. */
  readonly id: string;
  readonly name: string;
  readonly role: RecipeIngredientRole;

  /** Macros POUR 100 g CRU. */
  readonly proteinPer100g: number;
  readonly carbPer100g: number;
  readonly fatPer100g: number;

  /** Quantité de référence en grammes (base du ratio du groupe). */
  readonly referenceGrams: number;

  /** Plancher en grammes, ou `null`. */
  readonly minGrams?: number | null;
  /** Plafond en grammes, ou `null`. */
  readonly maxGrams?: number | null;

  /** Ingrédient `fixed` quantifié en unités entières (pain, wrap, pitta). */
  readonly unitScalable?: boolean;
  /** Nombre maximum d'unités entières (2 par défaut). */
  readonly maxUnits?: number | null;
  /** Nom de l'unité, pour l'affichage (« wrap », « pain », « tranche »). */
  readonly unitName?: string | null;
  /** Libellé figé d'un ingrédient `fixed` non quantifiable. */
  readonly fixedLabel?: string | null;

  /** Affiché en NOMBRE D'ŒUFS plutôt qu'en grammes. */
  readonly egg?: boolean;
  /** Poids d'un œuf en grammes (50 par défaut). */
  readonly eggGrams?: number | null;

  /**
   * Ingrédient LIÉ : sa quantité découle de celle d'un autre ingrédient de
   * la recette (panure liée au poulet, fromage blanc pour tremper…).
   * Impose une résolution en DEUX PASSES.
   */
  readonly linkedToIngredientId?: string | null;
  /**
   * Part du poids du parent, EN POINTS DE BASE (1 500 bp = 15 %). Entier —
   * jamais un flottant, pour la même raison que le reste du chantier.
   */
  readonly linkRatioBp?: number | null;
}

export interface Recipe {
  readonly id: string;
  readonly name: string;
  /** Créneau conseillé — purement indicatif à ce stade, aucune table associée. */
  readonly slot?: string | null;
  readonly ingredients: readonly RecipeIngredient[];
}

/**
 * Substitution TEMPORAIRE d'un ingrédient. Elle ne modifie jamais la
 * recette source : `applySubstitutions` produit une copie.
 * Le substitut doit rester dans le même rôle macro que l'original —
 * convention héritée du prototype, vérifiée par le solveur.
 */
export interface RecipeSubstitution {
  readonly ingredientId: string;
  readonly name: string;
  readonly proteinPer100g: number;
  readonly carbPer100g: number;
  readonly fatPer100g: number;
}

/** Cible du solveur, en GRAMMES de macro. */
export interface RecipeMacroTarget {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
}
