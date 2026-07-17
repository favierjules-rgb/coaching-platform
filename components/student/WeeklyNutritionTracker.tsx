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
      <div className="mb-8 border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">Chargement du suivi de la semaine…</p>
      </div>
    );
  }

  const { calories } = adjustment;

  return (
    <div className="mb-8">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Suivi de la semaine</h2>

      <div
        className={`mb-6 border p-6 ${
          adjustment.overBudget ? "border-red-500/50 bg-red-500/5" : "border-border bg-card"
        }`}
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div>
            <div className="font-heading text-xl font-bold text-foreground">{formatKcal(calories.weeklyTarget)}</div>
            <div className="text-xs text-muted-foreground">Objectif semaine (kcal)</div>
          </div>
          <div>
            <div className="font-heading text-xl font-bold text-foreground">{formatKcal(calories.consumed)}</div>
            <div className="text-xs text-muted-foreground">Consommé cette semaine</div>
          </div>
          <div>
            <div className="font-heading text-xl font-bold text-foreground">
              {adjustment.overBudget ? "0" : formatKcal(calories.remaining)}
            </div>
            <div className="text-xs text-muted-foreground">Reste sur la semaine</div>
          </div>
          <div>
            <div className="font-heading text-xl font-bold text-foreground">
              {calories.adjustedDaily !== null ? `${formatKcal(calories.adjustedDaily)} kcal` : "—"}
            </div>
            <div className="text-xs text-muted-foreground">Objectif ajusté jours restants</div>
          </div>
        </div>

        {adjustment.overBudget && (
          <p className="mt-4 flex items-center gap-2 text-sm text-red-400">
            <AlertTriangle size={16} className="flex-shrink-0" />
            Objectif hebdomadaire déjà dépassé de {formatKcal(Math.abs(calories.remaining))} kcal.
          </p>
        )}
        {!adjustment.overBudget && adjustment.lowCalorieWarning && (
          <p className="mt-4 flex items-center gap-2 text-sm text-amber-400">
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
    <div className={`flex flex-col gap-3 border p-4 ${day.isToday ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-heading text-xs font-semibold uppercase tracking-widest ${
            day.isToday ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {day.label}
        </span>
        {day.filled && <span className="text-[10px] uppercase tracking-widest text-green-400">Rempli</span>}
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
          className="w-full border border-border bg-background px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none"
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
          className="w-full border border-border bg-background px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none"
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
          className="w-full border border-border bg-background px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none"
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
          className="w-full border border-border bg-background px-2 py-2 text-xs text-foreground placeholder:text-muted-foreground/50 transition-colors focus:border-primary focus:outline-none"
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
        className="w-full border border-border bg-background px-2 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none"
      />

      {error && <p className="text-xs text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="flex items-center justify-center gap-1.5 border border-primary py-2 text-[11px] uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
      >
        {saved ? (
          <>
            <CheckCircle size={12} />
            Enregistré
          </>
        ) : saving ? (
          "Enregistrement…"
        ) : (
          "Enregistrer"
        )}
      </button>
    </div>
  );
}
