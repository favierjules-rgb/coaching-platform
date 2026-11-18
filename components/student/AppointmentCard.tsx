"use client";

import { useState } from "react";
import { Calendar, Download, MapPin, Video, XCircle } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { appointmentStatusLabels, appointmentStatusTone, formatDateTime } from "@/lib/admin";
import { buildConfirmationIcs, downloadIcsFile } from "@/lib/ics";
import { construireIntituleIcs, formaterIdentiteCoach } from "@/lib/ics-intitules";
import type { AdminAppointment } from "@/types";

export function StudentAppointmentCard({
  appointment,
  studentFirstName,
  studentEmail,
  coachName,
  coachEmail,
  coachTitulaireId,
  onCancel,
}: {
  appointment: AdminAppointment;
  studentFirstName: string;
  studentEmail: string;
  coachName: string;
  coachEmail: string;
  /**
   * Identifiant du coach rattaché à la FICHE de l'élève (`students.coach_id`),
   * rendu par la RPC `get_my_coach_public_profile` — `null` tant qu'elle n'a
   * pas répondu.
   *
   * ⚠️ IL SERT À VÉRIFIER, PAS À CHOISIR. `coachName` est le nom de ce
   * coach-là ; il ne devient le titre de l'invitation que si cet identifiant
   * est bien celui du PROPRIÉTAIRE du rendez-vous (`appointment.coachId`).
   * Sinon le titre de secours s'applique : un navigateur d'élève ne peut pas
   * lire `coaches` (policy `coaches_select_staff`, migration 20260726220000),
   * donc il n'a aucun moyen de nommer un autre coach — et il ne doit surtout
   * pas retomber sur le coach principal.
   */
  coachTitulaireId: string | null;
  onCancel?: (reason: string) => void;
}) {
  const [showCancelForm, setShowCancelForm] = useState(false);
  const isActive = appointment.status === "pending" || appointment.status === "confirmed";

  function handleDownloadIcs() {
    /*
     * ⚠️ MÊME INTITULÉ QUE L'INVITATION REÇUE PAR EMAIL. Ce bouton produisait
     * `appointment.title`, soit « Coaching en salle » : l'élève téléchargeait
     * un titre différent de celui que son agenda avait reçu.
     */
    const proprietaireConnu = !!appointment.coachId && !!coachTitulaireId && appointment.coachId === coachTitulaireId;
    const titre = construireIntituleIcs({
      destinataire: "eleve",
      identiteEleve: "",
      identiteCoach: proprietaireConnu ? formaterIdentiteCoach(coachName) : "",
    });
    const ics = buildConfirmationIcs({
      uid: appointment.icsUid,
      title: titre,
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
          className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Download size={12} />
          Télécharger .ics
        </button>
        {isActive && onCancel && (
          <button
            type="button"
            onClick={() => setShowCancelForm((v) => !v)}
            className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/40 px-3 py-1.5 text-[11px] uppercase tracking-widest text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
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
