import { StatusBadge } from "@/components/student/StatusBadge";
import type { MealPlan } from "@/types";

export function MealPlanCard({ plan }: { plan: MealPlan }) {
  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-lg font-bold uppercase text-foreground">
          {plan.name}
        </h3>
        <StatusBadge status={plan.status} />
      </div>
      <p className="text-sm text-muted-foreground">{plan.goal}</p>
      <div className="mt-auto grid grid-cols-4 gap-2 border-t border-border pt-4 text-center">
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.calories}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            kcal
          </div>
        </div>
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.protein}g
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            prot.
          </div>
        </div>
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.carbs}g
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            gluc.
          </div>
        </div>
        <div>
          <div className="font-heading text-base font-bold text-foreground">
            {plan.fat}g
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            lip.
          </div>
        </div>
      </div>
    </div>
  );
}
