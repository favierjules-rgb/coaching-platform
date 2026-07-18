"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { ensureSelfCoachRow, getCoaches } from "@/lib/supabase/coaches";
import type { AdminCoach } from "@/types";

/**
 * Liste réelle des collaborateurs admin/coach (table Supabase `coaches`)
 * pour /admin/parametres — remplace l'ancienne liste mockée (localStorage,
 * useAdminData). `currentUserId` (auth.users.id du compte connecté, pas
 * l'id de la ligne `coaches`) permet à la page d'empêcher un coach de se
 * supprimer lui-même. `refetch` sert après une création/suppression réelle
 * (POST/DELETE /api/admin/coaches), sans recharger toute la page — même
 * principe que useSupabaseStudents.
 */
export function useSupabaseCoaches() {
  const [loading, setLoading] = useState(true);
  const [coaches, setCoaches] = useState<AdminCoach[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setCoaches([]);
      setLoading(false);
      return;
    }
    await ensureSelfCoachRow(supabase);
    const list = await getCoaches(supabase);
    setCoaches(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setCoaches([]);
          setLoading(false);
        }
        return;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) setCurrentUserId(user?.id ?? null);

      await ensureSelfCoachRow(supabase);
      const list = await getCoaches(supabase);
      if (!cancelled) {
        setCoaches(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, coaches, currentUserId, refetch };
}
