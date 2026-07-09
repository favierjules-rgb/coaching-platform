"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getStudentAppointmentStats,
  getStudentNutritionAnalytics,
  getStudentProgressSummary,
  getStudentRecentActivity,
  getStudentWeightProgress,
  getStudentWorkoutAnalytics,
  type StudentAppointmentStats,
  type StudentNutritionAnalytics,
  type StudentProgressSummary,
  type StudentWeightProgress,
  type StudentWorkoutAnalytics,
} from "@/lib/supabase/progress";
import type { ActivityEvent } from "@/types";

export interface SupabaseStudentProgressState {
  loading: boolean;
  summary: StudentProgressSummary | null;
  weight: StudentWeightProgress | null;
  workout: StudentWorkoutAnalytics | null;
  nutrition: StudentNutritionAnalytics | null;
  appointments: StudentAppointmentStats | null;
  activity: ActivityEvent[];
}

/**
 * Toutes les données de /admin/eleves/[studentId]/progression pour un
 * élève précis, chargées en parallèle (une fonction par section, voir
 * lib/supabase/progress.ts) — `loading` reste vrai le temps de la requête
 * initiale. Chaque section reste `null`/vide si Supabase n'a rien à
 * renvoyer (élève avec peu ou pas de données) : jamais d'exception, jamais
 * de donnée inventée pour combler les trous.
 */
export function useSupabaseStudentProgress(studentId: string | undefined): SupabaseStudentProgressState {
  const [state, setState] = useState<SupabaseStudentProgressState>({
    loading: true,
    summary: null,
    weight: null,
    workout: null,
    nutrition: null,
    appointments: null,
    activity: [],
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!studentId) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      const [summary, weight, workout, nutrition, appointments, activity] = await Promise.all([
        getStudentProgressSummary(supabase, studentId),
        getStudentWeightProgress(supabase, studentId),
        getStudentWorkoutAnalytics(supabase, studentId),
        getStudentNutritionAnalytics(supabase, studentId),
        getStudentAppointmentStats(supabase, studentId),
        getStudentRecentActivity(supabase, studentId),
      ]);
      if (!cancelled) {
        setState({ loading: false, summary, weight, workout, nutrition, appointments, activity });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  return state;
}
