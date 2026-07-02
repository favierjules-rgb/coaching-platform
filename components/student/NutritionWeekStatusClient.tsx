"use client";

import Link from "next/link";

import { DayStatusBadge } from "@/components/student/DayStatusBadge";
import { NutritionAdjustmentCard } from "@/components/student/NutritionAdjustmentCard";
import { computeAdjustment } from "@/lib/nutrition";
import { useNutritionTracking } from "@/hooks/useNutritionTracking";
import type { NutritionPlan } from "@/types";

interface NutritionWeekStatusClientProps {
  studentId: string;
  activePlan: NutritionPlan;
}

/**
 * Partie interactive de /nutrition (carte d'ajustement + statuts des
 * jours) : lit le même état de suivi partagé (hook useNutritionTracking,
 * localStorage) que /nutrition/[planId], pour que les journées validées
 * restent cohérentes entre les deux pages et après un rechargement.
 */
export function NutritionWeekStatusClient({
  studentId,
  activePlan,
}: NutritionWeekStatusClientProps) {
  const { days } = useNutritionTracking(activePlan);
  const adjustment = computeAdjustment(studentId, activePlan, days);

  return (
    <>
      <div className="mb-8">
        <NutritionAdjustmentCard adjustment={adjustment} />
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Jours de la semaine
          </h2>
          <Link
            href={`/nutrition/${activePlan.id}`}
            className="text-xs uppercase tracking-wide text-primary hover:underline"
          >
            Voir le plan
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {days.map((day) => (
            <div
              key={day.id}
              className={`flex flex-col gap-2 border p-4 ${
                day.isToday ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              <span
                className={`font-heading text-xs font-semibold uppercase tracking-widest ${
                  day.isToday ? "text-primary" : "text-muted-foreground"
                }`}
              >
                {day.day}
              </span>
              <DayStatusBadge status={day.status} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
