"use client";

import { useState } from "react";
import { Calendar, Download, MapPin, Video, XCircle } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { appointmentStatusLabels, appointmentStatusTone, formatDateTime } from "@/lib/admin";
import { buildConfirmationIcs, downloadIcsFile } from "@/lib/ics";
import type { AdminAppointment } from "@/types";

export function StudentAppointmentCard({
  appointment,
  studentFirstName,
  studentEmail,
  coachName,
  coachEmail,
  onCancel,
}: {
  appointment: AdminAppointment;
  studentFirstName: string;
  studentEmail: string;
  coachName: string;
  coachEmail: string;
  onCancel?: (reason: string) => void;
}) {
  const [showCancelForm, setShowCancelForm] = useState(false);
  const isActive = appointment.status === "pending" || appointment.status === "confirmed";

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
      attendeeName: studentFirstName,
      attendeeEmail: studentEmail,
    });
    downloadIcsFile(ics, `rendez-vous-${appointment.id.slice(0, 8)}.ics`);
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-heading text-sm font-bold uppercase text-foreground">{appointment.title}</h3>
        <StatusBadge label={appointmentStatusLabels[appointment.status]} tone={appointmentStatusTone(appointment.status)} />
      </div>

      <p className="flex items-center gap-2 text-xs text-foreground">
        <Calendar size={13} className="text-primary" />
        {formatDateTime(appointment.startAt)}
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
            Rejoindre la visio
          </a>
        </p>
      )}

      <div className="mt-1 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDownloadIcs}
          className="pressable flex min-h-[40px] items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Download size={12} />
          Télécharger .ics
        </button>
        {isActive && onCancel && (
          <button
            type="button"
            onClick={() => setShowCancelForm((v) => !v)}
            className="pressable flex min-h-[40px] items-center gap-1.5 rounded-control border border-destructive/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <XCircle size={12} />
            Annuler
          </button>
        )}
      </div>

      {showCancelForm && onCancel && (
        <div className="animate-fade-in flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Confirmer l&apos;annulation de ce rendez-vous ?</p>
          <button
            type="button"
            onClick={() => {
              onCancel("Annulé par l'élève");
              setShowCancelForm(false);
            }}
            className="pressable min-h-[44px] rounded-control border border-destructive/40 px-3 py-2 text-[11px] uppercase tracking-widest text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            Confirmer l&apos;annulation
          </button>
        </div>
      )}
    </div>
  );
}
