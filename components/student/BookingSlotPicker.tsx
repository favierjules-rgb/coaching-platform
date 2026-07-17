"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";

import { groupSlotsByDay } from "@/lib/booking";
import type { AvailableSlot } from "@/types";

const WEEKDAY_SHORT_LABELS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTH_LABELS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

/** Clé "YYYY-MM-DD" en heure locale — même convention que lib/booking.ts::groupSlotsByDay. */
function dateKey(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

interface CalendarCell {
  day: number;
  key: string;
  isToday: boolean;
  hasSlots: boolean;
}

/**
 * Vrai calendrier mensuel (façon Calendly, demandé par Jules en remplacement
 * de la bande de dates horizontale) : grille lundi -> dimanche du mois
 * affiché, les jours avec au moins un créneau disponible sont mis en avant
 * et cliquables, les autres restent neutres/non cliquables. La navigation
 * mois précédent/suivant est bornée par les données déjà chargées
 * (computeAvailableSlots ne renvoie jamais de créneau avant maintenant ni
 * au-delà de bookingSettings.maxDaysAhead, voir lib/booking.ts) : on ne peut
 * jamais reculer avant le mois courant, ni avancer au-delà du dernier mois
 * qui contient réellement un créneau.
 */
export function BookingSlotPicker({
  slots,
  onBook,
}: {
  slots: AvailableSlot[];
  onBook: (slot: AvailableSlot) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const grouped = useMemo(() => groupSlotsByDay(slots), [slots]);
  const dayKeys = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);

  const currentMonthStart = useMemo(() => startOfMonth(today), [today]);
  const lastAvailableMonthStart = useMemo(() => {
    if (dayKeys.length === 0) return currentMonthStart;
    const lastKey = dayKeys[dayKeys.length - 1];
    const [y, m] = lastKey.split("-").map(Number);
    const monthStart = new Date(y, m - 1, 1);
    return monthStart.getTime() > currentMonthStart.getTime() ? monthStart : currentMonthStart;
  }, [dayKeys, currentMonthStart]);

  const [viewMonth, setViewMonth] = useState(currentMonthStart);
  const [selectedDay, setSelectedDay] = useState<string | null>(dayKeys[0] ?? null);

  // Si les créneaux changent (rechargement après réservation), le jour
  // sélectionné peut ne plus exister (créneau réservé) — repli calculé au
  // rendu sur le premier jour disponible plutôt qu'un useEffect + setState,
  // jamais de rendu "vide" intermédiaire.
  const effectiveSelectedDay = selectedDay && grouped.has(selectedDay) ? selectedDay : (dayKeys[0] ?? null);

  if (slots.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarPlus size={16} />
        Aucun créneau disponible pour le moment. Contacte ton coach.
      </p>
    );
  }

  const canGoPrev = viewMonth.getTime() > currentMonthStart.getTime();
  const canGoNext = viewMonth.getTime() < lastAvailableMonthStart.getTime();

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstWeekdayIndex = (new Date(year, monthIndex, 1).getDay() + 6) % 7; // 0 = lundi

  const cells: (CalendarCell | null)[] = [];
  for (let i = 0; i < firstWeekdayIndex; i += 1) {
    cells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = dateKey(year, monthIndex, day);
    cells.push({
      day,
      key,
      isToday: isSameMonth(viewMonth, today) && day === today.getDate(),
      hasSlots: grouped.has(key),
    });
  }
  while (cells.length % 7 !== 0) {
    cells.push(null);
  }

  const daySlots = effectiveSelectedDay ? grouped.get(effectiveSelectedDay) ?? [] : [];
  const selectedDateLabel = effectiveSelectedDay
    ? new Date(`${effectiveSelectedDay}T00:00:00`).toLocaleDateString("fr-FR", {
        weekday: "long",
        day: "numeric",
        month: "long",
      })
    : null;

  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <div className="md:w-[340px] md:flex-shrink-0">
        <div className="mb-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => canGoPrev && setViewMonth(new Date(year, monthIndex - 1, 1))}
            disabled={!canGoPrev}
            aria-label="Mois précédent"
            className="border border-border p-1.5 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="font-heading text-sm font-bold uppercase tracking-wide text-foreground">
            {MONTH_LABELS[monthIndex]} {year}
          </span>
          <button
            type="button"
            onClick={() => canGoNext && setViewMonth(new Date(year, monthIndex + 1, 1))}
            disabled={!canGoNext}
            aria-label="Mois suivant"
            className="border border-border p-1.5 text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_SHORT_LABELS.map((label) => (
            <span key={label} className="py-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              {label}
            </span>
          ))}
          {cells.map((cell, index) => {
            if (!cell) {
              return <span key={`empty-${index}`} />;
            }
            const isSelected = cell.key === effectiveSelectedDay;
            return (
              <button
                key={cell.key}
                type="button"
                disabled={!cell.hasSlots}
                onClick={() => setSelectedDay(cell.key)}
                aria-pressed={isSelected}
                className={`relative aspect-square text-sm transition-colors ${
                  isSelected
                    ? "bg-primary font-bold text-primary-foreground"
                    : cell.hasSlots
                      ? "bg-primary/10 text-primary hover:bg-primary/20"
                      : "cursor-not-allowed text-muted-foreground/40"
                }`}
              >
                {cell.day}
                {cell.isToday && !isSelected && (
                  <span className="absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-primary" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          {selectedDateLabel ? `Créneaux le ${selectedDateLabel}` : "Choisis un jour disponible"}
        </h3>
        {daySlots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sélectionne un jour en surbrillance dans le calendrier.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {daySlots.map((slot) => (
              <button
                key={slot.startAt}
                type="button"
                onClick={() => onBook(slot)}
                className="flex flex-col items-center gap-1 border border-border px-3 py-3 text-sm text-foreground transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="font-bold">
                  {new Date(slot.startAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{slot.appointmentType}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
