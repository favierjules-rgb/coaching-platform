"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getProgramsSummary } from "@/lib/supabase/programs";
import type { AdminProgramSummary } from "@/types";

/**
 * LES PROGRAMMES POUR UNE LISTE — la version légère de `useSupabasePrograms`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN SECOND HOOK PLUTÔT QU'UNE OPTION
 * ════════════════════════════════════════════════════════════════════════
 * Un drapeau `{ leger: true }` sur le hook existant aurait rendu le MÊME type
 * dans les deux cas, et c'est précisément ce qu'il faut éviter : une page
 * n'aurait eu aucun moyen — ni au type, ni à l'exécution — de savoir si les
 * exercices qu'elle lit ont été chargés. Deux hooks, deux types, aucune
 * ambiguïté possible.
 *
 * ⚠️ MÊME CONTRAT DE CHARGEMENT que `useSupabasePrograms` : `loading` vrai
 * pendant la requête initiale, tableau vide si Supabase n'est pas configuré
 * ou en cas d'erreur. Les pages qui l'utilisent gardent donc la garde posée
 * par `fix(admin): prevent mock data flash during loading` — aucune donnée de
 * démonstration ne revient.
 *
 * ⚠️ `refetch` NE REMET PAS `loading` À VRAI, volontairement et à l'identique
 * du hook complet : une relecture après assignation ne doit pas vider l'écran
 * que l'utilisateur est en train de lire.
 */
export function useSupabaseProgramsSummary() {
  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<AdminProgramSummary[]>([]);

  const refetch = useCallback(async (): Promise<AdminProgramSummary[]> => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPrograms([]);
      setLoading(false);
      return [];
    }
    const list = await getProgramsSummary(supabase);
    setPrograms(list);
    setLoading(false);
    return list;
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
      const list = await getProgramsSummary(supabase);
      if (!cancelled) {
        setPrograms(list);
        setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, programs, refetch };
}
