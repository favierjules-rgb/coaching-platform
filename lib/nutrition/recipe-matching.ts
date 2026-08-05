import { computeDailyMacroTargets } from "@/lib/nutrition/macro-targets";
import {
  computeMealDistribution,
  type MacroKey,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import type { NutritionPlanV2Profile } from "@/lib/nutrition/plan-v2-validation";
import type { RecipeMacroTarget } from "@/lib/nutrition/recipe-types";
import type { RecipeSolution } from "@/lib/nutrition/recipe-solver";
import {
  RECIPE_TAG_VOCABULARY,
  type RecipeTagKind,
  type RecipeWithTags,
} from "@/lib/nutrition/recipe-rows";

/**
 * Rapprochement recette ↔ créneau v2 — fonctions PURES, sans Supabase.
 *
 * TROIS RESPONSABILITÉS, RIEN DE PLUS :
 *   1. `buildRecipeTargetForMealSlot` — la cible en grammes d'UN créneau ;
 *   2. `filterRecipesForProfile`      — écarter les recettes incompatibles ;
 *   3. `describeRecipeFit`            — dire l'écart en français.
 *
 * AUCUNE FORMULE N'EST DUPLIQUÉE. Les grammes viennent de
 * `computeDailyMacroTargets` puis `computeMealDistribution`, exactement comme
 * le constructeur de plans. Réécrire `calories × bp / 10 000 / 4` ici créerait
 * une seconde vérité qui divergerait au premier ajustement.
 */

/* ═══════════════════ 1. Cible d'un créneau ═══════════════════ */

export type RecipeTargetRefusal =
  /** Le profil ne porte aucune calorie exploitable. */
  | "no_calories"
  /** Le créneau demandé n'existe pas dans ce profil. */
  | "slot_not_found"
  /** Le créneau existe mais il est désactivé. */
  | "slot_disabled";

export type RecipeTargetResult =
  | {
      readonly ok: true;
      readonly slot: MealSlotKey;
      readonly target: RecipeMacroTarget;
      /** Calories du créneau, dérivées des grammes (4 / 4 / 9). */
      readonly calories: number;
    }
  | { readonly ok: false; readonly reason: RecipeTargetRefusal };

/**
 * Cible du solveur pour UN créneau d'un profil v2.
 *
 * Grammes NON ARRONDIS : l'arrondi appartient à l'affichage. Passer des
 * grammes arrondis au solveur ferait dériver la somme des repas par rapport
 * à la cible journalière — le défaut que le modèle v2 a précisément supprimé.
 *
 * Refus explicite plutôt que cible nulle : une cible à zéro est une cible
 * valide (le solveur la traite), alors qu'un profil sans calories ou un
 * créneau désactivé sont des situations à SIGNALER, pas à calculer.
 */
export function buildRecipeTargetForMealSlot(
  profile: NutritionPlanV2Profile,
  slot: MealSlotKey,
): RecipeTargetResult {
  if (
    typeof profile.dailyCalories !== "number" ||
    !Number.isFinite(profile.dailyCalories) ||
    profile.dailyCalories <= 0
  ) {
    return { ok: false, reason: "no_calories" };
  }

  const quotidien = computeDailyMacroTargets({
    dailyCalories: profile.dailyCalories,
    proteinBp: profile.proteinBp,
    carbBp: profile.carbBp,
    fatBp: profile.fatBp,
  });
  const distribution = computeMealDistribution(quotidien, profile.slots);
  const créneau = distribution.slots.find((s) => s.slot === slot);

  if (!créneau) {
    return { ok: false, reason: "slot_not_found" };
  }
  if (!créneau.enabled) {
    return { ok: false, reason: "slot_disabled" };
  }

  return {
    ok: true,
    slot,
    target: {
      proteinGrams: créneau.proteinGrams,
      carbGrams: créneau.carbGrams,
      fatGrams: créneau.fatGrams,
    },
    calories: créneau.calories,
  };
}

/* ═══════════════════ 2. Filtrage par profil ═══════════════════ */

/**
 * Contraintes alimentaires de l'élève, EN CLÉS TECHNIQUES CONTRÔLÉES.
 *
 * ⚠️ CE TYPE N'EST PAS `student_profiles`. Les colonnes
 * `allergies` / `intolerances` / `disliked_foods` sont des tableaux jsonb de
 * TEXTE LIBRE, nullables, saisis à l'onboarding. Comparer « arachide » à un
 * nom d'ingrédient produirait des faux négatifs — sur des ALLERGIES.
 *
 * Ce module refuse donc de faire cette comparaison. Il ne travaille QUE sur
 * les clés du vocabulaire contrôlé (`RECIPE_TAG_VOCABULARY`). La traduction
 * du texte libre vers ces clés est une décision de coach, pas une heuristique
 * de chaîne de caractères : elle appartient à la PR B et n'existe pas ici.
 */
export interface StudentDietaryProfile {
  readonly allergens?: readonly string[] | null;
  readonly intolerances?: readonly string[] | null;
  /** Régimes à respecter : la recette doit porter CHACUN d'eux. */
  readonly diets?: readonly string[] | null;
  /** Catégories d'aliment refusées. */
  readonly excludes?: readonly string[] | null;
}

export type RecipeExclusionReason =
  | "slot_mismatch"
  | "status_not_active"
  | "allergen"
  | "intolerance"
  | "diet"
  | "excludes"
  | "unknown_constraint_key";

export interface RecipeMatch {
  readonly recipe: RecipeWithTags;
  readonly kept: boolean;
  readonly reason: RecipeExclusionReason | null;
  /** Valeur exacte ayant motivé le rejet — pour le diagnostic, pas l'affichage élève. */
  readonly detail: string | null;
}

export interface FilterRecipesOptions {
  /** Créneau visé. `undefined` = ne pas filtrer sur le créneau. */
  readonly slot?: MealSlotKey;
  /** N'accepter que les recettes `active`. Vrai par défaut. */
  readonly activeOnly?: boolean;
}

/** Nettoie une liste de contraintes : ignore null, vides et non-chaînes. */
function normaliser(valeurs: readonly string[] | null | undefined): string[] {
  if (!Array.isArray(valeurs)) return [];
  return valeurs.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/**
 * Une clé hors vocabulaire n'est JAMAIS ignorée silencieusement.
 *
 * Ignorer « peanuts » (au pluriel, hors vocabulaire) reviendrait à servir un
 * plat contenant des arachides à quelqu'un qui y est allergique. On préfère
 * écarter la recette et remonter la raison : un faux positif est une gêne,
 * un faux négatif est un risque.
 */
function clésInconnues(kind: RecipeTagKind, clés: readonly string[]): string[] {
  const vocabulaire = RECIPE_TAG_VOCABULARY[kind];
  return clés.filter((clé) => !vocabulaire.includes(clé));
}

function valeursDuType(recette: RecipeWithTags, kind: RecipeTagKind): Set<string> {
  const set = new Set<string>();
  for (const tag of recette.tags) {
    if (tag.kind === kind) set.add(tag.value);
  }
  return set;
}

/**
 * Écarte les recettes incompatibles. Fonction PURE et DÉTERMINISTE :
 * l'ordre d'entrée est conservé, aucune entrée n'est mutée.
 *
 * RÈGLES :
 *   - profil absent, `null`, ou tableaux vides ⇒ AUCUNE contrainte
 *     alimentaire : toutes les recettes du créneau passent. `null` et `[]`
 *     se comportent à l'identique — verrouillé par test ;
 *   - `slotKey === null` ⇒ recette GÉNÉRIQUE, compatible avec tout créneau ;
 *   - `slotKey` renseigné ⇒ doit correspondre exactement au créneau visé ;
 *   - `allergen`, `intolerance`, `excludes` : la recette est écartée si elle
 *     PORTE une clé refusée ;
 *   - `diet` : sémantique INVERSE — la recette doit PORTER chaque régime
 *     demandé pour être conservée. Un plat ne « contient » pas un régime, il
 *     y est compatible ; une recette non étiquetée n'est donc pas présumée
 *     végétarienne.
 */
export function filterRecipesForProfile(
  recipes: readonly RecipeWithTags[],
  profile: StudentDietaryProfile | null | undefined,
  options: FilterRecipesOptions = {},
): readonly RecipeMatch[] {
  const activeOnly = options.activeOnly ?? true;
  const allergènes = normaliser(profile?.allergens);
  const intolérances = normaliser(profile?.intolerances);
  const régimes = normaliser(profile?.diets);
  const exclusions = normaliser(profile?.excludes);

  const inconnues = [
    ...clésInconnues("allergen", allergènes).map((v) => `allergen/${v}`),
    ...clésInconnues("intolerance", intolérances).map((v) => `intolerance/${v}`),
    ...clésInconnues("diet", régimes).map((v) => `diet/${v}`),
    ...clésInconnues("excludes", exclusions).map((v) => `excludes/${v}`),
  ];

  return recipes.map((recette): RecipeMatch => {
    if (activeOnly && recette.status !== "active") {
      return { recipe: recette, kept: false, reason: "status_not_active", detail: recette.status };
    }
    if (options.slot !== undefined && recette.slotKey !== null && recette.slotKey !== options.slot) {
      return { recipe: recette, kept: false, reason: "slot_mismatch", detail: recette.slotKey };
    }
    // Une contrainte illisible bloque TOUT — voir `clésInconnues`.
    if (inconnues.length > 0) {
      return {
        recipe: recette,
        kept: false,
        reason: "unknown_constraint_key",
        detail: inconnues.join(", "),
      };
    }

    for (const [kind, refusées] of [
      ["allergen", allergènes],
      ["intolerance", intolérances],
      ["excludes", exclusions],
    ] as const) {
      const portées = valeursDuType(recette, kind);
      const heurt = refusées.find((clé) => portées.has(clé));
      if (heurt !== undefined) {
        return { recipe: recette, kept: false, reason: kind, detail: heurt };
      }
    }

    if (régimes.length > 0) {
      const portés = valeursDuType(recette, "diet");
      const manquant = régimes.find((clé) => !portés.has(clé));
      if (manquant !== undefined) {
        return { recipe: recette, kept: false, reason: "diet", detail: manquant };
      }
    }

    return { recipe: recette, kept: true, reason: null, detail: null };
  });
}

/** Raccourci : uniquement les recettes conservées, dans l'ordre d'entrée. */
export function keepMatchingRecipes(
  recipes: readonly RecipeWithTags[],
  profile: StudentDietaryProfile | null | undefined,
  options: FilterRecipesOptions = {},
): readonly RecipeWithTags[] {
  return filterRecipesForProfile(recipes, profile, options)
    .filter((m) => m.kept)
    .map((m) => m.recipe);
}

/* ═══════════════════ 3. Description de l'écart ═══════════════════ */

const NBSP = " ";

const LIBELLÉS: Readonly<Record<MacroKey, string>> = {
  protein: "protéines",
  carb: "glucides",
  fat: "lipides",
};

/** Arrondi d'AFFICHAGE — jamais réinjecté dans un calcul. */
function afficher(grammes: number): string {
  const arrondi = Math.round(grammes);
  const signe = arrondi > 0 ? "+" : "";
  return `${signe}${arrondi}${NBSP}g`;
}

export interface RecipeFitDescription {
  readonly status: RecipeSolution["status"];
  /** `true` uniquement pour `exact` et `approximate`. */
  readonly proposable: boolean;
  /** Phrase française, prête à afficher. */
  readonly summary: string;
  /** Détail par macro, vide pour `exact`. */
  readonly details: readonly string[];
  /** Raison principale d'un échec — usage INTERNE (tests, aperçu admin). */
  readonly mainReason: string | null;
}

/**
 * Traduit une solution du solveur en une phrase française déterministe.
 *
 * DÉCISION PRODUIT FIGÉE : `exact` et `approximate` sont proposables,
 * `impossible` ne l'est pas côté élève — mais reste exploitable ici, pour
 * les tests et le futur aperçu administrateur.
 *
 * Aucun texte médical, aucun conseil : on décrit un écart de calcul.
 */
export function describeRecipeFit(solution: RecipeSolution): RecipeFitDescription {
  const kcalCalculées = Math.round(solution.totals.calories);

  if (solution.status === "exact") {
    return {
      status: "exact",
      proposable: true,
      summary: `Cette recette atteint exactement la cible du repas (${kcalCalculées}${NBSP}kcal).`,
      details: [],
      mainReason: null,
    };
  }

  const écarts: { macro: MacroKey; écart: number }[] = [
    { macro: "protein", écart: solution.deltas.proteinGrams },
    { macro: "carb", écart: solution.deltas.carbGrams },
    { macro: "fat", écart: solution.deltas.fatGrams },
  ];
  const kcalCible = Math.round(
    solution.target.proteinGrams * 4 + solution.target.carbGrams * 4 + solution.target.fatGrams * 9,
  );
  const détails = écarts
    .filter(({ écart }) => Math.round(écart) !== 0)
    .map(({ macro, écart }) => `${LIBELLÉS[macro]} ${afficher(écart)}`);

  if (solution.status === "approximate") {
    const suffixe = détails.length > 0 ? ` : ${détails.join(", ")}.` : ".";
    return {
      status: "approximate",
      proposable: true,
      summary:
        `Cette recette approche la cible du repas (${kcalCalculées}${NBSP}kcal` +
        ` pour ${kcalCible}${NBSP}kcal visés)${suffixe}`,
      details: détails,
      mainReason: null,
    };
  }

  // `impossible` — usage interne. On nomme la cause la plus explicative :
  // une borne atteinte d'abord, sinon la macro la plus éloignée.
  const borne = solution.boundsHit[0] ?? null;
  const pire = écarts.reduce((a, b) => (Math.abs(b.écart) > Math.abs(a.écart) ? b : a));
  const raison = borne
    ? `bound_${borne.bound}:${borne.ingredientId}`
    : `macro_gap:${pire.macro}`;

  return {
    status: "impossible",
    proposable: false,
    summary:
      `Cette recette ne peut pas atteindre la cible du repas` +
      (détails.length > 0 ? ` : ${détails.join(", ")}.` : "."),
    details: détails,
    mainReason: raison,
  };
}
