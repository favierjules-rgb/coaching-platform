"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  computeWeeklyNutritionAdjustment,
  getCurrentWeekDates,
  type DailyNutritionLog,
  type NutritionDailyTarget,
  type WeeklyNutritionAdjustment,
} from "@/lib/nutrition-weekly";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getNutritionLogsForDates, upsertNutritionDailyLog } from "@/lib/supabase/nutrition-logs";

export interface DailyLogInput {
  logDate: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  note: string;
}

/**
 * Suivi hebdomadaire nutrition d'un élève pour un plan donné (semaine
 * calendaire courante, lundi -> dimanche). Réutilisé côté élève (/nutrition,
 * avec sauvegarde) et côté admin (/admin/eleves/[studentId], lecture seule
 * du résumé) — `saveDay` reste disponible dans les deux cas mais n'est
 * simplement pas appelée côté admin.
 */
export function useSupabaseNutritionWeek(
  studentId: string | null,
  planId: string | null,
  target: NutritionDailyTarget | null,
) {
  const [logs, setLogs] = useState<DailyNutritionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const weekDates = useMemo(() => getCurrentWeekDates(), []);

  const refetch = useCallback(async () => {
    if (!studentId || !planId) {
      setLogs([]);
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setLogs([]);
      setLoading(false);
      return;
    }
    const rows = await getNutritionLogsForDates(supabase, studentId, planId, weekDates);
    setLogs(rows);
    setLoading(false);
  }, [studentId, planId, weekDates]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!studentId || !planId) {
        if (!cancelled) {
          setLogs([]);
          setLoading(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setLogs([]);
          setLoading(false);
        }
        return;
      }
      const rows = await getNutritionLogsForDates(supabase, studentId, planId, weekDates);
      if (!cancelled) {
        setLogs(rows);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [studentId, planId, weekDates]);

  const saveDay = useCallback(
    async (log: DailyLogInput): Promise<boolean> => {
      if (!studentId || !planId) {
        return false;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        return false;
      }
      const ok = await upsertNutritionDailyLog(supabase, studentId, planId, log);
      if (ok) {
        await refetch();
      }
      return ok;
    },
    [studentId, planId, refetch],
  );

  const adjustment: WeeklyNutritionAdjustment | null = useMemo(
    () => (target ? computeWeeklyNutritionAdjustment(target, logs, weekDates) : null),
    [target, logs, weekDates],
  );

  return { loading, logs, weekDates, adjustment, saveDay, refetch };
}
