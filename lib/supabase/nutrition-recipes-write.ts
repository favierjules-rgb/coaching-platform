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
 * Change le SEUL statut d'une recette : publier, dépublier, archiver,
 * restaurer.
 *
 * CHARGE UTILE MINIMALE, à dessein. Le contrat de `save_nutrition_recipe`
 * (migration 20260809090000) est explicite : une clé absente n'est pas
 * touchée. En n'envoyant ni `ingredients` ni `tags`, on obtient la garantie
 * qu'un changement de statut ne peut PAS abîmer la recette — pas un
 * ingrédient déplacé, pas une étiquette perdue, même si l'écran affichait une
 * version périmée.
 *
 * ARCHIVER N'EST PAS SUPPRIMER : la recette reste en base, intégralement, et
 * `restaurer` la ramène en brouillon. La suppression définitive a son propre
 * chemin — `deleteNutritionRecipe`, dans lib/supabase/nutrition-lifecycle.ts.
 *
 * L'ACTIVATION reste soumise à la validation de la base : demander `active`
 * sur une recette incomplète est refusé côté serveur (`not_activable`), pas
 * ici.
 */
export async function setNutritionRecipeStatus(
  supabase: TypedSupabaseClient,
  recipeId: string,
  status: RecipeStatus,
): Promise<RecipeWriteResult> {
  // Ni propriétaire, ni contenu : `{id, status}` et rien d'autre. La base
  // conserve le coach de la ligne existante — il n'y a plus de paramètre à
  // fournir, donc plus rien à se tromper.
  return saveNutritionRecipe(supabase, { recipe: { id: recipeId, status } });
}

/* ──────────────────── Duplication et import — côté SERVEUR ──────────────────── */

type NomRpcCatalogue = "duplicate_nutrition_recipe" | "import_nutrition_recipes";

