"use client";

import { useEffect, useState } from "react";

import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getStudentAppointmentStats,
  getStudentNutritionAnalytics,
  getStudentProgressPhotos,
  getStudentProgressSummary,
  getStudentWeightProgress,
  getStudentWorkoutAnalytics,
  type StudentAppointmentStats,
  type StudentNutritionAnalytics,
  type StudentProgressSummary,
  type StudentWeightProgress,
  type StudentWorkoutAnalytics,
} from "@/lib/supabase/progress";
import type { ProgressPhoto } from "@/types";

export interface SupabaseMyProgressState {
  ready: boolean;
  active: boolean;
  studentId: string | null;
  summary: StudentProgressSummary | null;
  weight: StudentWeightProgress | null;
  workout: StudentWorkoutAnalytics | null;
  nutrition: StudentNutritionAnalytics | null;
  appointments: StudentAppointmentStats | null;
  photos: ProgressPhoto[];
}

/**
 * Données de progression de l'élève connecté, pour /progression — même
 * forme `ready/active` que useSupabaseStudentDocuments : `active` ne vaut
 * `true` que si un compte élève Supabase est réellement identifié (jamais
 * les données d'un autre élève, jamais de repli mock). Ne charge pas
 * `activity_events` (staff-only en lecture, voir RLS activity_events) ni de
 * champ admin-only — l'élève voit un sous-ensemble des données affichées
 * côté coach.
 */
export function useSupabaseMyProgress(): SupabaseMyProgressState {
  const [state, setState] = useState<SupabaseMyProgressState>({
    ready: false,
    active: false,
    studentId: null,
    summary: null,
    weight: null,
    workout: null,
    nutrition: null,
    appointments: null,
    photos: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setState((prev) => ({ ...prev, ready: true }));
        return;
      }
      const studentId = await getCurrentStudentId(supabase);
      if (!studentId) {
        if (!cancelled) setState((prev) => ({ ...prev, ready: true }));
        return;
      }
      const [summary, weight, workout, nutrition, appointments, photos] = await Promise.all([
        getStudentProgressSummary(supabase, studentId),
        getStudentWeightProgress(supabase, studentId),
        getStudentWorkoutAnalytics(supabase, studentId),
        getStudentNutritionAnalytics(supabase, studentId),
        getStudentAppointmentStats(supabase, studentId),
        getStudentProgressPhotos(supabase, studentId),
      ]);
      if (!cancelled) {
        setState({ ready: true, active: true, studentId, summary, weight, workout, nutrition, appointments, photos });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
