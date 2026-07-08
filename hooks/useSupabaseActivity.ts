"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getRecentActivityEvents, markActivityEventRead } from "@/lib/supabase/activity";
import type { ActivityEvent } from "@/types";

/**
 * Centre d'activité admin (`activity_events`, toutes les actions élève
 * suivies) — même forme `loading/…/refetch` que les autres hooks admin.
 * `events` reste un tableau vide tant que Supabase n'est pas configuré ou
 * n'a encore aucune activité réelle (aucun mock équivalent, voir
 * docs/supabase-activity-notifications-model.md).
 */
export function useSupabaseActivity() {
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setEvents([]);
      setLoading(false);
      return;
    }
    const list = await getRecentActivityEvents(supabase);
    setEvents(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }
      const list = await getRecentActivityEvents(supabase);
      if (!cancelled) {
        setEvents(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const markRead = useCallback(
    async (id: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      await markActivityEventRead(supabase, id);
      await refetch();
    },
    [refetch],
  );

  return { loading, events, refetch, markRead };
}
