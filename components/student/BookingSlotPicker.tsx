"use client";

import { useMemo, useState } from "react";
import { CalendarPlus } from "lucide-react";

import { groupSlotsByDay } from "@/lib/booking";
import { formatDate } from "@/lib/admin";
import type { AvailableSlot } from "@/types";

export function BookingSlotPicker({
  slots,
  onBook,
}: {
  slots: AvailableSlot[];
  onBook: (slot: AvailableSlot) => void;
}) {
  const grouped = useMemo(() => groupSlotsByDay(slots), [slots]);
  const dayKeys = useMemo(() => Array.from(grouped.keys()).sort(), [grouped]);
  const [selectedDay, setSelectedDay] = useState<string | null>(dayKeys[0] ?? null);

  const activeDay = selectedDay && grouped.has(selectedDay) ? selectedDay : dayKeys[0] ?? null;
  const daySlots = activeDay ? grouped.get(activeDay) ?? [] : [];

  if (slots.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CalendarPlus size={16} />
        Aucun créneau disponible pour le moment. Contacte ton coach.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {dayKeys.map((key) => {
          const first = grouped.get(key)?.[0];
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedDay(key)}
              className={`border px-3 py-2 text-xs uppercase tracking-widest transition-colors ${
                key === activeDay
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              {first ? formatDate(first.startAt) : key}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
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
    </div>
  );
}
