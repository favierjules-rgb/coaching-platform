"use client";

import { useState } from "react";
import { Calendar, Download, MapPin, Video, XCircle } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { appointmentStatusLabels, appointmentStatusTone, formatDateTime, fullName } from "@/lib/admin";
import { buildConfirmationIcs, downloadIcsFile } from "@/lib/ics";
import type { AdminAppointment, AdminStudent } from "@/types";

function icsFilenameFor(appointment: AdminAppointment): string {
  return `rendez-vous-${appointment.id.slice(0, 8)}.ics`;
}

export function AppointmentCard({
  appointment,
  student,
  coachName,
  coachEmail,
  onCancel,
  onReschedule,
}: {
  appointment: AdminAppointment;
  student: AdminStudent | undefined;
  coachName: string;
  coachEmail: string;
  onCancel: (reason: string) => void;
  onReschedule: (newStartAt: string, newEndAt: string) => void;
}) {
  const [showCancelForm, setShowCancelForm] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showRescheduleForm, setShowRescheduleForm] = useState(false);
  const [newDate, setNewDate] = useState("");
  const [newTime, setNewTime] = useState("");

  const durationMinutes = Math.round((new Date(appointment.endAt).getTime() - new Date(appointment.startAt).getTime()) / 60_000);

  function handleDownloadIcs() {
    const ics = buildConfirmationIcs({
      uid: appointment.icsUid,
      title: appointment.title,
      description: appointment.description,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      location: appointment.location,
      meetingUrl: appointment.meetingUrl,
      organizerName: coachName,
      organizerEmail: coachEmail,
      attendeeName: student ? fullName(student) : "Élève",
      attendeeEmail: student?.email ?? "",
    });
    downloadIcsFile(ics, icsFilenameFor(appointment));
  }

  function submitReschedule() {
    if (!newDate || !newTime) return;
    const start = new Date(`${newDate}T${newTime}:00`);
    if (Number.isNaN(start.getTime())) return;
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    onReschedule(start.toISOString(), end.toISOString());
    setShowRescheduleForm(false);
  }

  const isActive = appointment.status === "pending" || appointment.status === "confirmed";
  // Rendez-vous annulés/absents : visibles mais SECONDAIRES (fond atténué),
  // sans jamais masquer l'information — le badge « Annulé » (StatusBadge) porte
  // déjà le statut en toutes lettres.
  const dimmed = appointment.status === "cancelled" || appointment.status === "no_show";

  return (
    <div
      className={`flex flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-soft transition-colors ${
        dimmed ? "opacity-70" : "hover:border-border-strong"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-sm font-bold uppercase text-foreground">{appointment.title}</h3>
          <p className="text-xs text-muted-foreground">{student ? fullName(student) : "Élève inconnu"}</p>
        </div>
        <StatusBadge label={appointmentStatusLabels[appointment.status]} tone={appointmentStatusTone(appointment.status)} />
      </div>

      <p className="flex items-center gap-2 text-xs text-foreground">
        <Calendar size={13} className="text-primary" />
        {formatDateTime(appointment.startAt)} · {durationMinutes} min
      </p>
      {appointment.location && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin size={13} />
          {appointment.location}
        </p>
      )}
      {appointment.meetingUrl && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Video size={13} />
          <a href={appointment.meetingUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline">
            {appointment.meetingUrl}
          </a>
        </p>
      )}
      {appointment.status === "cancelled" && appointment.cancellationReason && (
        <p className="text-xs text-destructive">Motif d&apos;annulation : {appointment.cancellationReason}</p>
      )}

      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Download size={12} />
          Télécharger .ics
        </button>
        {isActive && (
          <>
            <button
              type="button"
              onClick={() => setShowRescheduleForm((v) => !v)}
              aria-expanded={showRescheduleForm}
              className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <Calendar size={12} />
              Reporter
            </button>
            <button
              type="button"
              onClick={() => setShowCancelForm((v) => !v)}
              aria-expanded={showCancelForm}
              className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            >
              <XCircle size={12} />
              Annuler
            </button>
          </>
        )}
      </div>

      {showRescheduleForm && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="min-h-[44px] rounded-control border border-border bg-surface-soft px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="min-h-[44px] rounded-control border border-border bg-surface-soft px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={submitReschedule}
            className="pressable min-h-[44px] rounded-control border border-primary bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Confirmer le report
          </button>
        </div>
      )}

      {showCancelForm && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <input
            type="text"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Motif d'annulation (optionnel)"
            className="min-h-[44px] rounded-control border border-border bg-surface-soft px-3 py-2 text-xs text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
          />
          <button
            type="button"
            onClick={() => {
              onCancel(cancelReason.trim());
              setShowCancelForm(false);
            }}
            className="pressable min-h-[44px] rounded-control border border-destructive/40 px-3 py-2 text-[11px] uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            Confirmer l&apos;annulation
          </button>
        </div>
      )}
    </div>
  );
}
