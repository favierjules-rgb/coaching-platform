import type { Meal } from "@/types";

export function MealCard({ meal }: { meal: Meal }) {
  return (
    <div className="flex flex-col gap-2 border border-border bg-card p-5">
      <span className="font-heading text-xs font-semibold uppercase tracking-widest text-primary">
        {meal.slot}
      </span>
      <span className="text-sm font-medium leading-snug text-foreground">
        {meal.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {meal.calories} kcal · {meal.protein}g prot. · {meal.carbs}g gluc. ·{" "}
        {meal.fat}g lip.
      </span>
    </div>
  );
}
