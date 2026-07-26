"use client";

import { useMemo } from "react";

import type { AdminCalendarEvent } from "@/lib/admin-calendar-events";
import { addDays, dayKeyLocal, eventsInRange, isSameDay, monthGridDays, weekdayShortLabel } from "@/lib/calendar-grid";
import { CalendarEventChip } from "./CalendarEventChip";

/** Nombre maximal d'événements affichés par case avant le repli « +n ». */
const MAX_EVENTS_PER_CELL = 3;

/**
 * Vue Mois du calendrier admin : semaines complètes lun → dim, événements en
 * puces compactes, « +n autres » au-delà de 3, clic sur un jour → bascule en
 * vue Jour (même geste que Calendrier Apple).
 */
export function MonthGrid({
  anchor,
  events,
  onSelectEvent,
  onOpenDay,
}: {
  anchor: Date;
  events: AdminCalendarEvent[];
  onSelectEvent: (event: AdminCalendarEvent) => void;
  onOpenDay: (day: Date) => void;
}) {
  const days = useMemo(() => monthGridDays(anchor), [anchor]);
  const today = new Date();
  const monthIndex = anchor.getMonth();

  const eventsByDay = useMemo(() => {
    const map = new Map<string, AdminCalendarEvent[]>();
    for (const day of days) {
      map.set(
        dayKeyLocal(day),
        eventsInRange(events, day, addDays(day, 1)),
      );
    }
    return map;
  }, [days, events]);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-background">
      <div className="grid grid-cols-7 border-b border-border">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className="py-2 text-center text-[10px] uppercase tracking-widest text-muted-foreground">
            {weekdayShortLabel(i)}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const key = dayKeyLocal(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const inMonth = day.getMonth() === monthIndex;
          const isToday = isSameDay(day, today);
          const overflow = dayEvents.length - MAX_EVENTS_PER_CELL;
          return (
            <div
              key={key}
              className={`flex min-h-[6.5rem] min-w-0 flex-col gap-0.5 border-border p-1 ${index % 7 !== 0 ? "border-l" : ""} ${index >= 7 ? "border-t" : ""} ${inMonth ? "" : "bg-surface-soft/40"}`}
            >
              <button
                type="button"
                onClick={() => onOpenDay(day)}
                aria-label={`Ouvrir le ${day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
                className={`pressable mx-auto flex h-6 w-6 items-center justify-center rounded-full text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                  isToday
                    ? "bg-primary font-bold text-primary-foreground"
                    : inMonth
                      ? "font-semibold text-foreground hover:bg-surface-soft"
                      : "text-muted-foreground hover:bg-surface-soft"
                }`}
              >
                {day.getDate()}
              </button>
              {dayEvents.slice(0, MAX_EVENTS_PER_CELL).map((event) => (
                <CalendarEventChip key={event.id} event={event} compact onSelect={onSelectEvent} />
              ))}
              {overflow > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className="pressable rounded-control px-1 text-left text-[10px] font-bold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  +{overflow} autre{overflow > 1 ? "s" : ""}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
