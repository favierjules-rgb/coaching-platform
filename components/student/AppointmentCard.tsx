"use client";

import { useState } from "react";
import { Calendar, Download, MapPin, Video, XCircle } from "lucide-react";

import { appointmentStatusLabels, appointmentStatusTone, formatDateTime } from "@/lib/admin";
import { buildConfirmationIcs, downloadIcsFile } from "@/lib/ics";
import type { AdminAppointment } from "@/types";

const toneClass: Record<string, string> = {
  green: "border-green-500/50 text-green-400",
  amber: "border-amber-500/50 text-amber-400",
  muted: "border-border text-muted-foreground",
  red: "border-red-500/50 text-red-400",
  primary: "border-primary text-primary",
};

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
    <div className="flex flex-col gap-3 border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-heading text-sm font-bold uppercase text-foreground">{appointment.title}</h3>
        <span
          className={`inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] uppercase tracking-widest ${toneClass[appointmentStatusTone(appointment.status)]}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {appointmentStatusLabels[appointment.status]}
        </span>
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
          className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Download size={12} />
          Télécharger .ics
        </button>
        {isActive && onCancel && (
          <button
            type="button"
            onClick={() => setShowCancelForm((v) => !v)}
            className="flex items-center gap-1.5 border border-red-500/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
          >
            <XCircle size={12} />
            Annuler
          </button>
        )}
      </div>

      {showCancelForm && onCancel && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">Confirmer l&apos;annulation de ce rendez-vous ?</p>
          <button
            type="button"
            onClick={() => {
              onCancel("Annulé par l'élève");
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
