"use client";

import { useCallback, useEffect, useState } from "react";

import { getCurrentStudentProfile } from "@/lib/supabase/current-student";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getAppointmentsForStudent, getAvailableSlots } from "@/lib/supabase/appointments";
import type { AdminAppointment, AvailableSlot } from "@/types";

/**
 * Rendez-vous et créneaux disponibles pour l'élève connecté — même forme
 * `ready/active/…` que useSupabaseStudentDocuments : `ready` passe à `true`
 * une fois la vérification terminée, `active` ne vaut `true` que si un
 * compte élève Supabase est réellement identifié. Aucun mock calendrier
 * équivalent n'existait avant ce chantier (voir audit), donc pas de repli
 * détaillé côté données — seulement un état "non configuré" neutre côté UI
 * quand `active` est faux.
 */
export function useSupabaseAppointmentsForStudent() {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [studentFirstName, setStudentFirstName] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [appointments, setAppointments] = useState<AdminAppointment[]>([]);
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setReady(true);
      return;
    }
    const student = await getCurrentStudentProfile(supabase);
    if (!student) {
      setReady(true);
      return;
    }
    const [appts, slots] = await Promise.all([getAppointmentsForStudent(supabase, student.id), getAvailableSlots(supabase)]);
    setStudentId(student.id);
    setStudentFirstName(student.firstName);
    setStudentEmail(student.email);
    setAppointments(appts);
    setAvailableSlots(slots);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const student = await getCurrentStudentProfile(supabase);
      if (!student) {
        if (!cancelled) setReady(true);
        return;
      }
      const [appts, slots] = await Promise.all([getAppointmentsForStudent(supabase, student.id), getAvailableSlots(supabase)]);
      if (!cancelled) {
        setStudentId(student.id);
        setStudentFirstName(student.firstName);
        setStudentEmail(student.email);
        setAppointments(appts);
        setAvailableSlots(slots);
        setReady(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ready,
    active: ready && studentId !== null,
    studentId,
    studentFirstName,
    studentEmail,
    appointments,
    availableSlots,
    refetch,
  };
}
