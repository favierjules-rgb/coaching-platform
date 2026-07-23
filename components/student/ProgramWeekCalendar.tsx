import Link from "next/link";

import { SessionBlockChips } from "@/components/student/SessionBlockChips";
import { derivedSessionTypeLabel } from "@/lib/session-summary";
import { deriveSessionType } from "@/lib/training-blocks";
import type { ProgramScheduleDay, WorkoutSession } from "@/types";

interface ProgramWeekCalendarProps {
  schedule: ProgramScheduleDay[];
  sessions: WorkoutSession[];
}

/**
 * Semaine élève : une carte par jour. Le contenu de chaque séance est rendu
 * depuis le modèle canonique `blocks[]` (pastilles SessionBlockChips + type
 * global dérivé), jamais depuis `exercises[]`/`cardioBlocks[]`. Les jours sans
 * séance affichent une carte de repos volontairement plus légère (pointillés).
 */
export function ProgramWeekCalendar({ schedule, sessions }: ProgramWeekCalendarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {schedule.map((day) => {
        const session = day.sessionId ? sessions.find((item) => item.id === day.sessionId) : undefined;

        const dayLabel = (
          <span
            className={`font-heading text-xs font-semibold uppercase tracking-widest ${
              day.isToday ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {day.day}
          </span>
        );

        // Jour de repos : carte plus légère (pointillés), aucune fausse pastille.
        if (!session) {
          return (
            <div
              key={day.day}
              className={`flex flex-col gap-2 rounded-panel border border-dashed p-4 ${
                day.isToday ? "border-primary/50 bg-primary/5" : "border-border/70 bg-surface-soft/40"
              }`}
            >
              {dayLabel}
              <span className="text-sm text-muted-foreground">Repos</span>
            </div>
          );
        }

        const blocks = session.blocks ?? [];
        const typeLabel = blocks.length ? derivedSessionTypeLabel(deriveSessionType(blocks)) : null;

        return (
          <Link
            key={day.day}
            href={`/entrainement/seance/${session.id}`}
            className={`pressable flex flex-col gap-2 rounded-panel border p-4 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              day.isToday ? "border-primary/40 bg-primary/5" : "border-border bg-card"
            }`}
          >
            {dayLabel}
            <div className="flex flex-1 flex-col gap-2">
              <div>
                <span className="block text-sm font-medium leading-snug text-foreground">{session.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {session.durationMinutes} min{typeLabel ? ` · ${typeLabel}` : ""}
                </span>
              </div>
              <SessionBlockChips blocks={blocks} max={3} />
            </div>
          </Link>
        );
      })}
    </div>
  );
}
