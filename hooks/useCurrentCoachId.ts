"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Identifiant du coach propriétaire des recettes créées depuis cette session.
 *
 * `nutrition_recipes.coach_id` est NOT NULL : une recette appartient toujours
 * à un coach. On résout d'abord le coach RATTACHÉ au compte connecté
 * (`coaches.user_id = auth.uid()`), et à défaut le premier coach du cabinet —
 * même repli que `lib/supabase/appointments.ts`, la plateforme étant
 * mono-cabinet.
 *
 * `null` tant que la résolution n'a pas abouti : les pages désactivent alors
 * l'enregistrement plutôt que d'envoyer un `coach_id` inventé.
 */
export function useCurrentCoachId() {
  const [loading, setLoading] = useState(true);
  const [coachId, setCoachId] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;

    async function charger() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!annule) setLoading(false);
        return;
      }

      const { data: session } = await supabase.auth.getUser();
      const userId = session?.user?.id ?? null;

      if (userId) {
        const { data } = await supabase
          .from("coaches")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();
        if (data?.id) {
          if (!annule) {
            setCoachId(data.id);
            setLoading(false);
          }
          return;
        }
      }

      // Repli mono-cabinet : le premier coach enregistré.
      const { data: premier } = await supabase
        .from("coaches")
        .select("id")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!annule) {
        setCoachId(premier?.id ?? null);
        setLoading(false);
      }
    }

    charger();
    return () => {
      annule = true;
    };
  }, []);

  return { loading, coachId };
}