function boundCatalogRpc(supabase: TypedSupabaseClient) {
  return (
    supabase.rpc as unknown as (
      fn: NomRpcCatalogue,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
}

export interface DuplicateRecipeSuccess {
  readonly ok: true;
  readonly recipeId: string;
  readonly name: string;
  readonly copied: { readonly ingredients: number; readonly links: number; readonly tags: number };
}
export interface DuplicateRecipeFailure {
  readonly ok: false;
  readonly reason: "forbidden" | "not_found" | "unknown";
  readonly message: string;
}
export type DuplicateRecipeResult = DuplicateRecipeSuccess | DuplicateRecipeFailure;

const REFUS_DUPLICATION: DuplicateRecipeFailure = {
  ok: false,
  reason: "unknown",
  message: "La duplication a échoué. Rien n'a été créé — réessaie.",
};

/** Traduit le retour de `duplicate_nutrition_recipe`. Fonction PURE. */
export function parseDuplicateRecipeResult(data: unknown): DuplicateRecipeResult {
  const ligne = (data ?? {}) as Record<string, unknown>;
  if (ligne.ok === true && typeof ligne.recipe_id === "string") {
    const copié = (ligne.copied ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" && v >= 0 ? Math.trunc(v) : 0);
    return {
      ok: true,
      recipeId: ligne.recipe_id,
      name: typeof ligne.name === "string" ? ligne.name : "",
      copied: { ingredients: n(copié.ingredients), links: n(copié.links), tags: n(copié.tags) },
    };
  }
  if (ligne.reason === "forbidden") {
    return { ok: false, reason: "forbidden", message: "Cette recette ne t'appartient pas." };
  }
  if (ligne.reason === "not_found") {
    return {
      ok: false,
      reason: "not_found",
      message: "Cette recette est introuvable : elle a peut-être été supprimée. Recharge la page.",
    };
  }
  return REFUS_DUPLICATION;
}

/**
 * Duplique une recette. Le navigateur n'envoie QUE l'identifiant de la
 * source : ni le propriétaire, ni le statut, ni le contenu — la base lit tout
 * sur la source et impose « brouillon ». C'est ce qui rend impossible de créer
 * une recette dans le catalogue d'un autre coach.
 */
export async function duplicateNutritionRecipe(
  supabase: TypedSupabaseClient,
  recipeId: string,
): Promise<DuplicateRecipeResult> {
  const { data, error } = await boundCatalogRpc(supabase)("duplicate_nutrition_recipe", {
    p_recipe_id: recipeId,
  });
  if (error) return REFUS_DUPLICATION;
  return parseDuplicateRecipeResult(data);
}

export interface ImportRecipesSuccess {
  readonly ok: true;
  readonly count: number;
  readonly ingredients: number;
  readonly created: readonly { readonly recipeId: string; readonly name: string }[];
}
export interface ImportRecipesFailure {
  readonly ok: false;
  readonly message: string;
}
export type ImportRecipesResult = ImportRecipesSuccess | ImportRecipesFailure;

/** Traduit le retour de `import_nutrition_recipes`. Fonction PURE. */
export function parseImportRecipesResult(data: unknown): ImportRecipesResult {
  const ligne = (data ?? {}) as Record<string, unknown>;
  if (ligne.ok !== true) {
    return {
      ok: false,
      message:
        ligne.reason === "forbidden"
          ? "Tu n'as pas les droits nécessaires pour importer des recettes."
          : "L'import a échoué. AUCUNE recette n'a été créée.",
    };
  }
  const créées = Array.isArray(ligne.created) ? ligne.created : [];
  return {
    ok: true,
    count: typeof ligne.count === "number" ? ligne.count : créées.length,
    ingredients: typeof ligne.ingredients === "number" ? ligne.ingredients : 0,
    created: créées
      .map((c) => (c ?? {}) as Record<string, unknown>)
      .filter((c) => typeof c.recipe_id === "string")
      .map((c) => ({ recipeId: c.recipe_id as string, name: String(c.name ?? "") })),
  };
}

/**
 * Importe un LOT de recettes en UNE transaction.
 *
 * AUCUN `coach_id` n'est transmis : la RPC le détermine elle-même
 * (`current_coach_id()`), et ignore purement un `coach_id` qui traînerait dans
 * la charge utile. Le statut « brouillon » est imposé côté base, pas ici.
 *
 * Un échec n'écrit RIEN : la fonction plpgsql est une transaction, et la
 * moindre exception annule le lot entier. Le message le dit explicitement,
 * pour qu'un coach ne parte pas chercher ce qui serait passé.
 */
export async function importNutritionRecipes(
  supabase: TypedSupabaseClient,
  payload: { recipes: unknown[] },
): Promise<ImportRecipesResult> {
  if (payload.recipes.length === 0) {
    return { ok: true, count: 0, ingredients: 0, created: [] };
  }
  const { data, error } = await boundCatalogRpc(supabase)("import_nutrition_recipes", {
    p_payload: payload,
  });
  if (error) {
    return {
      ok: false,
      message: `L'import a échoué, AUCUNE recette n'a été créée : ${error.message}`,
    };
  }
  return parseImportRecipesResult(data);
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
  const { data: existantes, error: erreurLecture } = await supabase
    .from("nutrition_recipes")
    .select("id, source_key")
    .eq("coach_id", coachId)
    .in("source_key", clés);

  // Sans cette lecture, on ne SAIT PAS ce qui est déjà importé. Continuer
  // traiterait chaque fixture déjà présente comme une création : l'index
  // unique partiel les rejetterait une par une, et le rapport annoncerait
  // « 11 en échec » là où la réalité est « je n'ai pas pu vérifier ». On
  // s'arrête donc, avec la vraie cause.
  if (erreurLecture) {
    return summarizeFixtureImport(
      RECIPE_FIXTURES.map((fixture) => ({
        sourceKey: fixtureSourceKey(fixture),
        name: fixture.name,
        outcome: "failed" as const,
        message:
          "Impossible de vérifier les recettes déjà importées : rien n'a été écrit. Réessaie.",
      })),
    );
  }

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
