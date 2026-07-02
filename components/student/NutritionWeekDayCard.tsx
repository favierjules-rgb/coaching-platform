import { DayStatusBadge } from "@/components/student/DayStatusBadge";
import { VarianceChip } from "@/components/student/VarianceChip";
import type { NutritionDay } from "@/types";

interface NutritionWeekDayCardProps {
  day: NutritionDay;
  selected: boolean;
  onSelect: () => void;
}

export function NutritionWeekDayCard({
  day,
  selected,
  onSelect,
}: NutritionWeekDayCardProps) {
  const deltaKcal = day.actual
    ? day.actual.macros.calories - day.target.calories
    : null;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex flex-col gap-2 border p-4 text-left transition-colors ${
        selected
          ? "border-primary bg-primary/10"
          : day.isToday
            ? "border-primary/50 bg-card"
            : "border-border bg-card hover:border-primary/40"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`font-heading text-xs font-semibold uppercase tracking-widest ${
            day.isToday || selected ? "text-primary" : "text-muted-foreground"
          }`}
        >
          {day.day}
        </span>
        <DayStatusBadge status={day.status} />
      </div>

      <div className="text-xs text-muted-foreground">
        Prévu :{" "}
        <span className="text-foreground">{day.target.calories} kcal</span>
      </div>
      <div className="text-xs text-muted-foreground">
        Réel :{" "}
        <span className="text-foreground">
          {day.actual ? `${day.actual.macros.calories} kcal` : "—"}
        </span>
      </div>

      <VarianceChip deltaKcal={deltaKcal} />

      <span className="mt-2 block border border-primary py-2 text-center text-[11px] uppercase tracking-widest text-primary">
        {day.status === "valide" ? "Modifier" : "Valider la journée"}
      </span>
    </button>
  );
}
