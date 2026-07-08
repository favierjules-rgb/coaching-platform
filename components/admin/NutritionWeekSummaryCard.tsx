"use client";

import { useEffect, useState } from "react";

import { useSupabaseNutritionWeek } from "@/hooks/useSupabaseNutritionWeek";
import type { DailyNutritionLog, NutritionDailyTarget } from "@/lib/nutrition-weekly";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getLatestNutritionLog } from "@/lib/supabase/nutrition-logs";

interface NutritionWeekSummaryCardProps {
  studentId: string;
  planId: string;
  target: NutritionDailyTarget;
}

function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("fr-FR");
}

/**
 * Résumé lecture seule du suivi nutrition hebdomadaire pour
 * /admin/eleves/[studentId] — même calcul que WeeklyNutritionTracker côté
 * élève (useSupabaseNutritionWeek), sans formulaire de saisie. Pas
 * d'éditeur admin complet pour cette étape, comme demandé.
 */
export function NutritionWeekSummaryCard({ studentId, planId, target }: NutritionWeekSummaryCardProps) {
  const { loading, adjustment } = useSupabaseNutritionWeek(studentId, planId, target);
  const [latestLog, setLatestLog] = useState<DailyNutritionLog | null>(null);
  const [latestLoaded, setLatestLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setLatestLoaded(true);
        return;
      }
      const log = await getLatestNutritionLog(supabase, studentId);
      if (!cancelled) {
        setLatestLog(log);
        setLatestLoaded(true);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  if (loading || !adjustment) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const { calories } = adjustment;
  const varianceSoFar = calories.consumed - target.calories * adjustment.daysFilled;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Objectif semaine</span>
          <span className="font-heading text-lg font-bold text-foreground">{formatKcal(calories.weeklyTarget)} kcal</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Consommé cette semaine</span>
          <span className="font-heading text-lg font-bold text-foreground">{formatKcal(calories.consumed)} kcal</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Écart</span>
          <span className={`font-heading text-lg font-bold ${varianceSoFar > 0 ? "text-amber-400" : varianceSoFar < 0 ? "text-primary" : "text-foreground"}`}>
            {varianceSoFar > 0 ? "+" : ""}
            {formatKcal(varianceSoFar)} kcal
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Jours remplis</span>
          <span className="font-heading text-lg font-bold text-foreground">{adjustment.daysFilled} / 7</span>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <span className="block text-xs uppercase tracking-wide text-muted-foreground">Dernier log nutrition</span>
        {!latestLoaded ? (
          <span className="text-sm text-muted-foreground">Chargement…</span>
        ) : latestLog ? (
          <span className="text-sm text-foreground">
            {new Date(latestLog.logDate).toLocaleDateString("fr-FR")} · {latestLog.calories ?? "—"} kcal
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Aucun log enregistré.</span>
        )}
      </div>
    </div>
  );
}
