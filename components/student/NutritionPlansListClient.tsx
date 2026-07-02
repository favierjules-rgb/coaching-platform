"use client";

import { NutritionPlanCardLive } from "@/components/student/NutritionPlanCardLive";
import type { NutritionPlan } from "@/types";

export function NutritionPlansListClient({ plans }: { plans: NutritionPlan[] }) {
  return (
    <div>
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
        Mes plans alimentaires
      </h2>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <NutritionPlanCardLive key={plan.id} plan={plan} />
        ))}
      </div>
    </div>
  );
}
