import type { DayTrainingSession } from "@/types";

export function TrainingWeekOverview({ days }: { days: DayTrainingSession[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {days.map((day) => (
        <div
          key={day.day}
          className={`flex flex-col gap-2 border p-4 ${
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
          {day.sessionName ? (
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium leading-snug text-foreground">
                {day.sessionName}
              </span>
              <span className="text-xs text-muted-foreground">
                {day.durationMinutes} min · {day.exerciseCount} exercices
              </span>
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">Repos</span>
          )}
        </div>
      ))}
    </div>
  );
}
