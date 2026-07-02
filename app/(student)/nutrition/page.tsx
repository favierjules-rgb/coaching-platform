import { Droplet, Lightbulb, Pill } from "lucide-react";

import { MealCard } from "@/components/student/MealCard";
import { MealPlanCard } from "@/components/student/MealPlanCard";
import { NutritionWeekOverview } from "@/components/student/NutritionWeekOverview";
import {
  activeMealPlan,
  hydrationAndSupplements,
  mealPlans,
  todayMeals,
  weeklyCalorieTargets,
} from "@/data/student";

export default function NutritionPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Nutrition
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan actif : {activeMealPlan.name} · {activeMealPlan.calories} kcal /
          jour
        </p>
      </div>

      <div className="mb-6 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Aperçu de la semaine
        </h2>
        <NutritionWeekOverview days={weeklyCalorieTargets} />
      </div>

      <div className="mb-8">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Repas du jour
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {todayMeals.map((meal) => (
            <MealCard key={meal.slot} meal={meal} />
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
          {mealPlans.map((plan) => (
            <MealPlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      </div>
    </div>
  );
}
