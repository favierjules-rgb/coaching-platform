/**
 * Solveur adaptatif de recettes — bibliothèque PURE, aucun Supabase.
 *
 * PROBLÈME RÉSOLU. Une recette porte N groupes d'ajustement (protéines,
 * glucides, lipides). Chaque groupe a UN ratio commun appliqué aux
 * quantités de référence de ses ingrédients. Atteindre une cible P/G/L
 * revient à résoudre un système linéaire N×N (Cramer, N ≤ 3).
 *
 * CE QUI CHANGE PAR RAPPORT AU PROTOTYPE. Le prototype résout une fois puis
 * applique un simple `clamp` final sur min/max : la quantité affichée
 * respecte alors la borne, mais les macros manquantes ne sont JAMAIS
 * redistribuées — la cible est présentée comme atteinte alors qu'elle ne
 * l'est plus. Ici, quand une borne est atteinte :
 *
 *   1. la quantité est FIGÉE à la borne ;
 *   2. les macros déjà apportées sont recalculées ;
 *   3. le résidu est résolu avec les variables restantes ;
 *   4. on répète jusqu'à stabilité ou impossibilité.
 *
 * DEUX PASSES. Un ingrédient LIÉ (panure au poids du poulet) ne peut pas
 * être résolu tant que le poids de son parent est inconnu : passe 1 sans
 * lui (contribution nulle), calcul de son poids, puis passe 2 avec ce poids
 * figé. Identique au prototype, mais chaque passe contient elle-même la
 * boucle de re-résolution ci-dessus.
 *
 * IMMUABILITÉ. Le solveur ne modifie JAMAIS la recette, ses ingrédients, le
 * plan ni la cible. Les substitutions produisent une copie.
 *
 * DÉTERMINISME. À entrée identique, sortie identique — aucun parcours
 * d'objet non ordonné n'influence le résultat, et l'ingrédient figé à
 * chaque itération est choisi par un critère total (violation la plus
 * grande, puis plus petit index).
 */
import { applyBasisPoints } from "./basis-points";
import { KCAL_PER_GRAM } from "./macro-targets";
import {
  ROLE_TO_MACRO,
  SCALABLE_ROLES,
  SOLVER_MACRO_KEYS,
  type Recipe,
  type RecipeIngredient,
  type RecipeMacroTarget,
  type RecipeSubstitution,
  type ScalableRole,
  type SolverMacroKey,
} from "./recipe-types";

/* ─────────────────────────── Constantes ─────────────────────────── */

/**
 * Tolérance du statut `exact`, en GRAMMES de macro. Une cible n'est
 * déclarée atteinte que si CHAQUE macro est à moins d'un demi-gramme —
 * en deçà du gramme affiché, donc invisible pour l'élève.
 */
export const EXACT_TOLERANCE_GRAMS = 0.5;

/** Tolérance absolue du statut `approximate`, en grammes de macro. */
export const APPROXIMATE_TOLERANCE_GRAMS = 5;

/** Tolérance relative du statut `approximate` (10 % de la cible). */
export const APPROXIMATE_TOLERANCE_RATIO = 0.1;

/** Poids par défaut d'un œuf, en grammes. */
export const DEFAULT_EGG_GRAMS = 50;

/** Nombre maximum d'unités entières par défaut pour un ingrédient quantifiable. */
export const DEFAULT_MAX_UNITS = 2;

/** Seuil en dessous duquel un déterminant est considéré comme nul. */
const DETERMINANT_EPSILON = 1e-10;

/** Marge de comparaison des bornes, pour ne pas figer sur du bruit flottant. */
const BOUND_EPSILON = 1e-9;

/** Écart œufs entiers / grammes calculés au-delà duquel on avertit. */
const EGG_ROUNDING_WARNING_GRAMS = 5;

/* ─────────────────────────── Types de sortie ─────────────────────────── */

export type SolverStatus = "exact" | "approximate" | "impossible";

export type SolverWarningCode =
  | "max_reached"
  | "min_reached"
  | "singular_system"
  | "no_scalable_ingredient"
  | "target_not_reached"
  | "egg_rounding"
  | "iteration_limit_reached"
  | "substitution_role_mismatch"
  | "linked_parent_missing";

