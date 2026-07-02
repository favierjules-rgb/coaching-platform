"use client";

import { useMemo, useState } from "react";

import { DailyMacroForm } from "@/components/student/DailyMacroForm";
import { NutritionAdjustmentCard } from "@/components/student/NutritionAdjustmentCard";
import { NutritionWeekDayCard } from "@/components/student/NutritionWeekDayCard";
import { PlannedMealCard } from "@/components/student/PlannedMealCard";
import { computeAdjustment } from "@/lib/nutrition";
import type { ActualDailyIntake, NutritionDay, NutritionPlan } from "@/types";

interface NutritionPlanWorkspaceProps {
  studentId: string;
  plan: NutritionPlan;
  initialDays: NutritionDay[];
}

export function NutritionPlanWorkspace({
  studentId,
  plan,
  initialDays,
}: NutritionPlanWorkspaceProps) {
  const [days, setDays] = useState(initialDays);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(
    days.find((day) => day.isToday)?.id ?? days[0]?.id ?? null,
  );

  const adjustment = useMemo(
    () => computeAdjustment(studentId, plan, days),
    [studentId, plan, days],
  );

  const selectedDay = days.find((day) => day.id === selectedDayId) ?? null;

  function handleValidate(dayId: string, actual: ActualDailyIntake) {
    setDays((prev) =>
      prev.map((day) =>
        day.id === dayId ? { ...day, status: "valide", actual } : day,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <NutritionAdjustmentCard adjustment={adjustment} />

      <div>
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Calendrier de la semaine
        </h2>
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
              key={selectedDay.id}
              day={selectedDay}
              studentId={studentId}
              planId={plan.id}
              onValidate={(actual) => handleValidate(selectedDay.id, actual)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
