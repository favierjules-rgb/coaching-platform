"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle } from "lucide-react";

import { VarianceChip } from "@/components/student/VarianceChip";
import { useSupabaseNutritionWeek } from "@/hooks/useSupabaseNutritionWeek";
import type { NutritionDailyTarget, WeekDayAdjustment } from "@/lib/nutrition-weekly";

interface WeeklyNutritionTrackerProps {
  studentId: string;
  planId: string;
  target: NutritionDailyTarget;
}

function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("fr-FR");
}

/**
 * "Suivi de la semaine" côté élève : redistribue l'objectif hebdomadaire du
 * plan actif Supabase sur les jours restants dès qu'un jour est rempli.
 * Remplace l'ancien outil mock (useNutritionTracking/computeAdjustment,
 * localStorage) resté branché uniquement sur le repli mock — voir
 * app/(student)/nutrition/page.tsx.
 */
export function WeeklyNutritionTracker({ studentId, planId, target }: WeeklyNutritionTrackerProps) {
  const { loading, adjustment, saveDay } = useSupabaseNutritionWeek(studentId, planId, target);

  if (loading || !adjustment) {
    return (
      <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
        <p className="text-sm text-muted-foreground">Chargement du suivi de la semaine…</p>
      </div>
    );
  }

  const { calories } = adjustment;

  return (
    <div className="mb-8">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Suivi de la semaine</h2>

      <div
        className={`mb-6 rounded-card border p-6 shadow-soft ${
          adjustment.overBudget ? "border-destructive/40 bg-destructive/5" : "border-border bg-card"
        }`}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <div className="font-heading text-2xl font-bold leading-none text-foreground">{formatKcal(calories.weeklyTarget)}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Objectif semaine (kcal)</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-heading text-2xl font-bold leading-none text-foreground">{formatKcal(calories.consumed)}</div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Consommé cette semaine</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-heading text-2xl font-bold leading-none text-foreground">
              {adjustment.overBudget ? "0" : formatKcal(calories.remaining)}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Reste sur la semaine</div>
          </div>
          <div className="flex flex-col gap-1">
            <div className="font-heading text-2xl font-bold leading-none text-foreground">
              {calories.adjustedDaily !== null ? `${formatKcal(calories.adjustedDaily)} kcal` : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Objectif ajusté jours restants</div>
          </div>
        </div>

        {adjustment.overBudget && (
          <p className="mt-5 flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle size={16} className="flex-shrink-0" />
            Objectif hebdomadaire déjà dépassé de {formatKcal(Math.abs(calories.remaining))} kcal.
          </p>
        )}
        {!adjustment.overBudget && adjustment.lowCalorieWarning && (
          <p className="mt-5 flex items-center gap-2 text-sm text-warning">
            <AlertTriangle size={16} className="flex-shrink-0" />
            L&apos;objectif ajusté sur les jours restants est très bas — reste attentif, ce n&apos;est qu&apos;une
            recommandation.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {adjustment.days.map((day) => (
          <WeeklyNutritionDayCard key={day.date} day={day} onSave={saveDay} />
        ))}
      </div>
    </div>
  );
}

function WeeklyNutritionDayCard({
  day,
  onSave,
}: {
  day: WeekDayAdjustment;
  onSave: ReturnType<typeof useSupabaseNutritionWeek>["saveDay"];
}) {
  const [calories, setCalories] = useState(day.log?.calories !== null && day.log?.calories !== undefined ? String(day.log.calories) : "");
  const [protein, setProtein] = useState(day.log?.proteinG !== null && day.log?.proteinG !== undefined ? String(day.log.proteinG) : "");
  const [carbs, setCarbs] = useState(day.log?.carbsG !== null && day.log?.carbsG !== undefined ? String(day.log.carbsG) : "");
  const [fat, setFat] = useState(day.log?.fatG !== null && day.log?.fatG !== undefined ? String(day.log.fatG) : "");
  const [note, setNote] = useState(day.log?.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    if (calories.trim() === "") {
      setError("Renseigne au moins les calories pour enregistrer cette journée.");
      setSaved(false);
      return;
    }
    setError(null);
    setSaving(true);
    const ok = await onSave({
      logDate: day.date,
      calories: Number(calories),
      proteinG: protein.trim() === "" ? null : Number(protein),
      carbsG: carbs.trim() === "" ? null : Number(carbs),
      fatG: fat.trim() === "" ? null : Number(fat),
      note,
    });
    setSaving(false);
    if (ok) {
      setSaved(true);
    } else {
      setError("Échec de l'enregistrement. Réessaie.");
    }
  }

  return (
    <div className={`flex flex-col gap-3 rounded-panel border p-4 ${day.isToday ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-heading text-xs font-semibold uppercase tracking-widest ${
            day.isToday ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {day.label}
        </span>
        {day.filled && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest text-success/80">
            <CheckCircle size={11} className="flex-shrink-0" />
            Rempli
          </span>
        )}
      </div>

      <div className="text-xs text-muted-foreground">
        {day.filled ? "Objectif" : "Objectif ajusté"} :{" "}
        <span className="text-foreground">
          {day.targetCalories !== null ? `${day.targetCalories} kcal` : "objectif dépassé"}
        </span>
      </div>

      {day.filled && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Réel : <span className="text-foreground">{day.log?.calories} kcal</span>
          <VarianceChip deltaKcal={day.varianceCalories} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          min={0}
          value={calories}
          onChange={(e) => {
            setCalories(e.target.value);
            setSaved(false);
          }}
          placeholder={day.targetCalories !== null ? `${day.targetCalories}kcal` : "Kcal"}
          aria-label={`Calories réelles — ${day.label}`}
          className="w-full rounded-control border border-border bg-surface-soft px-2.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
        <input
          type="number"
          min={0}
          value={protein}
          onChange={(e) => {
            setProtein(e.target.value);
            setSaved(false);
          }}
          placeholder={day.targetProtein !== null ? `${day.targetProtein}g` : "Prot (g)"}
          aria-label={`Protéines réelles — ${day.label}`}
          className="w-full rounded-control border border-border bg-surface-soft px-2.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
        <input
          type="number"
          min={0}
          value={carbs}
          onChange={(e) => {
            setCarbs(e.target.value);
            setSaved(false);
          }}
          placeholder={day.targetCarbs !== null ? `${day.targetCarbs}g` : "Gluc (g)"}
          aria-label={`Glucides réels — ${day.label}`}
          className="w-full rounded-control border border-border bg-surface-soft px-2.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
        <input
          type="number"
          min={0}
          value={fat}
          onChange={(e) => {
            setFat(e.target.value);
            setSaved(false);
          }}
          placeholder={day.targetFat !== null ? `${day.targetFat}g` : "Lip (g)"}
          aria-label={`Lipides réels — ${day.label}`}
          className="w-full rounded-control border border-border bg-surface-soft px-2.5 py-2.5 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
        />
      </div>

      <input
        value={note}
        onChange={(e) => {
          setNote(e.target.value);
          setSaved(false);
        }}
        placeholder="Note du jour (optionnel)"
        aria-label={`Note — ${day.label}`}
        className="w-full rounded-control border border-border bg-surface-soft px-2.5 py-2.5 text-xs text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
      />

      {error && <p className="text-xs text-destructive">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="pressable flex min-h-[44px] items-center justify-center gap-1.5 rounded-control border border-primary py-2.5 text-[11px] uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
      >
        {saved ? (
          <span className="animate-fade-in flex items-center gap-1.5">
            <CheckCircle size={12} className="text-success" />
            Enregistré
          </span>
        ) : saving ? (
          "Enregistrement…"
        ) : (
          "Enregistrer"
        )}
      </button>
    </div>
  );
}