export interface SolverWarning {
  readonly code: SolverWarningCode;
  readonly ingredientId?: string;
  readonly message: string;
}

export interface SolvedIngredient {
  readonly ingredientId: string;
  readonly name: string;
  readonly role: RecipeIngredient["role"];
  /** Grammes calculés, décimales conservées — source de vérité interne. */
  readonly grams: number;
  /** Grammes arrondis pour l'affichage. Jamais réinjectés dans un calcul. */
  readonly displayGrams: number;
  /** Unités entières décidées pour un ingrédient quantifiable. */
  readonly units: number | null;
  /** Libellé d'unité prêt à afficher (« 2 wraps (64 g) »). */
  readonly unitLabel: string | null;
  /** Nombre d'œufs affiché, pour un ingrédient marqué `egg`. */
  readonly eggCount: number | null;
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
  readonly calories: number;
  /** Borne effectivement atteinte, ou `null`. */
  readonly boundHit: "min" | "max" | null;
  /** L'ingrédient a été figé par la boucle de re-résolution. */
  readonly pinned: boolean;
  /** Parent d'un ingrédient lié, ou `null`. */
  readonly linkedTo: string | null;
}

export interface SolverTotals {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
  readonly calories: number;
}

export interface SolverDeltas {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
}

export interface BoundHitRecord {
  readonly ingredientId: string;
  readonly bound: "min" | "max";
  readonly grams: number;
}

/** Informations de déterminisme — destinées aux tests et au diagnostic. */
export interface SolverDeterminism {
  /** 1 sans ingrédient lié, 2 dès qu'il y en a un. */
  readonly passes: number;
  /** Itérations de re-résolution de la dernière passe. */
  readonly iterations: number;
  /** Ordre exact dans lequel les ingrédients ont été figés. */
  readonly pinnedOrder: readonly string[];
  /** Groupes réellement résolus lors de la dernière itération. */
  readonly solvedGroups: readonly ScalableRole[];
  /** Le système est passé par la solution de repli (déterminant nul). */
  readonly singular: boolean;
  /** Unités entières décidées, par ingrédient. */
  readonly unitDecisions: readonly { readonly ingredientId: string; readonly units: number }[];
}

export interface RecipeSolution {
  readonly status: SolverStatus;
  readonly ingredients: readonly SolvedIngredient[];
  readonly totals: SolverTotals;
  readonly target: RecipeMacroTarget;
  readonly deltas: SolverDeltas;
  readonly boundsHit: readonly BoundHitRecord[];
  readonly warnings: readonly SolverWarning[];
  readonly determinism: SolverDeterminism;
}

export interface SolveOptions {
  readonly target: RecipeMacroTarget;
  readonly substitutions?: readonly RecipeSubstitution[];
}

/* ─────────────────────────── Algèbre ─────────────────────────── */

function det2(a: readonly (readonly number[])[]): number {
  return a[0][0] * a[1][1] - a[0][1] * a[1][0];
}

function det3(a: readonly (readonly number[])[]): number {
  return (
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
  );
}

/* ─────────────────────────── Substitutions ─────────────────────────── */

/**
 * Applique des substitutions temporaires et retourne une NOUVELLE recette.
 * La recette source et ses ingrédients ne sont jamais modifiés.
 * Une substitution visant un ingrédient absent est ignorée silencieusement
 * côté données, mais signalée par le solveur.
 */
export function applySubstitutions(
  recipe: Recipe,
  substitutions: readonly RecipeSubstitution[] = [],
): Recipe {
  if (substitutions.length === 0) {
    return { ...recipe, ingredients: recipe.ingredients.map((i) => ({ ...i })) };
  }
  const parId = new Map(substitutions.map((s) => [s.ingredientId, s]));
  return {
    ...recipe,
    ingredients: recipe.ingredients.map((ingredient) => {
      const substitut = parId.get(ingredient.id);
      if (!substitut) {
        return { ...ingredient };
      }
      return {
        ...ingredient,
        name: substitut.name,
        proteinPer100g: substitut.proteinPer100g,
        carbPer100g: substitut.carbPer100g,
        fatPer100g: substitut.fatPer100g,
      };
    }),
  };
}

/* ─────────────────────────── Utilitaires ─────────────────────────── */

