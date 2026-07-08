"use client";

import { useCallback, useEffect, useState } from "react";

import {
  getAllAppointments,
  getBookingSettings,
  getCoachAvailabilities,
  getCoachUnavailabilities,
} from "@/lib/supabase/appointments";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { AdminAppointment, BookingSettings, CoachAvailability, CoachUnavailability } from "@/types";

const EMPTY_SETTINGS: BookingSettings = { id: null, minLeadMinutes: 120, maxDaysAhead: 30, defaultDurationMinutes: 60 };

/**
 * Données calendrier complètes pour /admin/calendrier : tous les rendez-vous,
 * les disponibilités récurrentes, les indisponibilités et les réglages de
 * réservation. Même forme `loading/…/refetch` que useSupabasePrograms —
 * `appointments`/`availabilities`/`unavailabilities` restent des tableaux
 * vides tant que Supabase n'est pas configuré ou n'a encore aucune ligne
 * réelle (aucun mock calendrier n'existait avant ce chantier, voir audit).
 */
export function useSupabaseAppointments() {
  const [loading, setLoading] = useState(true);
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
  const [availabilities, setAvailabilities] = useState<CoachAvailability[]>([]);
  const [unavailabilities, setUnavailabilities] = useState<CoachUnavailability[]>([]);
  const [bookingSettings, setBookingSettings] = useState<BookingSettings>(EMPTY_SETTINGS);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setAppointments([]);
      setAvailabilities([]);
      setUnavailabilities([]);
      setBookingSettings(EMPTY_SETTINGS);
      setLoading(false);
      return;
    }
    const [appts, avail, unavail, settings] = await Promise.all([
      getAllAppointments(supabase),
      getCoachAvailabilities(supabase),
      getCoachUnavailabilities(supabase),
      getBookingSettings(supabase),
    ]);
    setAppointments(appts);
    setAvailabilities(avail);
    setUnavailabilities(unavail);
    setBookingSettings(settings);
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
      const [appts, avail, unavail, settings] = await Promise.all([
        getAllAppointments(supabase),
        getCoachAvailabilities(supabase),
        getCoachUnavailabilities(supabase),
        getBookingSettings(supabase),
      ]);
      if (!cancelled) {
        setAppointments(appts);
        setAvailabilities(avail);
        setUnavailabilities(unavail);
        setBookingSettings(settings);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, appointments, availabilities, unavailabilities, bookingSettings, refetch };
}
