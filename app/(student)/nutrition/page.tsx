import { Droplet, Lightbulb, Pill } from "lucide-react";

import { NutritionPlansListClient } from "@/components/student/NutritionPlansListClient";
import { NutritionWeekStatusClient } from "@/components/student/NutritionWeekStatusClient";
import {
  activeNutritionPlan,
  hydrationAndSupplements,
  nutritionPlans,
  student,
} from "@/data/student";

export default function NutritionPage() {
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

      <NutritionWeekStatusClient
        studentId={student.id}
        activePlan={activeNutritionPlan}
      />

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

      <NutritionPlansListClient plans={nutritionPlans} />
    </div>
  );
}
