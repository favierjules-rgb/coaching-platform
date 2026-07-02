import Link from "next/link";
import { Droplet, Lightbulb, Pill } from "lucide-react";

import { DayStatusBadge } from "@/components/student/DayStatusBadge";
import { NutritionAdjustmentCard } from "@/components/student/NutritionAdjustmentCard";
import { NutritionPlanCard } from "@/components/student/NutritionPlanCard";
import { computeAdjustment } from "@/lib/nutrition";
import {
  activeNutritionPlan,
  hydrationAndSupplements,
  nutritionPlans,
  student,
} from "@/data/student";

export default function NutritionPage() {
  const adjustment = computeAdjustment(
    student.id,
    activeNutritionPlan,
    activeNutritionPlan.days,
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Nutrition
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan actif : {activeNutritionPlan.name} ·{" "}
          {activeNutritionPlan.dailyTarget.calories} kcal/jour ·{" "}
          {activeNutritionPlan.weeklyTargetCalories.toLocaleString("fr-FR")}{" "}
          kcal/semaine
        </p>
      </div>

      <div className="mb-8">
        <NutritionAdjustmentCard adjustment={adjustment} />
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Jours de la semaine
          </h2>
          <Link
            href={`/nutrition/${activeNutritionPlan.id}`}
            className="text-xs uppercase tracking-wide text-primary hover:underline"
          >
            Voir le plan
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {activeNutritionPlan.days.map((day) => (
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

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Droplet size={20} className="mb-2 text-primary" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Hydratation
          </span>
          <span className="font-heading text-lg font-bold text-foreground">
            {hydrationAndSupplements.waterTarget}
          </span>
        </div>
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Pill size={20} className="mb-2 text-primary" />
          <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Compléments
          </span>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {hydrationAndSupplements.supplements.map((supplement) => (
              <li key={supplement}>{supplement}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Lightbulb size={20} className="mb-2 text-primary" />
          <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Conseil du jour
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            {hydrationAndSupplements.tipOfTheDay}
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Mes plans alimentaires
        </h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {nutritionPlans.map((plan) => (
            <NutritionPlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </div>
    </div>
  );
}
