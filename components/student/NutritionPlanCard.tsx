import Link from "next/link";

import { ProgressBar } from "@/components/student/ProgressBar";
import { StatusBadge } from "@/components/student/StatusBadge";
import { nutritionGoalLabels } from "@/lib/nutrition";
import type { NutritionDay, NutritionPlan } from "@/types";

interface NutritionPlanCardProps {
  plan: NutritionPlan;
  days?: NutritionDay[];
}

export function NutritionPlanCard({ plan, days }: NutritionPlanCardProps) {
  const trackedDays = days ?? plan.days;
  const daysValidated = trackedDays.filter((day) => day.status === "valide").length;
  const progressPercent = Math.round((daysValidated / trackedDays.length) * 100);

  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-lg font-bold uppercase text-foreground">
          {plan.name}
        </h3>
        <StatusBadge status={plan.status} />
      </div>

      <p className="text-sm text-muted-foreground">
        {nutritionGoalLabels[plan.goalType]}
      </p>

      <div className="grid grid-cols-4 gap-2 border-t border-border pt-4 text-center">
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.dailyTarget.calories}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            kcal
          </div>
        </div>
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.dailyTarget.protein}g
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            prot.
          </div>
        </div>
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.dailyTarget.carbs}g
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            gluc.
          </div>
        </div>
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.dailyTarget.fat}g
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            lip.
          </div>
        </div>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">Semaine validée</span>
          <span>
            {daysValidated} / {trackedDays.length} jours
          </span>
        </div>
        <ProgressBar percent={progressPercent} />
      </div>

      <Link
        href={`/nutrition/${plan.id}`}
        className="mt-2 block border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        Voir le plan
      </Link>
    </div>
  );
}
