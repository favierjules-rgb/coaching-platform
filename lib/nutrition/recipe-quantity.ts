import { NBSP } from "@/lib/nutrition/basis-points";
import type { SolvedIngredient } from "@/lib/nutrition/recipe-solver";

/**
 * Formatage de la quantité RÉSOLUE d'un ingrédient.
 *
 * Extrait de `components/admin/RecipeAdaptivePreview.tsx`, qui en était le
 * seul propriétaire : l'écran élève en a besoin du mot pour mot, et deux
 * copies auraient divergé au premier ajustement. Le composant admin importe
 * désormais cette fonction.
 *
 * Rendus possibles, dans l'ordre de priorité :
 *   - le libellé d'unité calculé par le solveur — « 2 wraps (120 g) » ;
 *   - le nombre d'œufs — « 3 œufs » ;
 *   - le libellé fixe d'un ingrédient non ajustable — « à volonté » ;
 *   - les grammes — « 120 g ».
 *
 * `displayGrams` est utilisé, jamais `grams` : le solveur documente que les
 * grammes bruts servent au calcul et les grammes d'affichage à l'affichage.
 */
export function formatSolvedIngredientQuantity(ing: SolvedIngredient): string {
  if (ing.unitLabel) return ing.unitLabel;
  if (ing.eggCount !== null) return `${ing.eggCount} œuf${ing.eggCount > 1 ? "s" : ""}`;
  return `${ing.displayGrams}${NBSP}g`;
}
