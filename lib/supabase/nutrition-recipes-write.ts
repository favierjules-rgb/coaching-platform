import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RECIPE_FIXTURES,
  buildFixturePayload,
  buildIngredientIdMap,
  fixtureSourceKey,
  summarizeFixtureImport,
  type FixtureImportEntry,
  type FixtureImportReport,
} from "@/lib/nutrition/recipe-fixtures-import";
import { describeBlockingIssue } from "@/lib/nutrition/recipe-labels";
import type { RecipeStatus } from "@/lib/nutrition/recipe-rows";
import type { Database } from "@/types/supabase";

/**
 * ÉCRITURE des recettes — un seul chemin, une seule transaction.
 *
 * POURQUOI UNE RPC. Une recette, c'est une ligne principale, N ingrédients et
 * M étiquettes. `supabase-js` n'offre pas de transaction multi-requêtes :
 * enchaîner `insert()/update()/delete()` depuis le navigateur laisserait des
 * recettes à moitié écrites au premier réseau instable. Tout passe donc par
 * `save_nutrition_recipe` (migration 20260808090000).
 *
 * AUCUN ENCHAÎNEMENT CLIENT pour la sauvegarde principale : un appel, une
 * transaction. L'import de fixtures fait N appels — mais chacun est une
 * transaction complète et indépendante, et un échec sur l'une n'abîme pas les
 * autres. C'est un lot, pas une transaction unique, et le rapport le dit.
 *
 * AUCUNE QUANTITÉ CALCULÉE. Ce module ne connaît ni `RecipeSolution` ni
 * `SolvedIngredient` : une portion adaptée n'a aucun chemin vers la base.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export type RecipeWriteErrorCode =
  | "not_authorized"
  | "recipe_not_found"
  | "not_activable"
  | "ingredient_from_another_recipe"
  | "invalid_payload"
  | "duplicate_source_key"
  | "unknown";

export type RecipeWriteResult =
  | {
      readonly ok: true;
      readonly recipeId: string;
      readonly status: RecipeStatus;
      readonly sourceKey: string | null;
      readonly ingredientCount: number;
      readonly tagCount: number;
      /** Code de blocage résiduel — `null` si la recette est exploitable. */
      readonly blockingIssue: string | null;
    }
  | { readonly ok: false; readonly code: RecipeWriteErrorCode; readonly message: string };

const MESSAGES_FR: Record<RecipeWriteErrorCode, string> = {
  not_authorized: "Tu n'as pas les droits nécessaires pour modifier une recette.",
  recipe_not_found: "Cette recette est introuvable : elle a peut-être été supprimée.",
  not_activable: "Cette recette ne peut pas être activée en l'état.",
  ingredient_from_another_recipe:
    "Un ingrédient de cette recette appartient à une autre recette. Recharge la page puis réessaie.",
  invalid_payload: "La recette envoyée est incomplète ou mal formée.",
  duplicate_source_key: "Une recette portant déjà cette clé d'import existe.",
  unknown: "L'enregistrement a échoué. Ta saisie est conservée — réessaie.",
};

/**
 * Traduit une erreur PostgreSQL en code + message français.
 *
 * Fonction PURE, seul endroit où la forme des messages de la RPC est
 * interprétée. `RECIPE_NOT_ACTIVABLE` porte le code de blocage rendu par
 * `nutrition_recipe_blocking_issue` : on le rend lisible plutôt que de
 * l'afficher brut.
 */
export function describeRecipeWriteError(raw: string | null | undefined): {
  code: RecipeWriteErrorCode;
  message: string;
} {
  const texte = raw ?? "";
  if (texte.includes("NOT_AUTHORIZED")) {
    return { code: "not_authorized", message: MESSAGES_FR.not_authorized };
  }
  if (texte.includes("RECIPE_NOT_ACTIVABLE")) {
    const code = texte.split("RECIPE_NOT_ACTIVABLE:")[1]?.trim().split(/\s/)[0] ?? "";
    const détail = describeBlockingIssue(code);
    return {
      code: "not_activable",
      message: détail ? `Activation impossible : ${détail}` : MESSAGES_FR.not_activable,
    };
  }
  if (texte.includes("INGREDIENT_FROM_ANOTHER_RECIPE")) {
    return { code: "ingredient_from_another_recipe", message: MESSAGES_FR.ingredient_from_another_recipe };
  }
  if (texte.includes("RECIPE_NOT_FOUND")) {
    return { code: "recipe_not_found", message: MESSAGES_FR.recipe_not_found };
  }
  if (texte.includes("nutrition_recipes_source_key_unique")) {
    return { code: "duplicate_source_key", message: MESSAGES_FR.duplicate_source_key };
  }
  if (
    texte.includes("INVALID_PAYLOAD") ||
    texte.includes("INVALID_ROLE") ||
    texte.includes("INVALID_STATUS") ||
    texte.includes("INVALID_INGREDIENT") ||
    texte.includes("DUPLICATE_INGREDIENT_ID")
  ) {
    return { code: "invalid_payload", message: MESSAGES_FR.invalid_payload };
  }
  return { code: "unknown", message: MESSAGES_FR.unknown };
}

interface RpcShape {
  recipe?: { id?: string; status?: string; source_key?: string | null };
  ingredient_count?: number;
  tag_count?: number;
  blocking_issue?: string | null;
}

