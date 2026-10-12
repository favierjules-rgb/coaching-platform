"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Identifiant du coach propriétaire des recettes créées depuis cette session.
 *
 * `nutrition_recipes.coach_id` est NOT NULL : une recette appartient toujours
 * à un coach. On résout d'abord la fiche staff de l'appelant par
 * `public.current_staff_id()` (modèle P13-B, seule voie ouverte à un
 * collaborateur), puis, à défaut, le coach RATTACHÉ au compte connecté
 * (`coaches.user_id = auth.uid()`), et enfin le premier coach du cabinet —
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

      // P13-B : `current_staff_id()` est la SEULE voie pour un collaborateur.
      // Depuis la migration 20261011100000, la lecture de `coaches` est
      // réservée à l'administrateur : le `select` ci-dessous renvoie zéro
      // ligne pour un collaborateur, qui ne pourrait donc plus rien créer.
      // La fonction, elle, est SECURITY DEFINER et ne renvoie que SA fiche.
      //
      // Tant que les migrations P13-B ne sont pas appliquées, la fonction
      // n'existe pas : l'appel échoue, `data` reste vide et on retombe
      // exactement sur le comportement d'avant.
      const parFonction = await supabase.rpc("current_staff_id");
      const brut: unknown = Array.isArray(parFonction.data) ? parFonction.data[0] : parFonction.data;
      if (typeof brut === "string" && brut.length > 0) {
        if (!annule) {
          setCoachId(brut);
          setLoading(false);
        }
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
