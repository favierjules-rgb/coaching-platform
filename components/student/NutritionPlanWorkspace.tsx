"use client";

import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";

import { DailyMacroForm } from "@/components/student/DailyMacroForm";
import { NutritionAdjustmentCard } from "@/components/student/NutritionAdjustmentCard";
import { NutritionWeekDayCard } from "@/components/student/NutritionWeekDayCard";
import { PlannedMealCard } from "@/components/student/PlannedMealCard";
import { computeAdjustment } from "@/lib/nutrition";
import { useNutritionTracking } from "@/hooks/useNutritionTracking";
import type { NutritionPlan } from "@/types";

interface NutritionPlanWorkspaceProps {
  studentId: string;
  plan: NutritionPlan;
}

export function NutritionPlanWorkspace({
  studentId,
  plan,
}: NutritionPlanWorkspaceProps) {
  const { days, validateDay, resetWeek } = useNutritionTracking(plan);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(
    plan.days.find((day) => day.isToday)?.id ?? plan.days[0]?.id ?? null,
  );

  const adjustment = useMemo(
    () => computeAdjustment(studentId, plan, days),
    [studentId, plan, days],
  );

  const selectedDay = days.find((day) => day.id === selectedDayId) ?? null;

  return (
    <div className="flex flex-col gap-8">
      <NutritionAdjustmentCard adjustment={adjustment} />

      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Calendrier de la semaine
          </h2>
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  "Réinitialiser la semaine ? Toutes les journées validées de ce plan repasseront à leur état mocké initial.",
                )
              ) {
                resetWeek();
              }
            }}
            className="flex items-center gap-2 border border-border px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <RotateCcw size={14} />
            Réinitialiser la semaine
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {days.map((day) => (
            <NutritionWeekDayCard
              key={day.id}
              day={day}
              selected={day.id === selectedDayId}
              onSelect={() => setSelectedDayId(day.id)}
            />
          ))}
        </div>
      </div>

      {selectedDay && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div>
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Plan prévu — {selectedDay.day}
            </h2>
            <div className="flex flex-col gap-3">
              {selectedDay.meals.map((meal) => (
                <PlannedMealCard key={meal.id} meal={meal} />
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Ma saisie — {selectedDay.day}
            </h2>
            <DailyMacroForm
              key={`${selectedDay.id}-${selectedDay.actual?.validatedAt ?? "empty"}`}
              day={selectedDay}
              studentId={studentId}
              planId={plan.id}
              onValidate={(actual) => validateDay(selectedDay.id, actual)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
