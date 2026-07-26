"use client";

import { Ban, Briefcase, User, UserRound } from "lucide-react";

import type { AdminCalendarEvent, AdminCalendarEventKind } from "@/lib/admin-calendar-events";
import { CALENDAR_KIND_LABELS } from "@/lib/admin-calendar-events";

/**
 * Rendu d'un événement dans les grilles du calendrier admin.
 *
 * Identité monochrome : chaque nature se distingue par la FORME, jamais par
 * la seule couleur (skills apple-design/emil-design-eng — accessibilité,
 * retenue) :
 *  - RDV élève : fond plein sombre + icône personne ;
 *  - RDV annulé : contour pointillé, titre barré, icône interdit ;
 *  - événement personnel : fond clair, bordure pleine, icône silhouette ;
 *  - événement professionnel : fond clair, bordure pleine, icône mallette ;
 *  - indisponibilité : hachures diagonales discrètes.
 */

const KIND_ICONS: Record<AdminCalendarEventKind, typeof User> = {
  student: User,
  student_cancelled: Ban,
  personal: UserRound,
  professional: Briefcase,
  unavailability: Ban,
};

const KIND_CLASSES: Record<AdminCalendarEventKind, string> = {
  student: "border border-primary bg-primary text-primary-foreground",
  student_cancelled: "border border-dashed border-border bg-background text-muted-foreground",
  personal: "border border-foreground/60 bg-surface-soft text-foreground",
  professional: "border-2 border-foreground/60 bg-surface-soft text-foreground",
  unavailability: "border border-border text-muted-foreground calendar-hatched",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

export function calendarEventAriaLabel(event: AdminCalendarEvent): string {
  const time = event.allDay ? "toute la journée" : `de ${formatTime(event.startAt)} à ${formatTime(event.endAt)}`;
  const subtitle = event.subtitle ? `, ${event.subtitle}` : "";
  return `${CALENDAR_KIND_LABELS[event.kind]} : ${event.title}${subtitle}, ${time}`;
}

export function CalendarEventChip({
  event,
  compact,
  onSelect,
}: {
  event: AdminCalendarEvent;
  /** Rendu resserré (vue mois / bandeau toute la journée). */
  compact?: boolean;
  onSelect: (event: AdminCalendarEvent) => void;
}) {
  const Icon = KIND_ICONS[event.kind];
  const cancelled = event.kind === "student_cancelled";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onSelect(event);
      }}
      aria-label={calendarEventAriaLabel(event)}
      title={calendarEventAriaLabel(event)}
      className={`pressable flex h-full w-full min-w-0 flex-col overflow-hidden rounded-control px-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${KIND_CLASSES[event.kind]} ${compact ? "flex-row items-center gap-1 py-0.5" : "py-1"}`}
    >
      <span className={`flex min-w-0 items-center gap-1 text-[11px] font-bold leading-tight ${cancelled ? "line-through" : ""}`}>
        <Icon size={10} className="flex-shrink-0" aria-hidden />
        <span className="truncate">{event.title}</span>
      </span>
      {!compact && (
        <span className="truncate text-[10px] leading-tight opacity-80">
          {event.allDay ? "Toute la journée" : formatTime(event.startAt)}
          {event.subtitle ? ` · ${event.subtitle}` : ""}
        </span>
      )}
    </button>
  );
}
