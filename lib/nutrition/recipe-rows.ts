import {
  SCALABLE_ROLES,
  type Recipe,
  type RecipeIngredient,
  type RecipeIngredientRole,
} from "@/lib/nutrition/recipe-types";

/**
 * Lignes de base des recettes ↔ objets du solveur — fonctions PURES.
 *
 * POURQUOI CE FICHIER SÉPARÉ. Le solveur (`recipe-solver.ts`) et ses types
 * (`recipe-types.ts`) ne connaissent pas Supabase, et ne doivent jamais le
 * connaître : ce sont eux qui portent 25 tests sans base. Toute la traduction
 * ligne ↔ objet vit donc ICI, sans dépendre du client Supabase non plus —
 * ce qui la rend testable sans réseau.
 *
 * GARANTIES, vérifiées par la suite `test:nutrition-recipes` :
 *   - VALEURS EXACTES : aucun arrondi, aucune normalisation silencieuse. Les
 *     `numeric` PostgreSQL arrivent en `string` via PostgREST ; ils sont
 *     convertis en nombre, jamais tronqués ;
 *   - AUCUNE MUTATION : ni des lignes reçues, ni des tableaux d'entrée ;
 *   - ÉCHEC EXPLICITE : une ligne incohérente lève `RecipeMappingError` avec
 *     un code, plutôt que de produire une recette silencieusement fausse ;
 *   - SENS UNIQUE : il n'existe AUCUNE fonction convertissant une
 *     `RecipeSolution` en recette canonique. Les quantités calculées sont
 *     éphémères par exigence produit, et aucune table ne peut les recevoir.
 */

/** Créneaux v2 admis sur une recette. `null` = recette générique. */
export const RECIPE_SLOT_KEYS = [
  "breakfast",
  "morning_snack",
  "lunch",
  "afternoon_snack",
  "dinner",
  "dessert",
] as const;
export type RecipeSlotKey = (typeof RECIPE_SLOT_KEYS)[number];

/** Statut éditorial d'une recette. */
export const RECIPE_STATUSES = ["draft", "active", "archived"] as const;
export type RecipeStatus = (typeof RECIPE_STATUSES)[number];

/** Familles d'étiquettes — vocabulaire contrôlé, jamais du texte libre. */
export const RECIPE_TAG_KINDS = ["allergen", "intolerance", "diet", "excludes"] as const;
export type RecipeTagKind = (typeof RECIPE_TAG_KINDS)[number];

/**
 * Vocabulaire contrôlé, en miroir EXACT de la contrainte
 * `nutrition_recipe_tags_value_check` (migration 20260807090000). Toute
 * extension passe par une migration ET par cette constante — un test vérifie
 * que les deux listes coïncident.
 */
export const RECIPE_TAG_VOCABULARY: Readonly<Record<RecipeTagKind, readonly string[]>> = {
  allergen: [
    "gluten", "milk", "egg", "peanut", "tree_nut", "soy", "fish",
    "shellfish", "sesame", "mustard", "celery", "lupin", "sulfites",
  ],
  intolerance: ["lactose", "gluten", "fructose", "fodmap"],
  diet: ["vegetarian", "vegan", "pescetarian", "halal", "kosher"],
  excludes: [
    "pork", "beef", "veal", "lamb", "poultry", "red_meat", "offal",
    "seafood", "raw_fish", "raw_egg", "alcohol", "caffeine", "spicy",
    "mushroom", "onion_garlic", "added_sugar", "artificial_sweetener",
  ],
};

/**
 * Les cinq rôles d'ingrédient, dans l'ordre canonique. Source unique : toute
 * interface qui propose un choix de rôle lit CETTE liste — elle ne la réécrit
 * pas.
 */
export const RECIPE_INGREDIENT_ROLES: readonly RecipeIngredientRole[] = [
  "protein",
  "carbohydrate",
  "fat",
  "fixed",
  "free",
];

const ROLES = RECIPE_INGREDIENT_ROLES;

/* ─────────────────────────── Lignes de base ─────────────────────────── */

export interface NutritionRecipeRow {
  readonly id: string;
  readonly coach_id: string;
  readonly name: string;
  readonly description: string | null;
  readonly slot_key: string | null;
  readonly status: string;
  /** Identité technique stable d'une recette importée (migration 20260808090000). */
  readonly source_key?: string | null;
  readonly created_at?: string;
  readonly updated_at?: string;
}

export interface NutritionRecipeIngredientRow {
  readonly id: string;
  readonly recipe_id: string;
  readonly position: number;
  readonly name: string;
  readonly role: string;
  /** `numeric` PostgreSQL : `string` via PostgREST, `number` via un pilote direct. */
  readonly protein_per_100g: number | string;
  readonly carb_per_100g: number | string;
  readonly fat_per_100g: number | string;
  readonly reference_grams: number | string;
  readonly min_grams: number | string | null;
  readonly max_grams: number | string | null;
  readonly unit_scalable: boolean;
  readonly max_units: number | null;
  readonly unit_name: string | null;
  readonly fixed_label: string | null;
  readonly egg: boolean;
  readonly egg_grams: number | string | null;
  readonly linked_to_ingredient_id: string | null;
  readonly link_ratio_bp: number | null;
}

