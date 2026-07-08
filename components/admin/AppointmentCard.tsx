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

  return (
    <div className="flex flex-col gap-3 border border-border bg-card p-5">
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
        <p className="text-xs text-red-400">Motif d&apos;annulation : {appointment.cancellationReason}</p>
      )}

      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Download size={12} />
          Télécharger .ics
        </button>
        {isActive && (
          <>
            <button
              type="button"
              onClick={() => setShowRescheduleForm((v) => !v)}
              className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Calendar size={12} />
              Reporter
            </button>
            <button
              type="button"
              onClick={() => setShowCancelForm((v) => !v)}
              className="flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
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
              className="border border-border bg-background px-3 py-2 text-xs text-foreground"
            />
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="border border-border bg-background px-3 py-2 text-xs text-foreground"
            />
          </div>
          <button
            type="button"
            onClick={submitReschedule}
            className="border border-primary bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
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
            className="border border-border bg-background px-3 py-2 text-xs text-foreground"
          />
          <button
            type="button"
            onClick={() => {
              onCancel(cancelReason.trim());
              setShowCancelForm(false);
            }}
            className="border border-red-500/40 px-3 py-2 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
          >
            Confirmer l&apos;annulation
          </button>
        </div>
      )}
    </div>
  );
}
