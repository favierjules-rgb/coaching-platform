"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  readNutritionRecipe,
  readNutritionRecipes,
  type InvalidRecipe,
} from "@/lib/supabase/nutrition-recipes";
import { RECIPE_STATUSES, type RecipeWithTags } from "@/lib/nutrition/recipe-rows";

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
 */
export function useNutritionRecipes() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recipes, setRecipes] = useState<RecipeWithTags[]>([]);
  const [invalid, setInvalid] = useState<InvalidRecipe[]>([]);

  const charger = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setRecipes([]);
      setInvalid([]);
      setLoading(false);
      return;
    }
    try {
      const résultat = await readNutritionRecipes(supabase, { statuses: RECIPE_STATUSES });
      setRecipes([...résultat.recipes]);
      setInvalid([...résultat.invalid]);
      setError(null);
    } catch {
      setError("Le catalogue n'a pas pu être chargé. Vérifie ta connexion puis réessaie.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let annule = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setRecipes([]);
          setLoading(false);
        }
        return;
      }
      try {
        const résultat = await readNutritionRecipes(supabase, { statuses: RECIPE_STATUSES });
        if (!annule) {
          setRecipes([...résultat.recipes]);
          setInvalid([...résultat.invalid]);
          setError(null);
        }
      } catch {
        if (!annule) setError("Le catalogue n'a pas pu être chargé. Vérifie ta connexion puis réessaie.");
      } finally {
        if (!annule) setLoading(false);
      }
    }
    load();
    return () => {
      annule = true;
    };
  }, []);

  return { loading, error, recipes, invalid, refetch: charger };
}

/** Une recette précise, avec ses ingrédients et ses étiquettes. */
export function useNutritionRecipe(recipeId: string | null) {
  const [loading, setLoading] = useState(recipeId !== null);
  const [recipe, setRecipe] = useState<RecipeWithTags | null>(null);
  const [invalid, setInvalid] = useState<InvalidRecipe | null>(null);

  const charger = useCallback(async () => {
    if (!recipeId) {
      setRecipe(null);
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setRecipe(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const résultat = await readNutritionRecipe(supabase, recipeId);
    setRecipe(résultat.recipe);
    setInvalid(résultat.invalid);
    setLoading(false);
  }, [recipeId]);

  useEffect(() => {
    let annule = false;
    async function load() {
      if (!recipeId) {
        if (!annule) {
          setRecipe(null);
          setLoading(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setRecipe(null);
          setLoading(false);
        }
        return;
      }
      const résultat = await readNutritionRecipe(supabase, recipeId);
      if (!annule) {
        setRecipe(résultat.recipe);
        setInvalid(résultat.invalid);
        setLoading(false);
      }
    }
    load();
    return () => {
      annule = true;
    };
  }, [recipeId]);

  return { loading, recipe, invalid, refetch: charger };
}
