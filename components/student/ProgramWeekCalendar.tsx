import Link from "next/link";

import type { ProgramScheduleDay, WorkoutSession } from "@/types";

interface ProgramWeekCalendarProps {
  schedule: ProgramScheduleDay[];
  sessions: WorkoutSession[];
}

export function ProgramWeekCalendar({
  schedule,
  sessions,
}: ProgramWeekCalendarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {schedule.map((day) => {
        const session = day.sessionId
          ? sessions.find((item) => item.id === day.sessionId)
          : undefined;

        const cardClasses = `flex flex-col gap-2 border p-4 ${
          day.isToday ? "border-primary bg-primary/10" : "border-border bg-card"
        }`;

        const dayLabel = (
          <span
            className={`font-heading text-xs font-semibold uppercase tracking-widest ${
              day.isToday ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {day.day}
          </span>
        );

        if (!session) {
          return (
            <div key={day.day} className={cardClasses}>
              {dayLabel}
              <span className="text-sm text-muted-foreground">Repos</span>
            </div>
          );
        }

        return (
          <Link
            key={day.day}
            href={`/entrainement/seance/${session.id}`}
            className={`${cardClasses} transition-colors hover:border-primary`}
          >
            {dayLabel}
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-sm font-medium leading-snug text-foreground">
                {session.name}
              </span>
              <span className="text-xs text-muted-foreground">
                {session.durationMinutes} min · {session.exercises.length}{" "}
                exercices
              </span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