function macroPer100g(ingredient: RecipeIngredient, macro: SolverMacroKey): number {
  if (macro === "protein") return ingredient.proteinPer100g;
  if (macro === "carb") return ingredient.carbPer100g;
  return ingredient.fatPer100g;
}

function targetFor(target: RecipeMacroTarget, macro: SolverMacroKey): number {
  if (macro === "protein") return target.proteinGrams;
  if (macro === "carb") return target.carbGrams;
  return target.fatGrams;
}

function isScalableRole(role: RecipeIngredient["role"]): role is ScalableRole {
  return (SCALABLE_ROLES as readonly string[]).includes(role);
}

function isLinked(ingredient: RecipeIngredient): boolean {
  return typeof ingredient.linkedToIngredientId === "string" && ingredient.linkedToIngredientId !== "";
}

/** Grammes bornés par min/max, jamais négatifs. `null` si aucune borne atteinte. */
function clampToBounds(
  ingredient: RecipeIngredient,
  grams: number,
): { grams: number; bound: "min" | "max" | null } {
  let valeur = Math.max(0, grams);
  let bound: "min" | "max" | null = null;
  const min = ingredient.minGrams;
  const max = ingredient.maxGrams;
  if (typeof min === "number" && valeur < min) {
    valeur = min;
    bound = "min";
  }
  if (typeof max === "number" && valeur > max) {
    valeur = max;
    bound = "max";
  }
  return { grams: valeur, bound };
}

/* ─────────────────────────── Cœur d'une passe ─────────────────────────── */

interface PassResult {
  /** Grammes finaux par identifiant d'ingrédient. */
  readonly gramsById: Map<string, number>;
  readonly boundById: Map<string, "min" | "max">;
  readonly pinnedIds: string[];
  readonly unitsById: Map<string, number>;
  readonly iterations: number;
  readonly singular: boolean;
  readonly solvedGroups: ScalableRole[];
  readonly iterationLimitReached: boolean;
}

/**
 * Résout une passe complète, boucle de re-résolution comprise.
 * `linkedGramsById` fournit les grammes déjà connus des ingrédients liés
 * (vide en passe 1).
 */