/** Lit le retour canonique de la RPC. Fonction PURE, sans supposition. */
export function parseRecipeWriteResult(data: unknown): RecipeWriteResult {
  const shape = (data ?? {}) as RpcShape;
  const id = shape.recipe?.id;
  const status = shape.recipe?.status;
  if (typeof id !== "string" || typeof status !== "string") {
    return { ok: false, code: "unknown", message: MESSAGES_FR.unknown };
  }
  return {
    ok: true,
    recipeId: id,
    status: status as RecipeStatus,
    sourceKey: shape.recipe?.source_key ?? null,
    ingredientCount: typeof shape.ingredient_count === "number" ? shape.ingredient_count : 0,
    tagCount: typeof shape.tag_count === "number" ? shape.tag_count : 0,
    blockingIssue: shape.blocking_issue ?? null,
  };
}

// La RPC n'est pas déclarée dans les types générés — même contournement que
// lib/supabase/nutrition-v2.ts et nutrition-assignment.ts. `.bind(supabase)`
// est OBLIGATOIRE : `SupabaseClient.rpc` s'appuie sur `this`.
function boundRpc(supabase: TypedSupabaseClient) {
  return (
    supabase.rpc as unknown as (
      fn: "save_nutrition_recipe",
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
}

/**
 * Enregistre une recette ET ses enfants en UNE transaction.
 *
 * Un refus d'activation annule tout : l'ancienne version reste intacte,
 * ingrédients et étiquettes compris. L'appelant garde son formulaire — rien
 * n'est vidé, rien n'est rechargé de force.
 */
export async function saveNutritionRecipe(
  supabase: TypedSupabaseClient,
  payload: Record<string, unknown>,
): Promise<RecipeWriteResult> {
  const { data, error } = await boundRpc(supabase)("save_nutrition_recipe", { p_payload: payload });
  if (error) {
    return { ok: false, ...describeRecipeWriteError(error.message) };
  }
  return parseRecipeWriteResult(data);
}

/**
 * Archive une recette. C'est un STATUT, jamais une suppression : la PR B ne
 * livre aucun chemin de suppression définitive, et les données restent en
 * base. Passe par la même RPC — donc mêmes garanties.
 */
export async function archiveNutritionRecipe(
  supabase: TypedSupabaseClient,
  payload: Record<string, unknown>,
): Promise<RecipeWriteResult> {
  const recette = (payload.recipe ?? {}) as Record<string, unknown>;
  return saveNutritionRecipe(supabase, {
    ...payload,
    recipe: { ...recette, status: "archived" },
  });
}

/* ─────────────────────────── Import des fixtures ─────────────────────────── */

export interface FixtureImportOptions {
  /** `true` = met à jour une fixture déjà importée. Par défaut : on l'ignore. */
  readonly updateExisting?: boolean;
  /** Injectable pour les tests — sinon `crypto.randomUUID`. */
  readonly generateId?: () => string;
}

/**
 * Import EXPLICITE des 11 recettes de démonstration.
 *
 * JAMAIS AUTOMATIQUE. Cette fonction n'est appelée que depuis un bouton, après
 * confirmation. Aucun chargement de page ne la déclenche, et la migration ne
 * l'exécute pas.
 *
 * REJOUABLE SANS DOUBLON. L'identité vient de `source_key`
 * (`fixture:<cle_technique>`), jamais du nom affiché : une recette saisie à la
 * main portant le même nom qu'une fixture n'est donc jamais touchée.
 *
 * Chaque fixture est une transaction indépendante : un échec sur l'une
 * n'annule pas les autres, et le rapport distingue importées, mises à jour,
 * ignorées et en échec.
 */
export async function importNutritionRecipeFixtures(
  supabase: TypedSupabaseClient,
  coachId: string,
  options: FixtureImportOptions = {},
): Promise<FixtureImportReport> {
  const generate = options.generateId ?? (() => globalThis.crypto.randomUUID());
  const updateExisting = options.updateExisting ?? false;

  // UNE requête pour connaître ce qui est déjà importé — pas une par fixture.
  const clés = RECIPE_FIXTURES.map(fixtureSourceKey);
  const { data: existantes } = await supabase
    .from("nutrition_recipes")
    .select("id, source_key")
    .eq("coach_id", coachId)
    .in("source_key", clés);

  const parClé = new Map<string, string>();
  for (const ligne of (existantes ?? []) as { id: string; source_key: string | null }[]) {
    if (ligne.source_key) parClé.set(ligne.source_key, ligne.id);
  }

  const entries: FixtureImportEntry[] = [];

  for (const fixture of RECIPE_FIXTURES) {
    const sourceKey = fixtureSourceKey(fixture);
    const existante = parClé.get(sourceKey) ?? null;

    if (existante && !updateExisting) {
      entries.push({
        sourceKey, name: fixture.name, outcome: "skipped",
        message: "Déjà importée — laissée telle quelle.",
      });
      continue;
    }

    const ids = buildIngredientIdMap(fixture, generate);
    const résultat = await saveNutritionRecipe(
      supabase,
      buildFixturePayload(fixture, coachId, existante, ids),
    );

    if (résultat.ok) {
      entries.push({
        sourceKey, name: fixture.name,
        outcome: existante ? "updated" : "imported",
        message: null,
      });
    } else {
      entries.push({ sourceKey, name: fixture.name, outcome: "failed", message: résultat.message });
    }
  }

  return summarizeFixtureImport(entries);
}
