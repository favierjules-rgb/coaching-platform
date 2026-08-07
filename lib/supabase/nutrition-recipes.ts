import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RecipeMappingError,
  assembleRecipeWithTags,
  toNutritionRecipeIngredientRow,
  type NutritionRecipeIngredientRow,
  type NutritionRecipeRow,
  type NutritionRecipeTagRow,
  type RecipeSlotKey,
  type RecipeStatus,
  type RecipeWithTags,
} from "@/lib/nutrition/recipe-rows";
import type { Database } from "@/types/supabase";

/**
 * LECTURE des recettes adaptatives — aucune écriture dans cette PR.
 *
 * PAS DE N+1, PAR CONSTRUCTION. Une recette a N ingrédients et M étiquettes.
 * Charger 20 recettes en interrogeant chaque enfant ferait 41 requêtes. Ce
 * module en fait TOUJOURS TROIS, quel que soit le nombre de recettes :
 *   1. les recettes ;
 *   2. tous leurs ingrédients, en un seul `in(recipe_id, …)` ;
 *   3. toutes leurs étiquettes, idem.
 * C'est le motif déjà validé par `readNutritionPlanV2`.
 *
 * ORDRE DÉTERMINISTE. Recettes triées par `(name, id)`, ingrédients par
 * `(recipe_id, position)`. L'ordre des ingrédients n'est pas cosmétique : le
 * solveur attribue les unités entières restantes dans l'ordre reçu.
 *
 * RECETTE INVALIDE : jamais silencieuse. Le mapping lève, l'erreur est
 * capturée POUR CETTE RECETTE, et la lecture continue — une recette mal
 * saisie ne doit pas vider tout le catalogue. Le refus est rendu à
 * l'appelant dans `invalid[]`.
 *
 * AUCUN CHEMIN D'ÉCRITURE ICI. Pas d'`insert`, pas d'`update`, pas de
 * `delete` : la PR A ne livre aucune interface d'administration, et une
 * portion calculée n'a nulle part où être enregistrée.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

const TABLE_RECIPES = "nutrition_recipes";
const TABLE_INGREDIENTS = "nutrition_recipe_ingredients";
const TABLE_TAGS = "nutrition_recipe_tags";

/** Une recette écartée à la lecture, avec la raison exacte. */
export interface InvalidRecipe {
  readonly recipeId: string;
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

export interface ReadRecipesResult {
  readonly recipes: readonly RecipeWithTags[];
  /** Recettes présentes en base mais inexploitables. Jamais masquées. */
  readonly invalid: readonly InvalidRecipe[];
}

export interface ReadRecipesOptions {
  /** Ne charger que ces statuts. Par défaut : uniquement `active`. */
  readonly statuses?: readonly RecipeStatus[];
  /**
   * Créneau visé. Charge les recettes de ce créneau ET les génériques
   * (`slot_key is null`) — le filtre est appliqué en base, pas en mémoire.
   */
  readonly slot?: RecipeSlotKey;
}

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

/**
 * Toutes les recettes correspondant aux options, avec ingrédients et
 * étiquettes. EXACTEMENT trois requêtes réseau.
 */
export async function readNutritionRecipes(
  supabase: TypedSupabaseClient,
  options: ReadRecipesOptions = {},
): Promise<ReadRecipesResult> {
  const statuses = options.statuses ?? (["active"] as const);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let requête = (supabase.from(TABLE_RECIPES) as any)
    .select("id, coach_id, name, description, slot_key, status, source_key, image_path, created_at, updated_at")
    .in("status", statuses as readonly string[]);

  if (options.slot !== undefined) {
    // Recettes du créneau OU génériques. `or` s'exécute en base : aucun
    // sur-chargement mémoire, et l'index (status, slot_key) reste utile.
    requête = requête.or(`slot_key.eq.${options.slot},slot_key.is.null`);
  }

  const { data: recipeRows, error: recipesError } = await requête
    .order("name", { ascending: true })
    .order("id", { ascending: true });
  devWarn("readNutritionRecipes (recettes)", recipesError);

  const recettes = (recipeRows ?? []) as NutritionRecipeRow[];
  if (recettes.length === 0) {
    return { recipes: [], invalid: [] };
  }

  const ids = recettes.map((r) => r.id);
  const [ingrédients, étiquettes] = await Promise.all([
    readIngredientsFor(supabase, ids),
    readTagsFor(supabase, ids),
  ]);

  return assembler(recettes, ingrédients, étiquettes);
}

/** Une recette précise, ou `null`. Toujours trois requêtes, jamais plus. */
export async function readNutritionRecipe(
  supabase: TypedSupabaseClient,
  recipeId: string,
): Promise<{ recipe: RecipeWithTags | null; invalid: InvalidRecipe | null }> {
  const { data, error } = await supabase
    .from(TABLE_RECIPES)
    .select("id, coach_id, name, description, slot_key, status, source_key, image_path, created_at, updated_at")
    .eq("id", recipeId)
    .maybeSingle();
  devWarn("readNutritionRecipe (recette)", error);

  const ligne = data as NutritionRecipeRow | null;
  if (!ligne) {
    return { recipe: null, invalid: null };
  }

  const [ingrédients, étiquettes] = await Promise.all([
    readIngredientsFor(supabase, [ligne.id]),
    readTagsFor(supabase, [ligne.id]),
  ]);

  const résultat = assembler([ligne], ingrédients, étiquettes);
  return {
    recipe: résultat.recipes[0] ?? null,
    invalid: résultat.invalid[0] ?? null,
  };
}

/* ─────────────────────────── Interne ─────────────────────────── */

async function readIngredientsFor(
  supabase: TypedSupabaseClient,
  recipeIds: readonly string[],
): Promise<NutritionRecipeIngredientRow[]> {
  const { data, error } = await supabase
    .from(TABLE_INGREDIENTS)
    .select(
      "id, recipe_id, position, name, role, protein_per_100g, carb_per_100g, fat_per_100g, " +
        "reference_grams, min_grams, max_grams, unit_scalable, max_units, unit_name, " +
        "fixed_label, egg, egg_grams, linked_to_ingredient_id, link_ratio_bp",
    )
    .in("recipe_id", recipeIds as string[])
    .order("recipe_id", { ascending: true })
    .order("position", { ascending: true });
  devWarn("readNutritionRecipes (ingrédients)", error);
  // PAS D'AFFIRMATION DE TYPE ICI. `nutrition_recipe_ingredients` n'est pas
  // décrite dans types/supabase.ts (tenu à la main), donc le client ne peut
  // pas typer `data` ; l'écrire `data as NutritionRecipeIngredientRow[]` ne
  // vérifiait rien et cassait dès la régénération du fichier de types. La
  // projection champ par champ est faite par `toNutritionRecipeIngredientRow`
  // (lib/nutrition/recipe-rows.ts), adossée au schéma de la migration
  // 20260807090000 : elle ne lève jamais, ne convertit rien, et laisse le
  // jugement de validité à `mapRecipeIngredientRow` — donc une ligne
  // incohérente continue d'être isolée recette par recette dans `invalid[]`.
  //
  // `Array.isArray` plutôt que `data ?? []` : il donne le même résultat sur
  // les deux seules valeurs réellement produites par le client (un tableau,
  // ou `null` en cas d'erreur) tout en restant vrai quel que soit le type
  // que le client inférera une fois types/supabase.ts régénéré.
  const lignes: readonly unknown[] = Array.isArray(data) ? data : [];
  return lignes.map(toNutritionRecipeIngredientRow);
}

async function readTagsFor(
  supabase: TypedSupabaseClient,
  recipeIds: readonly string[],
): Promise<NutritionRecipeTagRow[]> {
  const { data, error } = await supabase
    .from(TABLE_TAGS)
    .select("recipe_id, kind, value")
    .in("recipe_id", recipeIds as string[])
    .order("recipe_id", { ascending: true })
    .order("kind", { ascending: true })
    .order("value", { ascending: true });
  devWarn("readNutritionRecipes (étiquettes)", error);
  return (data ?? []) as NutritionRecipeTagRow[];
}

function grouper<T>(lignes: readonly T[], clé: (ligne: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const ligne of lignes) {
    const k = clé(ligne);
    const liste = map.get(k);
    if (liste) liste.push(ligne);
    else map.set(k, [ligne]);
  }
  return map;
}

/**
 * Assemblage PUR. Une recette dont le mapping échoue est isolée dans
 * `invalid` — les autres restent lisibles.
 */
export function assembler(
  recipeRows: readonly NutritionRecipeRow[],
  ingredientRows: readonly NutritionRecipeIngredientRow[],
  tagRows: readonly NutritionRecipeTagRow[],
): ReadRecipesResult {
  const parRecette = grouper(ingredientRows, (r) => r.recipe_id);
  const étiquettesParRecette = grouper(tagRows, (r) => r.recipe_id);

  const recipes: RecipeWithTags[] = [];
  const invalid: InvalidRecipe[] = [];

  for (const ligne of recipeRows) {
    try {
      recipes.push(
        assembleRecipeWithTags(
          ligne,
          parRecette.get(ligne.id) ?? [],
          étiquettesParRecette.get(ligne.id) ?? [],
        ),
      );
    } catch (erreur) {
      const code = erreur instanceof RecipeMappingError ? erreur.code : "unknown_mapping_error";
      invalid.push({
        recipeId: ligne.id,
        name: typeof ligne.name === "string" ? ligne.name : "",
        code,
        message: erreur instanceof Error ? erreur.message : String(erreur),
      });
    }
  }

  return { recipes, invalid };
}
