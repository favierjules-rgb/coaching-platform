"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getStudents } from "@/lib/supabase/students";
import type { AdminStudent } from "@/types";

/**
 * Liste des élèves Supabase pour /admin/eleves. `loading` reste vrai le
 * temps de la requête initiale (pour éviter un flash "aucun élève" avant
 * d'avoir la réponse) ; `students` est un tableau vide tant que Supabase
 * n'est pas configuré, n'a encore aucun élève, ou en cas d'erreur — dans
 * tous ces cas l'appelant (app/admin/eleves/page.tsx) retombe sur la liste
 * mock (useAdminData), comme demandé. `refetch` (chantier "invitation email
 * à la création d'un élève") permet de rafraîchir la liste juste après une
 * création réelle (POST /api/admin/students), sans recharger toute la page.
 */
export function useSupabaseStudents() {
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<AdminStudent[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setStudents([]);
      setLoading(false);
      return;
    }
    const list = await getStudents(supabase);
    setStudents(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setStudents([]);
          setLoading(false);
        }
        return;
      }
      const list = await getStudents(supabase);
      if (!cancelled) {
        setStudents(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, students, refetch };
}
