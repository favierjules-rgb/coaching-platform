import type { PlannedMeal } from "@/types";

export function PlannedMealCard({ meal }: { meal: PlannedMeal }) {
  return (
    <div className="flex flex-col gap-2 border border-border bg-card p-5">
      <span className="font-heading text-xs font-semibold uppercase tracking-widest text-primary">
        {meal.slot}
      </span>
      <span className="text-sm font-medium leading-snug text-foreground">
        {meal.name}
      </span>

      <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
        {meal.items.map((item) => (
          <li key={item.name}>
            {item.name} — {item.quantity}
          </li>
        ))}
      </ul>

      <span className="text-xs text-muted-foreground">
        {meal.macros.calories} kcal · {meal.macros.protein}g prot. ·{" "}
        {meal.macros.carbs}g gluc. · {meal.macros.fat}g lip.
      </span>

      {meal.coachNotes && (
        <p className="mt-1 border-t border-border pt-2 text-xs italic leading-relaxed text-muted-foreground">
          {meal.coachNotes}
        </p>
      )}
    </div>
  );
}
