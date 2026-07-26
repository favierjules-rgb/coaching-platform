"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { AdminCalendarEvent } from "@/lib/admin-calendar-events";
import {
  DAY_MINUTES,
  allDayEventsForDay,
  currentTimeMinutes,
  dayKeyLocal,
  isSameDay,
  layoutDayEvents,
  weekdayShortLabel,
} from "@/lib/calendar-grid";
import { CalendarEventChip } from "./CalendarEventChip";

/**
 * Grille horaire du calendrier admin — sert la vue Semaine (7 colonnes) et
 * la vue Jour (1 colonne). Gouttière des heures, lignes horaires, bandeau
 * « toute la journée », ligne de l'heure actuelle, événements positionnés en
 * absolu selon lib/calendar-grid (colonnes de chevauchement).
 *
 * Skills appliquées (apple-design/emil-design-eng) : feedback instantané au
 * press (.pressable), aucune animation décorative (uniquement des
 * transitions de couleur), défilement initial vers le matin sans animation,
 * `prefers-reduced-motion` respecté par construction.
 */

/** Hauteur d'une heure en pixels — assez pour lire un créneau de 30 min. */
const HOUR_HEIGHT = 52;
/** Heure vers laquelle la grille défile à l'ouverture (début de journée type). */
const INITIAL_SCROLL_HOUR = 7;

function roundToHalfHour(minutes: number): number {
  return Math.max(0, Math.min(DAY_MINUTES - 30, Math.round(minutes / 30) * 30));
}

export function TimeGrid({
  days,
  events,
  onSelectEvent,
  onCreateAt,
}: {
  /** 1 jour (vue Jour) ou 7 jours lun → dim (vue Semaine). */
  days: Date[];
  events: AdminCalendarEvent[];
  onSelectEvent: (event: AdminCalendarEvent) => void;
  /** Clic/Entrée sur une zone vide — heure locale arrondie à 30 min. */
  onCreateAt: (start: Date) => void;
}) {
  const [now, setNow] = useState(() => new Date());
  const scrollRef = useRef<HTMLDivElement>(null);

  // Ligne « heure actuelle » : rafraîchie chaque minute (aucune animation).
  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Défilement initial vers le matin — instantané (pas de smooth imposé).
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: INITIAL_SCROLL_HOUR * HOUR_HEIGHT });
  }, [days.length]);

  const layoutsByDay = useMemo(
    () => days.map((day) => ({ day, layouts: layoutDayEvents(events, day), allDay: allDayEventsForDay(events, day) })),
    [days, events],
  );
  const hasAllDayRow = layoutsByDay.some((d) => d.allDay.length > 0);
  const isWeek = days.length > 1;

  function handleColumnClick(day: Date, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const minutes = roundToHalfHour(((e.clientY - rect.top) / rect.height) * DAY_MINUTES);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    start.setMinutes(minutes);
    onCreateAt(start);
  }

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-card border border-border bg-background">
      {/* En-têtes de jours */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div aria-hidden />
        {days.map((day, i) => {
          const today = isSameDay(day, now);
          return (
            <div key={dayKeyLocal(day)} className="flex min-w-0 flex-col items-center gap-0.5 border-l border-border px-1 py-2">
              {isWeek && (
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">{weekdayShortLabel(i)}</span>
              )}
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-full text-sm ${
                  today ? "bg-primary font-bold text-primary-foreground" : "font-semibold text-foreground"
                }`}
                aria-label={day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
              >
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* Bandeau « toute la journée » */}
      {hasAllDayRow && (
        <div className="grid border-b border-border" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))` }}>
          <div className="flex items-start justify-end pr-1 pt-1 text-[9px] uppercase tracking-wide text-muted-foreground" aria-hidden>
            Journée
          </div>
          {layoutsByDay.map(({ day, allDay }) => (
            <div key={dayKeyLocal(day)} className="flex min-w-0 flex-col gap-0.5 border-l border-border p-0.5">
              {allDay.map((event) => (
                <CalendarEventChip key={event.id} event={event} compact onSelect={onSelectEvent} />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Corps défilant */}
      <div ref={scrollRef} className="relative max-h-[34rem] overflow-y-auto overscroll-contain">
        <div className="grid" style={{ gridTemplateColumns: `3.25rem repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_HEIGHT }}>
          {/* Gouttière des heures */}
          <div className="relative" aria-hidden>
            {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
              <span
                key={hour}
                className="absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: hour * HOUR_HEIGHT }}
              >
                {String(hour).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {layoutsByDay.map(({ day, layouts }) => {
            const nowMinutes = currentTimeMinutes(now, day);
            return (
              <div
                key={dayKeyLocal(day)}
                className="relative min-w-0 cursor-pointer border-l border-border"
                onClick={(e) => handleColumnClick(day, e)}
                role="button"
                tabIndex={-1}
                aria-label={`Créer un événement le ${day.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`}
              >
                {/* Lignes horaires */}
                {Array.from({ length: 23 }, (_, i) => i + 1).map((hour) => (
                  <div key={hour} aria-hidden className="absolute inset-x-0 border-t border-border/60" style={{ top: hour * HOUR_HEIGHT }} />
                ))}

                {/* Événements */}
                {layouts.map((l) => (
                  <div
                    key={l.event.id}
                    className="absolute px-px"
                    style={{
                      top: `${(l.startMinutes / DAY_MINUTES) * 100}%`,
                      height: `${((l.endMinutes - l.startMinutes) / DAY_MINUTES) * 100}%`,
                      left: `${(l.column / l.columnCount) * 100}%`,
                      width: `${(1 / l.columnCount) * 100}%`,
                    }}
                  >
                    <CalendarEventChip event={l.event} onSelect={onSelectEvent} />
                  </div>
                ))}

                {/* Ligne heure actuelle */}
                {nowMinutes !== null && (
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 z-10"
                    style={{ top: `${(nowMinutes / DAY_MINUTES) * 100}%` }}
                  >
                    <div className="relative border-t-2 border-foreground">
                      <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-foreground" />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
