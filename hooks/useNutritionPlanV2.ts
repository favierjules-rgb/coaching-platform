"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readNutritionPlanV2 } from "@/lib/supabase/nutrition-v2";
import type { NutritionPlanV2 } from "@/lib/nutrition/plan-v2-validation";

/**
 * Lecture CANONIQUE d'un plan v2 : plan + profil `default` + six créneaux.
 *
 * `readNutritionPlanV2` fait exactement TROIS requêtes groupées, quel que
 * soit le nombre de profils ou de créneaux (plan, profils par `plan_id`,
 * créneaux par `profile_id` avec un `in(...)`) — aucun N+1.
 *
 * `plan` vaut `null` tant que le chargement n'est pas terminé, et reste
 * `null` si le plan n'est pas en v2 : aucune conversion au chargement.
 */
export function useNutritionPlanV2(planId: string | null, enabled: boolean) {
  const [loading, setLoading] = useState(enabled);
  const [plan, setPlan] = useState<NutritionPlanV2 | null>(null);

  const refetch = useCallback(async () => {
    if (!planId || !enabled) {
      setPlan(null);
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPlan(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const canonique = await readNutritionPlanV2(supabase, planId);
    setPlan(canonique);
    setLoading(false);
  }, [planId, enabled]);

  useEffect(() => {
    let annule = false;
    async function charger() {
      if (!planId || !enabled) {
        if (!annule) {
          setPlan(null);
          setLoading(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) {
          setPlan(null);
          setLoading(false);
        }
        return;
      }
      const canonique = await readNutritionPlanV2(supabase, planId);
      if (!annule) {
        setPlan(canonique);
        setLoading(false);
      }
    }
    charger();
    return () => {
      annule = true;
    };
  }, [planId, enabled]);

  return { loading, plan, refetch };
}
