"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getDocuments } from "@/lib/supabase/documents";
import type { AdminDocument } from "@/types";

/**
 * Liste des documents Supabase pour /admin/documents — même principe que
 * useSupabaseNutritionPlans : `loading` reste vrai le temps de la requête
 * initiale, `documents` est un tableau vide tant que Supabase n'est pas
 * configuré ou en cas d'erreur. `refetch` rafraîchit après création/édition/
 * assignation.
 */
export function useSupabaseDocuments() {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    const list = await getDocuments(supabase);
    setDocuments(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setDocuments([]);
          setLoading(false);
        }
        return;
      }
      const list = await getDocuments(supabase);
      if (!cancelled) {
        setDocuments(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, documents, refetch };
}
