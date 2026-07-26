"use client";

import { useCallback, useEffect, useState } from "react";

import { getAppointmentsInRange, getCoachEventsInRange } from "@/lib/supabase/appointments";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AdminAppointment, CoachUnavailability } from "@/types";

/**
 * Données du calendrier admin pour la PÉRIODE AFFICHÉE uniquement
 * (directive "admin-apple-calendar" §11 : jamais tout l'historique).
 * Rechargées à chaque changement de plage (navigation/vue) et via refetch()
 * après une mutation.
 */
export function useAdminCalendarRange() {
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
  const [coachEvents, setCoachEvents] = useState<CoachUnavailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const onRangeChange = useCallback((start: Date, end: Date) => {
    setRange((current) => {
      if (current && current.start.getTime() === start.getTime() && current.end.getTime() === end.getTime()) {
        return current;
      }
      return { start, end };
    });
  }, []);

  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!range) return;
    let cancelled = false;

    async function load() {
      if (!range) return;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setLoading(false);
          setError("Connexion à la base indisponible.");
        }
        return;
      }
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
      try {
        const [appts, events] = await Promise.all([
          getAppointmentsInRange(supabase, range.start, range.end),
          getCoachEventsInRange(supabase, range.start, range.end),
        ]);
        if (!cancelled) {
          setAppointments(appts);
          setCoachEvents(events);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setError("Impossible de charger le calendrier. Vérifie ta connexion.");
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [range, reloadKey]);

  return { appointments, coachEvents, loading, error, onRangeChange, refetch };
}
