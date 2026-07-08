"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getNutritionPlans } from "@/lib/supabase/nutrition";
import type { AdminNutritionPlan } from "@/types";

/**
 * Liste des plans alimentaires Supabase pour /admin/nutrition, même
 * principe que useSupabasePrograms : `loading` reste vrai le temps de la
 * requête initiale, `plans` est un tableau vide tant que Supabase n'est pas
 * configuré, n'a encore aucun plan réel, ou en cas d'erreur — dans tous ces
 * cas l'appelant retombe sur la liste mock (useAdminData). `refetch` permet
 * de rafraîchir après une création/édition/assignation.
 */
export function useSupabaseNutritionPlans() {
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<AdminNutritionPlan[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPlans([]);
      setLoading(false);
      return;
    }
    const list = await getNutritionPlans(supabase);
    setPlans(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setPlans([]);
          setLoading(false);
        }
        return;
      }
      const list = await getNutritionPlans(supabase);
      if (!cancelled) {
        setPlans(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, plans, refetch };
}
