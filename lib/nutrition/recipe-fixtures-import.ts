import type { Recipe } from "@/lib/nutrition/recipe-types";
import {
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
} from "@/scripts/tests/fixtures/nutrition-recipes";
import { RECIPE_SLOT_KEYS, type RecipeSlotKey } from "@/lib/nutrition/recipe-rows";

/**
 * Import EXPLICITE des recettes de démonstration.
 *
 * CE QUE CE MODULE N'EST PAS. Ce n'est pas un référentiel alimentaire
 * partagé : chaque recette importée porte SES propres valeurs, comme toute
 * recette saisie à la main. Rien ici n'est réutilisé entre recettes.
 *
 * IDENTITÉ TECHNIQUE STABLE. Audit fait avant d'écrire : chaque fixture
 * possède déjà un identifiant stable (`Recipe.id` — `proto-13`, `derive-1g`…)
 * distinct de son nom affiché. On le préfixe pour former
 * `source_key = "fixture:<id>"`.
 *
 * Conséquences, toutes vérifiées par test :
 *   - un second import ne crée AUCUN doublon (index unique partiel
 *     `(coach_id, source_key)`) ;
 *   - une recette SAISIE À LA MAIN portant le même NOM qu'une fixture n'est
 *     jamais touchée : elle a `source_key = null`, donc elle ne peut pas
 *     être reconnue comme fixture. L'identité ne se déduit JAMAIS du nom ;
 *   - l'import passe par la MÊME RPC que l'interface normale — aucun chemin
 *     d'écriture parallèle.
 *
 * L'import n'est jamais automatique : il est déclenché par le staff, après
 * confirmation, depuis l'administration.
 */

export const FIXTURE_SOURCE_NAMESPACE = "fixture";

/**
 * Les 11 recettes de démonstration DISTINCTES, dans un ordre stable.
 *
 * ⚠️ `RECETTE_IMPOSSIBLE` est volontairement absente : le fichier de fixtures
 * la déclare comme un ALIAS de `RECETTE_MAXIMUM`
 * (`export const RECETTE_IMPOSSIBLE: Recipe = RECETTE_MAXIMUM`). L'importer
 * produirait deux fois la clé `fixture:proto-3`, donc un écrasement
 * silencieux. Vérifié par test : les `source_key` sont toutes distinctes.
 */
export const RECIPE_FIXTURES: readonly Recipe[] = [
  RECETTE_MINIMUM,
  RECETTE_MAXIMUM,
  RECETTE_OEUF,
  RECETTE_SIMPLE_PGL,
  RECETTE_FIXE_ET_UNITES,
  RECETTE_UNITE_ENTIERE,
  RECETTE_PANURE_LIEE,
  RECETTE_PROPORTIONNELLE,
  RECETTE_UN_GROUPE,
  RECETTE_DEUX_GROUPES,
  RECETTE_SINGULIERE,
];

/** `source_key` d'une fixture — déduite de sa clé technique, jamais de son nom. */
export function fixtureSourceKey(recipe: Recipe): string {
  return `${FIXTURE_SOURCE_NAMESPACE}:${recipe.id}`;
}

function slotDeFixture(recipe: Recipe): RecipeSlotKey | null {
  const slot = recipe.slot ?? null;
  if (slot === null) return null;
  return RECIPE_SLOT_KEYS.includes(slot as RecipeSlotKey) ? (slot as RecipeSlotKey) : null;
}

/**
 * Charge utile d'une fixture pour `save_nutrition_recipe`.
 *
 * `recipeId` : l'identifiant de la recette DÉJÀ importée lors d'un passage
 * précédent, ou `null` pour une création. C'est ce qui rend l'import
 * rejouable : au second lancement, on met à jour au lieu de dupliquer.
 *
 * `ingredientIds` : les identifiants à utiliser. Les fixtures portent des
 * identifiants lisibles (`poulet`, `riz`) qui ne sont PAS des UUID ; le
 * client en génère de vrais et conserve la correspondance, sans quoi
 * `linked_to_ingredient_id` ne pourrait pas être traduit.
 *
 * Le statut est TOUJOURS `draft` : une fixture importée est une base de
 * travail, pas une recette validée par le coach. L'activation reste une
 * décision humaine, arbitrée par la base.
 */
