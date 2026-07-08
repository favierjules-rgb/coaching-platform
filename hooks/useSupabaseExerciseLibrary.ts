"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getExerciseLibrary } from "@/lib/supabase/exercise-library";
import type { ExerciseLibraryItem } from "@/types";

/**
 * Banque d'exercices Supabase (`exercise_library`), même principe que
 * useSupabasePrograms : `loading` reste vrai le temps de la requête
 * initiale, `items` est un tableau vide tant que Supabase n'est pas
 * configuré, n'a encore aucun exercice réel, ou en cas d'erreur — dans tous
 * ces cas l'appelant retombe sur la banque mock (useAdminData). Contient
 * actifs et archivés : à filtrer par l'appelant selon le contexte (le
 * picker de /admin/programmes exclut les archivés, /admin/exercices les
 * affiche tous).
 */
export function useSupabaseExerciseLibrary() {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ExerciseLibraryItem[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setItems([]);
      setLoading(false);
      return;
    }
    const list = await getExerciseLibrary(supabase);
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
      const list = await getExerciseLibrary(supabase);
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
