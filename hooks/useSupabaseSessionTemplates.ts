"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getSessionTemplates } from "@/lib/supabase/session-templates";
import type { SessionTemplate } from "@/types";

/**
 * Banque de séances Supabase (`session_templates`), même principe que
 * useSupabaseExerciseLibrary : `loading` reste vrai le temps de la requête
 * initiale, `items` est un tableau vide tant que Supabase n'est pas
 * configuré ou n'a encore aucun modèle réel. `refetch` est appelé après
 * chaque création/suppression de modèle depuis le builder pour que la
 * liste reste à jour sans recharger la page.
 */
export function useSupabaseSessionTemplates() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<SessionTemplate[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setItems([]);
      setLoading(false);
      return;
    }
    const list = await getSessionTemplates(supabase);
    setItems(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const list = await getSessionTemplates(supabase);
      if (!cancelled) {
        setItems(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, items, refetch };
}
