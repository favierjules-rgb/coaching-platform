"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

import type { AdminCalendarEvent } from "@/lib/admin-calendar-events";
import { CALENDAR_KIND_LABELS, type AdminCalendarEventKind } from "@/lib/admin-calendar-events";
import { periodTitle, shiftAnchor, startOfDay, viewPeriod, weekDays, type CalendarView } from "@/lib/calendar-grid";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";

/**
 * Calendrier admin façon Calendrier Apple (vue Semaine par défaut, Jour,
 * Mois), monochrome, sans dépendance externe. Composant de PRÉSENTATION :
 * aucune mutation — la page fournit les événements de la période et reçoit
 * les intentions (sélection, création, changement de période).
 *
 * Clavier : ← / → naviguent, T revient à aujourd'hui, J/S/M changent de vue
 * (actif quand le focus est dans le calendrier). Tous les contrôles sont des
 * boutons focusables ≥ 44 px.
 */

const VIEW_LABELS: { view: CalendarView; label: string; shortcut: string }[] = [
  { view: "day", label: "Jour", shortcut: "j" },
  { view: "week", label: "Semaine", shortcut: "s" },
  { view: "month", label: "Mois", shortcut: "m" },
];

const LEGEND_KINDS: AdminCalendarEventKind[] = ["student", "student_cancelled", "personal", "professional", "unavailability"];

const LEGEND_SWATCH_CLASSES: Record<AdminCalendarEventKind, string> = {
  student: "border border-primary bg-primary",
  student_cancelled: "border border-dashed border-border bg-background",
  personal: "border border-foreground/60 bg-surface-soft",
  professional: "border-2 border-foreground/60 bg-surface-soft",
  unavailability: "border border-border calendar-hatched",
};

export function AdminCalendar({
  events,
  loading,
  error,
  onRangeChange,
  onSelectEvent,
  onCreateAt,
  onRetry,
}: {
  events: AdminCalendarEvent[];
  loading: boolean;
  error: string | null;
  /** Appelé à chaque changement de période affichée — la page ne charge que [start, end). */
  onRangeChange: (start: Date, end: Date) => void;
  onSelectEvent: (event: AdminCalendarEvent) => void;
  /** Clic sur une zone vide (heure arrondie à 30 min) ou sur un jour vide du mois. */
  onCreateAt: (start: Date) => void;
  onRetry: () => void;
}) {
  const [view, setView] = useState<CalendarView>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));

  const period = useMemo(() => viewPeriod(view, anchor), [view, anchor]);
  useEffect(() => {
    onRangeChange(period.start, period.end);
  }, [period.start, period.end, onRangeChange]);

  const title = periodTitle(view, anchor);
  const days = useMemo(() => (view === "day" ? [startOfDay(anchor)] : weekDays(anchor)), [view, anchor]);

  const goToday = useCallback(() => setAnchor(startOfDay(new Date())), []);
  const goPrev = useCallback(() => setAnchor((a) => shiftAnchor(view, a, -1)), [view]);
  const goNext = useCallback(() => setAnchor((a) => shiftAnchor(view, a, 1)), [view]);

  const openDay = useCallback((day: Date) => {
    setAnchor(startOfDay(day));
    setView("day");
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // Ne pas intercepter les saisies de formulaires éventuels.
    const target = e.target as HTMLElement;
    if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return;
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      goPrev();
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      goNext();
    } else {
      const key = e.key.toLowerCase();
      if (key === "t") goToday();
      const viewEntry = VIEW_LABELS.find((v) => v.shortcut === key);
      if (viewEntry) setView(viewEntry.view);
    }
  }

  const isEmpty = !loading && !error && events.length === 0;

  return (
    <section
      aria-label="Calendrier des rendez-vous"
      onKeyDown={handleKeyDown}
      className="flex min-w-0 flex-col gap-3"
    >
      {/* Barre d'outils */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={goPrev}
            aria-label="Période précédente"
            className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Période suivante"
            className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="pressable min-h-[44px] rounded-control border border-border px-4 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Aujourd&apos;hui
          </button>
        </div>

        <h2 aria-live="polite" className="font-heading text-lg font-bold text-foreground">
          {title}
        </h2>

        <div role="group" aria-label="Changer de vue" className="flex rounded-control border border-border p-0.5">
          {VIEW_LABELS.map(({ view: v, label }) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`pressable min-h-[40px] rounded-control px-3 text-xs font-bold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* États */}
      {error ? (
        <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-surface-soft/50 px-4 py-6">
          <p className="flex items-center gap-2 text-sm text-foreground">
            <AlertCircle size={16} className="flex-shrink-0" />
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="pressable min-h-[44px] rounded-control border border-border px-4 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Réessayer
          </button>
        </div>
      ) : loading ? (
        <div
          role="status"
          aria-label="Chargement du calendrier"
          className="flex min-h-[20rem] items-center justify-center rounded-card border border-border"
        >
          <Loader2 size={20} className="motion-safe:animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {isEmpty && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CalendarDays size={16} />
              Aucun événement sur cette période. Clique sur une zone vide pour en créer un.
            </p>
          )}
          {view === "month" ? (
            <MonthGrid anchor={anchor} events={events} onSelectEvent={onSelectEvent} onOpenDay={openDay} />
          ) : (
            <TimeGrid days={days} events={events} onSelectEvent={onSelectEvent} onCreateAt={onCreateAt} />
          )}
        </>
      )}

      {/* Légende des natures d'événements */}
      <ul aria-label="Légende" className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {LEGEND_KINDS.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span aria-hidden className={`h-3 w-3 rounded-sm ${LEGEND_SWATCH_CLASSES[kind]}`} />
            {CALENDAR_KIND_LABELS[kind]}
          </li>
        ))}
      </ul>
    </section>
  );
}