function solvePass(
  ingredients: readonly RecipeIngredient[],
  target: RecipeMacroTarget,
  linkedGramsById: ReadonlyMap<string, number>,
): PassResult {
  // ── Unités entières des ingrédients quantifiables ──
  // Décidées une seule fois par passe : elles ne dépendent que de la cible
  // glucides, jamais des ratios en cours de résolution.
  const unitsById = new Map<string, number>();
  for (const ingredient of ingredients) {
    if (ingredient.role !== "fixed" || !ingredient.unitScalable || isLinked(ingredient)) {
      continue;
    }
    const glucidesParUnite = (ingredient.carbPer100g * ingredient.referenceGrams) / 100;
    const maxUnites = ingredient.maxUnits ?? DEFAULT_MAX_UNITS;
    const brut = glucidesParUnite > 0 ? Math.round(target.carbGrams / glucidesParUnite) : 1;
    unitsById.set(ingredient.id, Math.max(1, Math.min(maxUnites, brut)));
  }

  /** Grammes d'un ingrédient NON ajustable (fixe, lié) pour cette passe. */
  const gramsFiges = (ingredient: RecipeIngredient): number => {
    if (isLinked(ingredient)) {
      return linkedGramsById.get(ingredient.id) ?? 0;
    }
    if (ingredient.role === "fixed") {
      return ingredient.referenceGrams * (unitsById.get(ingredient.id) ?? 1);
    }
    return 0;
  };

  const pinnedGrams = new Map<string, number>();
  const boundById = new Map<string, "min" | "max">();
  const pinnedIds: string[] = [];

  const limite = ingredients.length * 2 + 4;
  let iterations = 0;
  let singular = false;
  let solvedGroups: ScalableRole[] = [];
  let gramsById = new Map<string, number>();
  let iterationLimitReached = false;

  for (;;) {
    iterations += 1;

    // ── 1. Macros déjà apportées : fixes, liés, et tout ce qui est figé ──
    const apporte: Record<SolverMacroKey, number> = { protein: 0, carb: 0, fat: 0 };
    for (const ingredient of ingredients) {
      if (ingredient.role === "free") continue;
      let grammes: number | null = null;
      if (pinnedGrams.has(ingredient.id)) {
        grammes = pinnedGrams.get(ingredient.id) ?? 0;
      } else if (ingredient.role === "fixed" || isLinked(ingredient)) {
        grammes = gramsFiges(ingredient);
      }
      if (grammes === null) continue;
      for (const macro of SOLVER_MACRO_KEYS) {
        apporte[macro] += (macroPer100g(ingredient, macro) * grammes) / 100;
      }
    }

    // ── 2. Résidu à couvrir par les variables restantes ──
    const residu: Record<SolverMacroKey, number> = {
      protein: Math.max(0, target.proteinGrams - apporte.protein),
      carb: Math.max(0, target.carbGrams - apporte.carb),
      fat: Math.max(0, target.fatGrams - apporte.fat),
    };

    // ── 3. Groupes encore libres ──
    const membresParGroupe = new Map<ScalableRole, RecipeIngredient[]>();
    for (const role of SCALABLE_ROLES) {
      const membres = ingredients.filter(
        (i) => i.role === role && !isLinked(i) && !pinnedGrams.has(i.id),
      );
      if (membres.length > 0) {
        membresParGroupe.set(role, membres);
      }
    }
    const groupesActifs = SCALABLE_ROLES.filter((role) => membresParGroupe.has(role));
    solvedGroups = [...groupesActifs];

    // ── 4. Contributions de chaque groupe à chaque macro ──
    const contribution = new Map<ScalableRole, Record<SolverMacroKey, number>>();
    for (const role of groupesActifs) {
      const membres = membresParGroupe.get(role) ?? [];
      contribution.set(role, {
        protein: membres.reduce((s, i) => s + (i.proteinPer100g * i.referenceGrams) / 100, 0),
        carb: membres.reduce((s, i) => s + (i.carbPer100g * i.referenceGrams) / 100, 0),
        fat: membres.reduce((s, i) => s + (i.fatPer100g * i.referenceGrams) / 100, 0),
      });
    }

    // ── 5. Résolution du système ──
    const ratios = new Map<ScalableRole, number>();
    for (const role of groupesActifs) {
      ratios.set(role, 1);
    }

    /** Repli quand le système est dégénéré : chaque groupe vise sa propre macro. */
    const repli = (): void => {
      singular = true;
      for (const role of groupesActifs) {
        const macro = ROLE_TO_MACRO[role];
        const denominateur = contribution.get(role)?.[macro] ?? 0;
        if (denominateur > 0) {
          ratios.set(role, residu[macro] / denominateur);
        }
      }
    };

    if (groupesActifs.length === 1) {
      const role = groupesActifs[0];
      const macro = ROLE_TO_MACRO[role];
      const denominateur = contribution.get(role)?.[macro] ?? 0;
      if (denominateur > 0) {
        ratios.set(role, residu[macro] / denominateur);
      } else {
        singular = true;
      }
    } else if (groupesActifs.length === 2) {
      const [r0, r1] = groupesActifs;
      const macros: SolverMacroKey[] = [ROLE_TO_MACRO[r0], ROLE_TO_MACRO[r1]];
      const c0 = contribution.get(r0) as Record<SolverMacroKey, number>;
      const c1 = contribution.get(r1) as Record<SolverMacroKey, number>;
      const A = [
        [c0[macros[0]], c1[macros[0]]],
        [c0[macros[1]], c1[macros[1]]],
      ];
      const b = [residu[macros[0]], residu[macros[1]]];
      const d = det2(A);
      if (Math.abs(d) > DETERMINANT_EPSILON) {
        ratios.set(
          r0,
          det2([
            [b[0], A[0][1]],
            [b[1], A[1][1]],
          ]) / d,
        );
        ratios.set(
          r1,
          det2([
            [A[0][0], b[0]],
            [A[1][0], b[1]],
          ]) / d,
        );
      } else {
        repli();
      }
    } else if (groupesActifs.length >= 3) {
      const [r0, r1, r2] = groupesActifs;
      const c0 = contribution.get(r0) as Record<SolverMacroKey, number>;
      const c1 = contribution.get(r1) as Record<SolverMacroKey, number>;
      const c2 = contribution.get(r2) as Record<SolverMacroKey, number>;
      const A = SOLVER_MACRO_KEYS.map((m) => [c0[m], c1[m], c2[m]]);
      const b = SOLVER_MACRO_KEYS.map((m) => residu[m]);
      const d = det3(A);
      if (Math.abs(d) > DETERMINANT_EPSILON) {
        const resoudre = (colonne: number): number => {
          const M = A.map((ligne, i) => ligne.map((v, j) => (j === colonne ? b[i] : v)));
          return det3(M) / d;
        };
        ratios.set(r0, resoudre(0));
        ratios.set(r1, resoudre(1));
        ratios.set(r2, resoudre(2));
      } else {
        repli();
      }
    }

    // Aucune quantité négative : un ratio négatif signifierait « retirer »
    // de la nourriture, ce qui n'a pas de sens physique.
    for (const role of groupesActifs) {
      const valeur = ratios.get(role) ?? 1;
      ratios.set(role, Number.isFinite(valeur) ? Math.max(0, valeur) : 0);
    }

    // ── 6. Quantités de cette itération ──
    gramsById = new Map<string, number>();
    for (const ingredient of ingredients) {
      if (ingredient.role === "free") {
        gramsById.set(ingredient.id, 0);
        continue;
      }
      if (pinnedGrams.has(ingredient.id)) {
        gramsById.set(ingredient.id, pinnedGrams.get(ingredient.id) ?? 0);
        continue;
      }
      if (ingredient.role === "fixed" || isLinked(ingredient)) {
        gramsById.set(ingredient.id, gramsFiges(ingredient));
        continue;
      }
      const ratio = ratios.get(ingredient.role as ScalableRole) ?? 1;
      gramsById.set(ingredient.id, Math.max(0, ingredient.referenceGrams * ratio));
    }

    // ── 7. Une borne est-elle violée ? ──
    let pireIndex = -1;
    let pireAmplitude = 0;
    let pireBorne: "min" | "max" = "max";
    let pireValeur = 0;

    ingredients.forEach((ingredient, index) => {
      if (!isScalableRole(ingredient.role) || isLinked(ingredient) || pinnedGrams.has(ingredient.id)) {
        return;
      }
      const brut = gramsById.get(ingredient.id) ?? 0;
      const min = ingredient.minGrams;
      const max = ingredient.maxGrams;
      if (typeof max === "number" && brut > max + BOUND_EPSILON) {
        const amplitude = brut - max;
        if (amplitude > pireAmplitude) {
          pireAmplitude = amplitude;
          pireIndex = index;
          pireBorne = "max";
          pireValeur = max;
        }
        return;
      }
      if (typeof min === "number" && brut < min - BOUND_EPSILON) {
        const amplitude = min - brut;
        if (amplitude > pireAmplitude) {
          pireAmplitude = amplitude;
          pireIndex = index;
          pireBorne = "min";
          pireValeur = min;
        }
      }
    });

    if (pireIndex < 0) {
      break; // stable : plus aucune borne violée
    }

    if (iterations >= limite) {
      iterationLimitReached = true;
      // Sécurité : on borne quand même les quantités restantes plutôt que
      // de renvoyer une valeur hors bornes.
      for (const ingredient of ingredients) {
        if (!isScalableRole(ingredient.role) || isLinked(ingredient)) continue;
        const { grams, bound } = clampToBounds(ingredient, gramsById.get(ingredient.id) ?? 0);
        gramsById.set(ingredient.id, grams);
        if (bound) boundById.set(ingredient.id, bound);
      }
      break;
    }

    // ── 8. Figer l'ingrédient le plus en faute, puis relancer ──
    const aFiger = ingredients[pireIndex];
    pinnedGrams.set(aFiger.id, pireValeur);
    boundById.set(aFiger.id, pireBorne);
    pinnedIds.push(aFiger.id);
  }

  return {
    gramsById,
    boundById,
    pinnedIds,
    unitsById,
    iterations,
    singular,
    solvedGroups,
    iterationLimitReached,
  };
}

