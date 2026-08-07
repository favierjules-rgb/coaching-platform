"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  readNutritionLifecycleOverview,
  type NutritionLifecycleOverview,
  type PlanLifecycleInfo,
  type RecipeLifecycleInfo,
} from "@/lib/supabase/nutrition-lifecycle";

const VIDE: NutritionLifecycleOverview = { plans: new Map(), recipes: new Map() };

/**
 * L'aperçu du cycle de vie : statut, date d'archivage, dépendances comptées
 * et motif de blocage, pour tous les plans et toutes les recettes visibles.
 *
 * UNE SEULE REQUÊTE, quel que soit le nombre de ressources : c'est la raison
 * d'être de la RPC `nutrition_lifecycle_overview`. Interroger la base par
 * ligne depuis une liste de vingt plans en ferait vingt.
 *
 * ABSENT ≠ SUPPRIMABLE. Tant que l'aperçu n'est pas chargé, ou si la lecture
 * échoue, `planInfo`/`recipeInfo` rendent `null` — et les écrans traitent ce
 * `null` comme « on ne sait pas », donc comme non supprimable. Un incident
 * réseau ne doit jamais ouvrir un bouton de suppression.
 */
export function useNutritionLifecycle() {
  const [overview, setOverview] = useState<NutritionLifecycleOverview>(VIDE);
  const [loading, setLoading] = useState(true);

  const charger = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setOverview(VIDE);
      setLoading(false);
      return;
    }
    setOverview(await readNutritionLifecycleOverview(supabase));
    setLoading(false);
  }, []);

  useEffect(() => {
    let annulé = false;
    void (async () => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annulé) setLoading(false);
        return;
      }
      const résultat = await readNutritionLifecycleOverview(supabase);
      if (!annulé) {
        setOverview(résultat);
        setLoading(false);
      }
    })();
    return () => {
      annulé = true;
    };
  }, []);

  const planInfo = useCallback(
    (planId: string): PlanLifecycleInfo | null => overview.plans.get(planId) ?? null,
    [overview],
  );
  const recipeInfo = useCallback(
    (recipeId: string): RecipeLifecycleInfo | null => overview.recipes.get(recipeId) ?? null,
    [overview],
  );

  return { loading, overview, planInfo, recipeInfo, refetch: charger };
}