export interface NutritionRecipeTagRow {
  readonly recipe_id: string;
  readonly kind: string;
  readonly value: string;
}

/* ─────────────────────────── Erreur de mapping ─────────────────────────── */

export type RecipeMappingErrorCode =
  | "invalid_recipe_row"
  | "invalid_slot_key"
  | "invalid_status"
  | "invalid_ingredient_row"
  | "invalid_role"
  | "invalid_numeric"
  | "invalid_tag_kind"
  | "invalid_tag_value"
  | "ingredient_recipe_mismatch";

/** Échec EXPLICITE : jamais de recette silencieusement fausse. */
export class RecipeMappingError extends Error {
  readonly code: RecipeMappingErrorCode;
  readonly field: string;

  constructor(code: RecipeMappingErrorCode, field: string, detail?: string) {
    super(`RecipeMappingError[${code}] ${field}${detail ? ` — ${detail}` : ""}`);
    this.name = "RecipeMappingError";
    this.code = code;
    this.field = field;
  }
}

/**
 * `numeric` → `number`, sans arrondi ni tolérance. Une valeur illisible lève
 * plutôt que de devenir `NaN` : un `NaN` se propagerait dans le solveur et
 * ressortirait en quantité affichée à l'élève.
 */
function toNumber(valeur: number | string, champ: string): number {
  if (typeof valeur === "number") {
    if (!Number.isFinite(valeur)) {
      throw new RecipeMappingError("invalid_numeric", champ, String(valeur));
    }
    return valeur;
  }
  if (typeof valeur !== "string" || valeur.trim() === "") {
    throw new RecipeMappingError("invalid_numeric", champ, String(valeur));
  }
  const n = Number(valeur);
  if (!Number.isFinite(n)) {
    throw new RecipeMappingError("invalid_numeric", champ, valeur);
  }
  return n;
}

function toNullableNumber(valeur: number | string | null, champ: string): number | null {
  return valeur === null || valeur === undefined ? null : toNumber(valeur, champ);
}

/* ─────────────────────────── Mappers ─────────────────────────── */

/** Ligne d'ingrédient → `RecipeIngredient`. Pure, sans mutation. */
export function mapRecipeIngredientRow(row: NutritionRecipeIngredientRow): RecipeIngredient {
  if (!row || typeof row.id !== "string" || row.id.length === 0) {
    throw new RecipeMappingError("invalid_ingredient_row", "id");
  }
  if (typeof row.name !== "string" || row.name.trim().length === 0) {
    throw new RecipeMappingError("invalid_ingredient_row", "name");
  }
  if (!ROLES.includes(row.role as RecipeIngredientRole)) {
    throw new RecipeMappingError("invalid_role", "role", row.role);
  }
  return {
    id: row.id,
    name: row.name,
    role: row.role as RecipeIngredientRole,
    proteinPer100g: toNumber(row.protein_per_100g, "protein_per_100g"),
    carbPer100g: toNumber(row.carb_per_100g, "carb_per_100g"),
    fatPer100g: toNumber(row.fat_per_100g, "fat_per_100g"),
    referenceGrams: toNumber(row.reference_grams, "reference_grams"),
    minGrams: toNullableNumber(row.min_grams, "min_grams"),
    maxGrams: toNullableNumber(row.max_grams, "max_grams"),
    unitScalable: row.unit_scalable === true,
    maxUnits: row.max_units ?? null,
    unitName: row.unit_name ?? null,
    fixedLabel: row.fixed_label ?? null,
    egg: row.egg === true,
    eggGrams: toNullableNumber(row.egg_grams, "egg_grams"),
    linkedToIngredientId: row.linked_to_ingredient_id ?? null,
    linkRatioBp: row.link_ratio_bp ?? null,
  };
}

/**
 * Ligne de recette + ses ingrédients → `Recipe` prêt pour `solveRecipe`.
 *
 * Les ingrédients sont triés par `position` CROISSANTE — l'ordre est une
 * garantie, pas un hasard : le solveur attribue les unités restantes dans
 * l'ordre reçu, donc un ordre instable produirait des résultats instables.
 */
