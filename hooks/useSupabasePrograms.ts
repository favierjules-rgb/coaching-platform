"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getPrograms } from "@/lib/supabase/programs";
import type { AdminProgram } from "@/types";

/**
 * Liste des programmes Supabase pour /admin/programmes, même principe que
 * useSupabaseStudents : `loading` reste vrai le temps de la requête
 * initiale, `programs` est un tableau vide tant que Supabase n'est pas
 * configuré, n'a encore aucun programme réel, ou en cas d'erreur — dans
 * tous ces cas l'appelant retombe sur la liste mock (useAdminData).
 * `refetch` permet de rafraîchir après une création/édition/assignation.
 */
export function useSupabasePrograms() {
  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<AdminProgram[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPrograms([]);
      setLoading(false);
      return;
    }
    const list = await getPrograms(supabase);
    setPrograms(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setPrograms([]);
          setLoading(false);
        }
        return;
      }
      const list = await getPrograms(supabase);
      if (!cancelled) {
        setPrograms(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, programs, refetch };
}