/* ─────────────────────────── Point d'entrée ─────────────────────────── */

/**
 * Résout une recette pour une cible P/G/L donnée.
 * Ne modifie ni la recette, ni ses ingrédients, ni la cible.
 */
export function solveRecipe(recipe: Recipe, options: SolveOptions): RecipeSolution {
  const target: RecipeMacroTarget = {
    proteinGrams: options.target.proteinGrams,
    carbGrams: options.target.carbGrams,
    fatGrams: options.target.fatGrams,
  };
  const effective = applySubstitutions(recipe, options.substitutions ?? []);
  const ingredients = effective.ingredients;
  const warnings: SolverWarning[] = [];

  // Une substitution doit conserver le rôle macro de l'original ; on ne la
  // refuse pas (le calcul reste possible), mais on le signale.
  for (const substitution of options.substitutions ?? []) {
    const cible = recipe.ingredients.find((i) => i.id === substitution.ingredientId);
    if (!cible) {
      warnings.push({
        code: "substitution_role_mismatch",
        ingredientId: substitution.ingredientId,
        message: `Substitution ignorée : aucun ingrédient « ${substitution.ingredientId} » dans cette recette.`,
      });
    }
  }

  const lies = ingredients.filter(isLinked);

  // ── Passe 1 : ingrédients liés ignorés (contribution nulle) ──
  const passe1 = solvePass(ingredients, target, new Map());

  let passeFinale = passe1;
  let passes = 1;

  if (lies.length > 0) {
    const grammesLies = new Map<string, number>();
    for (const lie of lies) {
      const parentId = lie.linkedToIngredientId as string;
      const parent = ingredients.find((i) => i.id === parentId);
      if (!parent) {
        warnings.push({
          code: "linked_parent_missing",
          ingredientId: lie.id,
          message: `L'ingrédient « ${lie.name} » référence un parent introuvable (« ${parentId} »).`,
        });
        grammesLies.set(lie.id, 0);
        continue;
      }
      const grammesParent = passe1.gramsById.get(parent.id) ?? 0;
      grammesLies.set(lie.id, applyBasisPoints(grammesParent, lie.linkRatioBp ?? 0));
    }
    passeFinale = solvePass(ingredients, target, grammesLies);
    passes = 2;
  }

  // ── Composition du résultat ──
  const solved: SolvedIngredient[] = ingredients.map((ingredient) => {
    const grams = ingredient.role === "free" ? 0 : (passeFinale.gramsById.get(ingredient.id) ?? 0);
    const proteinGrams = (ingredient.proteinPer100g * grams) / 100;
    const carbGrams = (ingredient.carbPer100g * grams) / 100;
    const fatGrams = (ingredient.fatPer100g * grams) / 100;
    const units = passeFinale.unitsById.get(ingredient.id) ?? null;

    let unitLabel: string | null = null;
    if (units !== null && ingredient.unitName) {
      unitLabel = `${units} ${ingredient.unitName}${units > 1 ? "s" : ""} (${Math.round(grams)} g)`;
    } else if (ingredient.role === "fixed" && ingredient.fixedLabel) {
      unitLabel = ingredient.fixedLabel;
    }

    let eggCount: number | null = null;
    if (ingredient.egg) {
      const poidsOeuf = ingredient.eggGrams ?? DEFAULT_EGG_GRAMS;
      eggCount = Math.max(1, Math.round(grams / poidsOeuf));
      const ecart = Math.abs(eggCount * poidsOeuf - grams);
      if (ecart > EGG_ROUNDING_WARNING_GRAMS) {
        warnings.push({
          code: "egg_rounding",
          ingredientId: ingredient.id,
          message: `« ${ingredient.name} » : ${eggCount} œuf${eggCount > 1 ? "s" : ""} affiché${eggCount > 1 ? "s" : ""} pour ${Math.round(grams)} g calculés (écart ${Math.round(ecart)} g).`,
        });
      }
    }

    return {
      ingredientId: ingredient.id,
      name: ingredient.name,
      role: ingredient.role,
      grams,
      displayGrams: Math.round(grams),
      units,
      unitLabel,
      eggCount,
      proteinGrams,
      carbGrams,
      fatGrams,
      calories:
        proteinGrams * KCAL_PER_GRAM.protein +
        carbGrams * KCAL_PER_GRAM.carb +
        fatGrams * KCAL_PER_GRAM.fat,
      boundHit: passeFinale.boundById.get(ingredient.id) ?? null,
      pinned: passeFinale.pinnedIds.includes(ingredient.id),
      linkedTo: ingredient.linkedToIngredientId ?? null,
    };
  });

  const totals: SolverTotals = solved.reduce(
    (acc, item) => ({
      proteinGrams: acc.proteinGrams + item.proteinGrams,
      carbGrams: acc.carbGrams + item.carbGrams,
      fatGrams: acc.fatGrams + item.fatGrams,
      calories: acc.calories + item.calories,
    }),
    { proteinGrams: 0, carbGrams: 0, fatGrams: 0, calories: 0 },
  );

  const deltas: SolverDeltas = {
    proteinGrams: totals.proteinGrams - target.proteinGrams,
    carbGrams: totals.carbGrams - target.carbGrams,
    fatGrams: totals.fatGrams - target.fatGrams,
  };

  const boundsHit: BoundHitRecord[] = solved
    .filter((item) => item.boundHit !== null)
    .map((item) => ({
      ingredientId: item.ingredientId,
      bound: item.boundHit as "min" | "max",
      grams: item.grams,
    }));

  for (const record of boundsHit) {
    const ingredient = ingredients.find((i) => i.id === record.ingredientId);
    warnings.push({
      code: record.bound === "max" ? "max_reached" : "min_reached",
      ingredientId: record.ingredientId,
      message:
        record.bound === "max"
          ? `« ${ingredient?.name ?? record.ingredientId} » a atteint son plafond de ${Math.round(record.grams)} g : le reste a été redistribué sur les autres ingrédients.`
          : `« ${ingredient?.name ?? record.ingredientId} » a atteint son plancher de ${Math.round(record.grams)} g : le reste a été redistribué sur les autres ingrédients.`,
    });
  }

  if (passeFinale.singular) {
    warnings.push({
      code: "singular_system",
      message:
        "Les groupes d'ingrédients ne sont pas indépendants : chaque groupe a été résolu sur sa propre macro.",
    });
  }
  if (passeFinale.iterationLimitReached) {
    warnings.push({
      code: "iteration_limit_reached",
      message: "Limite d'itérations atteinte : les quantités ont été bornées sans nouvelle résolution.",
    });
  }
  if (passeFinale.solvedGroups.length === 0) {
    warnings.push({
      code: "no_scalable_ingredient",
      message: "Aucun ingrédient ajustable : les quantités sont entièrement figées.",
    });
  }

  const status = determineStatus(deltas, target);
  if (status !== "exact") {
    warnings.push({
      code: "target_not_reached",
      message:
        status === "approximate"
          ? "La cible est approchée sans être atteinte exactement."
          : "La cible ne peut pas être atteinte avec cette recette et ces bornes.",
    });
  }

  return {
    status,
    ingredients: solved,
    totals,
    target,
    deltas,
    boundsHit,
    warnings,
    determinism: {
      passes,
      iterations: passeFinale.iterations,
      pinnedOrder: [...passeFinale.pinnedIds],
      solvedGroups: [...passeFinale.solvedGroups],
      singular: passeFinale.singular,
      unitDecisions: [...passeFinale.unitsById.entries()].map(([ingredientId, units]) => ({
        ingredientId,
        units,
      })),
    },
  };
}

/**
 * Statut du résultat. `exact` n'est accordé que si CHAQUE macro est à moins
 * de `EXACT_TOLERANCE_GRAMS` de sa cible : une cible approchée n'est jamais
 * présentée comme atteinte.
 */
export function determineStatus(deltas: SolverDeltas, target: RecipeMacroTarget): SolverStatus {
  const ecarts: [number, number][] = [
    [Math.abs(deltas.proteinGrams), targetFor(target, "protein")],
    [Math.abs(deltas.carbGrams), targetFor(target, "carb")],
    [Math.abs(deltas.fatGrams), targetFor(target, "fat")],
  ];
  if (ecarts.every(([ecart]) => ecart <= EXACT_TOLERANCE_GRAMS)) {
    return "exact";
  }
  const approche = ecarts.every(
    ([ecart, cible]) =>
      ecart <= Math.max(APPROXIMATE_TOLERANCE_GRAMS, Math.abs(cible) * APPROXIMATE_TOLERANCE_RATIO),
  );
  return approche ? "approximate" : "impossible";
}
