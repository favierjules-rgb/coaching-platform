import type { DayCalorieTarget } from "@/types";

export function NutritionWeekOverview({ days }: { days: DayCalorieTarget[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {days.map((day) => (
        <div
          key={day.day}
          className={`flex flex-col gap-2 border p-4 text-center ${
            day.isToday
              ? "border-primary bg-primary/10"
              : "border-border bg-card"
          }`}
        >
          <span
            className={`font-heading text-xs font-semibold uppercase tracking-widest ${
              day.isToday ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {day.day}
          </span>
          <span className="font-heading text-lg font-bold text-foreground">
            {day.calories}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            kcal
          </span>
        </div>
      ))}
    </div>
  );
}
