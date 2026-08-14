/**
 * COURSES C1 — CHOISIR UNE RECETTE POUR UN CRÉNEAU.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN SCORE SIMPLE, DÉTERMINISTE, ET SANS APPRENTISSAGE
 * ────────────────────────────────────────────────────────────────────────────
 * Le §4 demande « une fonction de scoring simple et déterministe. Pas de ML ».
 * Deux exécutions sur les mêmes entrées doivent rendre exactement la même
 * liste — sans quoi un élève qui régénère verrait ses courses changer sans
 * raison, et aucun test ne serait stable.
 *
 * L'ordre des priorités est celui du §6, et il n'est pas négociable :
 * exclusions → envies → favoris → habitudes → générique.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ON NE CHOISIT PAS SUR LE NOM DE LA RECETTE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Une recette nommée « Bowl du sportif » peut contenir du poulet ; une
 * recette nommée « Poulet rôti » peut être la seule à n'en pas contenir après
 * substitution. Le score regarde donc les INGRÉDIENTS, pas le titre — c'est
 * l'exigence explicite du §4 (« ne pas choisir uniquement parce qu'un mot
 * apparaît dans le nom »).
 */

import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import {
  compterEnvies,
  correspond,
  estExclu,
  normaliserLibelle,
} from "@/lib/courses/preferences";

/** Poids du score. Nommés, pour que la hiérarchie du §6 se lise d'un coup. */
export const POIDS = {
  /** Une envie satisfaite domine tout le reste. */
  envie: 100,
  /** Un favori départage deux candidats déjà compatibles. */
  favori: 30,
  /** Une habitude départage quand rien d'autre ne le fait. */
  habitude: 10,
  /**
   * Pénalité de répétition, PLAFONNÉE — et le plafond est le cœur du §5.
   *
   * ⚠️ Sans plafond, un élève qui ne choisit QU'UNE envie verrait sa recette
   * préférée écartée au bout de trois jours au profit d'une autre qu'il n'a pas
   * demandée. Avec un plafond à trois répétitions (−60), une seule envie
   * satisfaite (+100) l'emporte toujours : la variété joue entre candidats
   * ÉGAUX, jamais contre une préférence explicite. C1-13 et C1-14 gardent les
   * deux moitiés de cette règle.
   */
  repetition: -20,
  repetitionMax: 3,
} as const;

/** Ce qu'on sait de l'élève au moment de choisir. */
export interface ContexteSelection {
  /** Envies normalisées, toutes catégories confondues. */
  readonly envies: readonly string[];
  readonly exclusions: readonly string[];
  /** Libellés des favoris (aliments et produits) — A5. */
  readonly favoris: readonly string[];
  /** Libellé → nombre de consommations récentes — A5.7. */
  readonly habitudes: Readonly<Record<string, number>>;
  /** Recette → nombre de fois déjà retenue dans CETTE génération. */
  readonly dejaChoisies: Readonly<Record<string, number>>;
}

export const CONTEXTE_VIDE: ContexteSelection = Object.freeze({
  envies: [],
  exclusions: [],
  favoris: [],
  habitudes: {},
  dejaChoisies: {},
});

export interface ScoreRecette {
  readonly recette: RecipeWithTags;
  readonly score: number;
  /** Le détail, conservé pour expliquer un choix — et pour le déboguer. */
  readonly envies: number;
  readonly favoris: number;
  readonly habitudes: number;
  readonly repetitions: number;
}

/**
 * Score d'une recette. `null` quand elle est ÉCARTÉE par une exclusion.
 *
 * `null` plutôt que `-Infinity` : une recette exclue n'est pas une mauvaise
 * candidate, elle n'est pas candidate du tout. Les deux se traitent
 * différemment quand il faut expliquer une liste vide.
 */
export function scorerRecette(
  recette: RecipeWithTags,
  ctx: ContexteSelection,
): ScoreRecette | null {
  const ingredients = recette.recipe.ingredients;

  // ⚠️ UNE SEULE EXCLUSION SUFFIT À ÉCARTER TOUTE LA RECETTE. On ne « retire
  // pas l'ingrédient » : les macros de la recette dépendent de tous ses
  // ingrédients, en retirer un donnerait un plat qui ne tient plus sa cible.
  for (const ing of ingredients) {
    if (estExclu(ing.name, ctx.exclusions)) return null;
  }

  let envies = 0;
  let favoris = 0;
  let habitudes = 0;
  for (const ing of ingredients) {
    envies += compterEnvies(ing.name, ctx.envies);
    if (ctx.favoris.some((f) => correspond(ing.name, f))) favoris += 1;
    const n = normaliserLibelle(ing.name);
    // L'habitude compte pour sa PRÉSENCE, pas pour son volume : un aliment
    // consommé quarante fois ne doit pas écraser une envie explicite.
    if ((ctx.habitudes[n] ?? 0) > 0) habitudes += 1;
  }

  const repetitions = Math.min(ctx.dejaChoisies[recette.recipe.id] ?? 0, POIDS.repetitionMax);

  return {
    recette,
    score:
      envies * POIDS.envie +
      favoris * POIDS.favori +
      habitudes * POIDS.habitude +
      repetitions * POIDS.repetition,
    envies,
    favoris,
    habitudes,
    repetitions,
  };
}

/**
 * Classe les candidates. Les exclues DISPARAISSENT de la liste.
 *
 * Départage déterministe : score, puis nom en français, puis identifiant —
 * la même convention que `recipesForSlot`, pour que deux recettes de score
 * égal sortent toujours dans le même ordre.
 */
export function classerRecettes(
  candidates: readonly RecipeWithTags[],
  ctx: ContexteSelection,
): readonly ScoreRecette[] {
  return candidates
    .map((r) => scorerRecette(r, ctx))
    .filter((s): s is ScoreRecette => s !== null)
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.recette.recipe.name.localeCompare(b.recette.recipe.name, "fr") ||
        a.recette.recipe.id.localeCompare(b.recette.recipe.id),
    );
}

/** La meilleure candidate, ou `null` si toutes sont exclues. */
export function choisirRecette(
  candidates: readonly RecipeWithTags[],
  ctx: ContexteSelection,
): ScoreRecette | null {
  return classerRecettes(candidates, ctx)[0] ?? null;
}