export function mapRecipeRow(
  row: NutritionRecipeRow,
  ingredientRows: readonly NutritionRecipeIngredientRow[],
): Recipe {
  if (!row || typeof row.id !== "string" || row.id.length === 0) {
    throw new RecipeMappingError("invalid_recipe_row", "id");
  }
  if (typeof row.name !== "string" || row.name.trim().length === 0) {
    throw new RecipeMappingError("invalid_recipe_row", "name");
  }
  if (row.slot_key !== null && !RECIPE_SLOT_KEYS.includes(row.slot_key as RecipeSlotKey)) {
    throw new RecipeMappingError("invalid_slot_key", "slot_key", String(row.slot_key));
  }
  if (!RECIPE_STATUSES.includes(row.status as RecipeStatus)) {
    throw new RecipeMappingError("invalid_status", "status", String(row.status));
  }
  for (const ingredient of ingredientRows) {
    if (ingredient.recipe_id !== row.id) {
      throw new RecipeMappingError("ingredient_recipe_mismatch", "recipe_id", ingredient.recipe_id);
    }
  }
  // `[...]` avant `sort` : le tableau reçu n'est JAMAIS trié en place.
  const triés = [...ingredientRows].sort((a, b) => a.position - b.position);
  return {
    id: row.id,
    name: row.name,
    slot: row.slot_key,
    ingredients: triés.map(mapRecipeIngredientRow),
  };
}

/** Étiquette validée contre le vocabulaire contrôlé. */
export interface RecipeTag {
  readonly kind: RecipeTagKind;
  readonly value: string;
}

export function mapRecipeTagRow(row: NutritionRecipeTagRow): RecipeTag {
  if (!RECIPE_TAG_KINDS.includes(row.kind as RecipeTagKind)) {
    throw new RecipeMappingError("invalid_tag_kind", "kind", row.kind);
  }
  const kind = row.kind as RecipeTagKind;
  if (!RECIPE_TAG_VOCABULARY[kind].includes(row.value)) {
    throw new RecipeMappingError("invalid_tag_value", "value", `${kind}/${row.value}`);
  }
  return { kind, value: row.value };
}

/**
 * Recette canonique enrichie de ses étiquettes — l'unité manipulée par le
 * filtrage et par le solveur.
 */
export interface RecipeWithTags {
  readonly recipe: Recipe;
  readonly slotKey: RecipeSlotKey | null;
  readonly status: RecipeStatus;
  readonly tags: readonly RecipeTag[];
  /** Texte libre du coach — non utilisé par le solveur. */
  readonly description: string | null;
  /** `null` = recette saisie à la main ; sinon « fixture:<cle> ». */
  readonly sourceKey: string | null;
  /** Horodatage brut, tel que rendu par la base. Aucune reformulation ici. */
  readonly updatedAt: string | null;
}

export function assembleRecipeWithTags(
  row: NutritionRecipeRow,
  ingredientRows: readonly NutritionRecipeIngredientRow[],
  tagRows: readonly NutritionRecipeTagRow[],
): RecipeWithTags {
  const recipe = mapRecipeRow(row, ingredientRows);
  return {
    recipe,
    slotKey: (row.slot_key as RecipeSlotKey | null) ?? null,
    status: row.status as RecipeStatus,
    tags: tagRows.map(mapRecipeTagRow),
    description: row.description ?? null,
    sourceKey: row.source_key ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * `Recipe` → charge utile d'écriture. Fournie pour que les tests puissent
 * construire un jeu d'essai cohérent avec le schéma SANS que la PR A
 * n'expose la moindre fonction d'écriture réelle : ce fichier ne parle pas
 * à Supabase.
 *
 * ⚠️ Le paramètre est un `Recipe` — JAMAIS une `RecipeSolution`. Le type
 * l'empêche, et un test le verrouille : une portion calculée ne peut pas
 * remonter en recette canonique.
 */
export function buildRecipeIngredientInsertPayload(
  recipeId: string,
  ingredient: RecipeIngredient,
  position: number,
): Record<string, unknown> {
  return {
    id: ingredient.id,
    recipe_id: recipeId,
    position,
    name: ingredient.name,
    role: ingredient.role,
    protein_per_100g: ingredient.proteinPer100g,
    carb_per_100g: ingredient.carbPer100g,
    fat_per_100g: ingredient.fatPer100g,
    reference_grams: ingredient.referenceGrams,
    min_grams: ingredient.minGrams ?? null,
    max_grams: ingredient.maxGrams ?? null,
    unit_scalable: ingredient.unitScalable === true,
    max_units: ingredient.unitScalable ? (ingredient.maxUnits ?? null) : null,
    unit_name: ingredient.unitScalable ? (ingredient.unitName ?? null) : null,
    fixed_label: ingredient.fixedLabel ?? null,
    egg: ingredient.egg === true,
    egg_grams: ingredient.egg ? (ingredient.eggGrams ?? null) : null,
    linked_to_ingredient_id: ingredient.linkedToIngredientId ?? null,
    link_ratio_bp: ingredient.linkedToIngredientId ? (ingredient.linkRatioBp ?? null) : null,
  };
}

/** Les rôles porteurs d'une variable d'ajustement, réexportés pour le filtrage. */
export { SCALABLE_ROLES };
