"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readNutritionPlanV2Week } from "@/lib/supabase/nutrition-week";
import { readNutritionRecipes } from "@/lib/supabase/nutrition-recipes";

/**
 * Le plan v2 d'un élève, ET la bibliothèque de recettes qu'il a le droit de
 * consulter.
 *
 * LA SÉCURITÉ N'EST PAS ICI. `readNutritionRecipes` demande simplement les
 * recettes `active` ; c'est la RLS (migration 20260813090000) qui ne rend que
 * celles du coach du plan assigné. Filtrer côté client en plus donnerait
 * l'illusion trompeuse que le client protège quelque chose — il ne fait que
 * demander.
 *
 * TROIS ÉTATS DISTINCTS, jamais confondus :
 *   - `loading` : premier chargement ;
 *   - `error`   : la lecture a échoué — un réseau coupé ne doit PLUS se
 *     présenter comme « aucun plan attribué », le défaut de l'écran actuel ;
 *   - données vides : il n'y a réellement rien.
 *
 * `loading` ne repasse jamais à vrai : `refetch` recharge en silence, sans
 * démonter l'écran ni perdre la sélection jour / créneau / recette.
 */
export function useStudentNutritionPlanV2(planId: string | null) {
  const [loading, setLoading] = useState(planId !== null);
  const [error, setError] = useState<string | null>(null);
  const [week, setWeek] = useState<PlanV2Week | null>(null);
  const [recipes, setRecipes] = useState<readonly RecipeWithTags[]>([]);

  const requête = useRef(0);

  const appliquer = useCallback(
    (
      numéro: number,
      résultat: { week: PlanV2Week | null; recipes: readonly RecipeWithTags[] } | null,
    ) => {
      if (requête.current !== numéro) return;
      if (résultat === null) {
        setError("Le plan n'a pas pu être chargé. Vérifie ta connexion puis réessaie.");
      } else {
        setWeek(résultat.week);
        setRecipes(résultat.recipes);
        setError(null);
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    let annulé = false;
    const numéro = ++requête.current;
    void lire(planId).then((résultat) => {
      if (!annulé) appliquer(numéro, résultat);
    });
    return () => {
      annulé = true;
    };
  }, [planId, appliquer]);

  const refetch = useCallback(async () => {
    const numéro = ++requête.current;
    appliquer(numéro, await lire(planId));
  }, [planId, appliquer]);

  return { loading, error, week, recipes, refetch };
}

/** Lecture pure, sans état React. `null` = échec, à distinguer du vide. */
async function lire(
  planId: string | null,
): Promise<{ week: PlanV2Week | null; recipes: readonly RecipeWithTags[] } | null> {
  if (!planId) return { week: null, recipes: [] };
  const supabase = createSupabaseBrowserClient();
  if (!supabase) return { week: null, recipes: [] };
  try {
    // Les deux lectures sont indépendantes : elles partent ensemble.
    const [week, catalogue] = await Promise.all([
      readNutritionPlanV2Week(supabase, planId),
      readNutritionRecipes(supabase, { statuses: ["active"] }),
    ]);
    return { week, recipes: catalogue.recipes };
  } catch {
    return null;
  }
}
