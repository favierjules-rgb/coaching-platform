"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Calendar,
  CalendarX,
  Camera,
  CheckCircle2,
  CreditCard,
  Dumbbell,
  FileText,
  MessageSquare,
  Scale,
  UserCheck,
  Utensils,
  XCircle,
} from "lucide-react";

import { fullName } from "@/lib/admin";
import type { ActivityEvent, ActivityEventType, AdminStudent } from "@/types";

const EVENT_ICONS: Record<ActivityEventType, typeof Activity> = {
  onboarding_completed: UserCheck,
  weight_added: Scale,
  workout_feedback_submitted: Dumbbell,
  nutrition_log_filled: Utensils,
  appointment_booked: Calendar,
  appointment_cancelled: CalendarX,
  document_assigned: FileText,
  document_viewed: FileText,
  program_assigned: Dumbbell,
  nutrition_assigned: Utensils,
  coach_note_added: MessageSquare,
  progress_photo_uploaded: Camera,
  payment_succeeded: CreditCard,
  payment_failed: AlertTriangle,
  subscription_cancelled: XCircle,
};

function relativeTime(dateIso: string): string {
  const diffMs = Date.now() - new Date(dateIso).getTime();
  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 1) return "à l'instant";
  if (diffMinutes < 60) return `il y a ${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `il y a ${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  return `il y a ${diffDays} j`;
}

function eventLink(event: ActivityEvent): string | null {
  const link = event.metadata?.link;
  return typeof link === "string" ? link : null;
}

interface ActivityFeedProps {
  events: ActivityEvent[];
  students?: AdminStudent[];
  onMarkRead?: (id: string) => void;
  /** Affiche le filtre "Non lues / Toutes" (centre d'activité admin) — masqué pour l'historique d'une fiche élève, déjà filtré par student_id. */
  showFilter?: boolean;
  emptyLabel?: string;
}

export function ActivityFeed({ events, students, onMarkRead, showFilter = false, emptyLabel = "Aucune activité récente." }: ActivityFeedProps) {
  const [filter, setFilter] = useState<"toutes" | "non-lues">(showFilter ? "non-lues" : "toutes");
  const studentById = useMemo(() => new Map((students ?? []).map((s) => [s.id, s])), [students]);

  const filtered = filter === "non-lues" ? events.filter((e) => !e.isRead) : events;

  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div>
      {showFilter && (
        <div className="mb-4 flex gap-2">
          <button
            type="button"
            onClick={() => setFilter("non-lues")}
            className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
              filter === "non-lues" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            Non lues ({events.filter((e) => !e.isRead).length})
          </button>
          <button
            type="button"
            onClick={() => setFilter("toutes")}
            className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
              filter === "toutes" ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            Toutes ({events.length})
          </button>
        </div>
      )}

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune activité non lue.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((event) => {
            const Icon = EVENT_ICONS[event.eventType] ?? Activity;
            const student = event.studentId ? studentById.get(event.studentId) : undefined;
            const link = eventLink(event);
            return (
              <div
                key={event.id}
                className={`flex items-start gap-3 border p-4 ${event.isRead ? "border-border" : "border-primary/40 bg-primary/5"}`}
              >
                <Icon size={16} className="mt-0.5 flex-shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">{event.title}</p>
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{relativeTime(event.createdAt)}</span>
                  </div>
                  {event.description && <p className="mt-0.5 text-xs text-muted-foreground">{event.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {student && (
                      <Link href={`/admin/eleves/${student.id}`} className="text-xs text-primary hover:underline">
                        {fullName(student)}
                      </Link>
                    )}
                    {!student && link && (
                      <Link href={link} className="text-xs text-primary hover:underline">
                        Voir la fiche élève
                      </Link>
                    )}
                    {onMarkRead && !event.isRead && (
                      <button
                        type="button"
                        onClick={() => onMarkRead(event.id)}
                        className="flex items-center gap-1 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
                      >
                        <CheckCircle2 size={12} />
                        Marquer comme lu
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