export function buildFixturePayload(
  recipe: Recipe,
  coachId: string,
  recipeId: string | null,
  ingredientIds: ReadonlyMap<string, string>,
): Record<string, unknown> {
  const traduire = (id: string | null | undefined): string | null =>
    id ? (ingredientIds.get(id) ?? null) : null;

  return {
    recipe: {
      id: recipeId,
      coach_id: coachId,
      name: recipe.name,
      description: null,
      slot_key: slotDeFixture(recipe),
      status: "draft",
      source_key: fixtureSourceKey(recipe),
    },
    ingredients: recipe.ingredients.map((ing, index) => ({
      id: ingredientIds.get(ing.id),
      position: index + 1,
      name: ing.name,
      role: ing.role,
      protein_per_100g: ing.proteinPer100g,
      carb_per_100g: ing.carbPer100g,
      fat_per_100g: ing.fatPer100g,
      reference_grams: ing.referenceGrams,
      min_grams: ing.minGrams ?? null,
      max_grams: ing.maxGrams ?? null,
      unit_scalable: ing.unitScalable === true,
      max_units: ing.unitScalable ? (ing.maxUnits ?? null) : null,
      unit_name: ing.unitScalable ? (ing.unitName ?? null) : null,
      fixed_label: ing.fixedLabel ?? null,
      egg: ing.egg === true,
      egg_grams: ing.egg ? (ing.eggGrams ?? null) : null,
      linked_to_ingredient_id: traduire(ing.linkedToIngredientId),
      link_ratio_bp: ing.linkedToIngredientId ? (ing.linkRatioBp ?? null) : null,
    })),
    // Les fixtures ne portent aucune étiquette : le vocabulaire contrôlé est
    // une décision de coach, pas une donnée du prototype. On n'en invente pas.
    tags: [],
  };
}

/** Correspondance identifiant de fixture → UUID, stable pour un import donné. */
export function buildIngredientIdMap(
  recipe: Recipe,
  generate: () => string,
  existing: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const map = new Map<string, string>();
  for (const ing of recipe.ingredients) {
    map.set(ing.id, existing.get(ing.id) ?? generate());
  }
  return map;
}

export type FixtureImportOutcome = "imported" | "updated" | "skipped" | "failed";

export interface FixtureImportEntry {
  readonly sourceKey: string;
  readonly name: string;
  readonly outcome: FixtureImportOutcome;
  readonly message: string | null;
}

export interface FixtureImportReport {
  readonly imported: number;
  readonly updated: number;
  readonly skipped: number;
  readonly failed: number;
  readonly entries: readonly FixtureImportEntry[];
}

/** Agrège les résultats d'un import — fonction pure, testable sans base. */
export function summarizeFixtureImport(
  entries: readonly FixtureImportEntry[],
): FixtureImportReport {
  return {
    imported: entries.filter((e) => e.outcome === "imported").length,
    updated: entries.filter((e) => e.outcome === "updated").length,
    skipped: entries.filter((e) => e.outcome === "skipped").length,
    failed: entries.filter((e) => e.outcome === "failed").length,
    entries,
  };
}

/** Phrase française du rapport d'import. */
export function describeFixtureImport(report: FixtureImportReport): string {
  const morceaux = [
    `${report.imported} importée${report.imported > 1 ? "s" : ""}`,
    `${report.updated} mise${report.updated > 1 ? "s" : ""} à jour`,
    `${report.skipped} ignorée${report.skipped > 1 ? "s" : ""}`,
    `${report.failed} en échec`,
  ];
  return morceaux.join(" · ");
}
