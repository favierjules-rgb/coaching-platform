"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  readNutritionRecipe,
  readNutritionRecipes,
  type InvalidRecipe,
} from "@/lib/supabase/nutrition-recipes";
import { RECIPE_STATUSES, type RecipeWithTags } from "@/lib/nutrition/recipe-rows";

/**
 * Lecture du catalogue — sans le moindre état React : cette fonction rend le
 * résultat, elle n'écrit rien. Le montage initial ET `refetch` l'appellent,
 * ce qui supprime les deux copies divergentes de la version précédente (l'une
 * réinitialisait `invalid`, l'autre non ; l'une repassait par `loading`,
 * l'autre non).
 *
 * `null` = échec de lecture.
 */
async function lireCatalogue(): Promise<{
  recipes: readonly RecipeWithTags[];
  invalid: readonly InvalidRecipe[];
} | null> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { recipes: [], invalid: [] };
  try {
    return await readNutritionRecipes(supabase, { statuses: RECIPE_STATUSES });
  } catch {
    return null;
  }
}

/** Lecture d'une recette. Sans identifiant ou sans client : rien à lire. */
async function lireRecette(
  recipeId: string | null,
): Promise<{ recipe: RecipeWithTags | null; invalid: InvalidRecipe | null }> {
  if (!recipeId) return { recipe: null, invalid: null };
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { recipe: null, invalid: null };
  return readNutritionRecipe(supabase, recipeId);
}

/**
 * Catalogue des recettes pour l'administration.
 *
 * TOUS LES STATUTS. La lecture de la PR A ne charge que les recettes `active`
 * par défaut — c'est le bon comportement pour une proposition à un élève.
 * L'administration, elle, doit voir brouillons et archives : on passe donc
 * explicitement les trois statuts.
 *
 * Trois requêtes groupées quelle que soit la taille du catalogue : aucun N+1.
 *
 * `invalid` n'est jamais masqué. Une recette illisible apparaît dans le
 * catalogue avec sa raison, plutôt que de disparaître sans explication.
 *
 * `loading` NE REPASSE JAMAIS À VRAI. Il décrit le PREMIER chargement, rien
 * d'autre. Un rechargement après sauvegarde ne doit pas démonter le formulaire
 * en cours d'édition — sinon l'aperçu se referme et la cible saisie est perdue
 * à chaque enregistrement.
 */
export function useNutritionRecipes() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeWithTags[]>([]);
  const [invalid, setInvalid] = useState<InvalidRecipe[]>([]);

  // Numéro de la requête en cours : une réponse arrivée dans le désordre est
  // ignorée, quelle qu'en soit la cause.
  const requête = useRef(0);

  const appliquer = useCallback(
    (numéro: number, résultat: Awaited<ReturnType<typeof lireCatalogue>>) => {
      if (requête.current !== numéro) return;
      if (résultat === null) {
        setError("Le catalogue n'a pas pu être chargé. Vérifie ta connexion puis réessaie.");
      } else {
        setRecipes([...résultat.recipes]);
        setInvalid([...résultat.invalid]);
        setError(null);
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    let annulé = false;
    const numéro = ++requête.current;
    void lireCatalogue().then((résultat) => {
      if (!annulé) appliquer(numéro, résultat);
    });
    return () => {
      annulé = true;
    };
  }, [appliquer]);

  const refetch = useCallback(async () => {
    const numéro = ++requête.current;
    appliquer(numéro, await lireCatalogue());
  }, [appliquer]);

  return { loading, error, recipes, invalid, refetch };
}

/**
 * Une recette précise, avec ses ingrédients et ses étiquettes.
 *
 * Mêmes garanties que ci-dessus : une seule lecture partagée, et un `refetch`
 * qui ne repasse pas par l'état « chargement », donc qui ne démonte pas le
 * formulaire en cours d'édition.
 */
export function useNutritionRecipe(recipeId: string | null) {
  const [loading, setLoading] = useState(recipeId !== null);
  const [recipe, setRecipe] = useState<RecipeWithTags | null>(null);
  const [invalid, setInvalid] = useState<InvalidRecipe | null>(null);

  const requête = useRef(0);

  const appliquer = useCallback(
    (numéro: number, résultat: Awaited<ReturnType<typeof lireRecette>>) => {
      if (requête.current !== numéro) return;
      setRecipe(résultat.recipe);
      setInvalid(résultat.invalid);
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    let annulé = false;
    const numéro = ++requête.current;
    void lireRecette(recipeId).then((résultat) => {
      if (!annulé) appliquer(numéro, résultat);
    });
    return () => {
      annulé = true;
    };
  }, [recipeId, appliquer]);

  const refetch = useCallback(async () => {
    const numéro = ++requête.current;
    appliquer(numéro, await lireRecette(recipeId));
  }, [recipeId, appliquer]);

  return { loading, recipe, invalid, refetch };
}
