"use client";

import { useState } from "react";
import { AlertCircle, Trash2 } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import type { AdminCalendarEvent } from "@/lib/admin-calendar-events";
import { CALENDAR_KIND_LABELS } from "@/lib/admin-calendar-events";
import { findConflict } from "@/lib/calendar-grid";
import { fullName } from "@/lib/admin";
import { appointmentTypes } from "@/types";
import type { AdminStudent, AppointmentType, CoachEventCategory } from "@/types";

/**
 * Modale de création / détail du calendrier admin (chantier
 * "admin-apple-calendar").
 *
 * Création — 3 natures :
 *  - RDV élève : élève OBLIGATOIRE (liste réelle), type, durée, lieu, visio ;
 *  - événement personnel / professionnel : titre, plage ou toute la journée,
 *    lieu et notes PRIVÉS (jamais visibles élève).
 * Détail :
 *  - RDV élève : annulation avec motif obligatoire (le RDV n'est JAMAIS
 *    supprimé — statut cancelled, logique existante préservée) ;
 *  - événement privé : modification ou suppression réelle (avec confirmation).
 *
 * Le contrôle de chevauchement UI (findConflict sur les périodes occupées de
 * la période chargée) est une pré-validation de confort : la garantie réelle
 * est côté serveur (RPC + contrainte d'exclusion).
 */

export type CalendarCreateKind = "student" | "personal" | "professional";

export interface CalendarEventSaveData {
  kind: CalendarCreateKind;
  /** RDV élève uniquement. */
  studentId?: string;
  appointmentType?: AppointmentType;
  meetingUrl?: string;
  description?: string;
  /** Événements privés uniquement. */
  category?: CoachEventCategory;
  notes?: string;
  allDay?: boolean;
  /** Commun. */
  title: string;
  location: string;
  startAt: string;
  endAt: string;
  /** Id de l'événement modifié (édition d'un événement privé), sinon création. */
  editedCoachEventId?: string;
}

interface BusyPeriod {
  id: string;
  startAt: string;
  endAt: string;
}

const KIND_OPTIONS: { value: CalendarCreateKind; label: string }[] = [
  { value: "student", label: "Rendez-vous élève" },
  { value: "personal", label: "Événement personnel (privé)" },
  { value: "professional", label: "Événement professionnel (privé)" },
];

function toDateInputValue(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toTimeInputValue(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" });
}

/* ─── Création / édition ─── */

export function CalendarEventFormModal({
  students,
  defaultDurationMinutes,
  busyPeriods,
  initialStart,
  editedEvent,
  prefilledStudent,
  onSave,
  onClose,
}: {
  students: AdminStudent[];
  defaultDurationMinutes: number;
  /** Périodes occupées (RDV bloquants + événements coach) pour la pré-validation UI. */
  busyPeriods: BusyPeriod[];
  /** Début proposé (clic zone vide / créneau de l'aperçu). */
  initialStart: Date;
  /** Événement privé en cours de modification (sinon création). */
  editedEvent?: AdminCalendarEvent;
  /** Préremplissage RDV élève (aperçu des créneaux) : type + lieu du créneau choisi. */
  prefilledStudent?: { appointmentType: AppointmentType; location: string; durationMinutes: number };
  onSave: (data: CalendarEventSaveData) => Promise<{ ok: boolean; message?: string }>;
  onClose: () => void;
}) {
  const editedCoach = editedEvent?.coachEvent;
  const [kind, setKind] = useState<CalendarCreateKind>(
    editedCoach ? (editedCoach.category === "professional" ? "professional" : "personal") : prefilledStudent ? "student" : "student",
  );
  const [studentId, setStudentId] = useState(students[0]?.id ?? "");
  const [appointmentType, setAppointmentType] = useState<AppointmentType>(
    prefilledStudent?.appointmentType ?? "Coaching en salle",
  );
  const [title, setTitle] = useState(editedCoach?.title ?? "");
  const [date, setDate] = useState(toDateInputValue(initialStart));
  const [startTime, setStartTime] = useState(toTimeInputValue(initialStart));
  const [durationMinutes, setDurationMinutes] = useState(
    editedCoach
      ? Math.max(15, Math.round((new Date(editedCoach.endAt).getTime() - new Date(editedCoach.startAt).getTime()) / 60_000))
      : prefilledStudent?.durationMinutes ?? defaultDurationMinutes,
  );
  const [allDay, setAllDay] = useState(editedCoach?.allDay ?? false);
  const [location, setLocation] = useState(editedCoach?.location ?? prefilledStudent?.location ?? "");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState(editedCoach?.notes ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEdit = Boolean(editedCoach);

  async function handleSave() {
    if (submitting) return;
    setFormError(null);
    if (kind === "student" && !studentId) {
      setFormError("Choisis un élève pour ce rendez-vous.");
      return;
    }
    if (kind !== "student" && !title.trim()) {
      setFormError("Donne un titre à cet événement.");
      return;
    }
    let start: Date;
    let end: Date;
    if (kind !== "student" && allDay) {
      const [y, m, d] = date.split("-").map(Number);
      start = new Date(y, m - 1, d);
      end = new Date(y, m - 1, d + 1);
    } else {
      start = new Date(`${date}T${startTime}:00`);
      if (Number.isNaN(start.getTime())) {
        setFormError("Date ou heure invalide.");
        return;
      }
      end = new Date(start.getTime() + Math.max(15, durationMinutes) * 60_000);
    }

    // Pré-validation UI de chevauchement (règle : début < fin existante ET fin > début existant).
    const conflict = findConflict(start.toISOString(), end.toISOString(), busyPeriods, editedEvent?.id);
    if (conflict) {
      setFormError(
        `Ce créneau chevauche une période déjà occupée (${formatDateTime(conflict.startAt)}). Choisis un autre horaire.`,
      );
      return;
    }

    setSubmitting(true);
    const result = await onSave({
      kind,
      studentId: kind === "student" ? studentId : undefined,
      appointmentType: kind === "student" ? appointmentType : undefined,
      meetingUrl: kind === "student" ? meetingUrl.trim() : undefined,
      description: kind === "student" ? description.trim() : undefined,
      category: kind === "student" ? undefined : kind,
      notes: kind === "student" ? undefined : notes.trim(),
      allDay: kind === "student" ? undefined : allDay,
      title: kind === "student" ? title.trim() || appointmentType : title.trim(),
      location: location.trim(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      editedCoachEventId: editedCoach?.id,
    });
    setSubmitting(false);
    if (result.ok) {
      onClose();
    } else {
      setFormError(result.message ?? "Enregistrement impossible. Réessaie.");
    }
  }

  return (
    <Modal title={isEdit ? "Modifier l'événement" : "Créer un événement"} onClose={onClose} maxWidth="max-w-lg">
      <div className="flex flex-col gap-4">
        {!isEdit && (
          <SelectField
            label="Nature"
            value={kind}
            onChange={(v) => setKind(v as CalendarCreateKind)}
            options={KIND_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          />
        )}

        {kind === "student" ? (
          students.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun élève disponible pour le moment.</p>
          ) : (
            <>
              <SelectField
                label="Élève"
                value={studentId}
                onChange={setStudentId}
                options={students.map((s) => ({ value: s.id, label: fullName(s) }))}
              />
              <SelectField
                label="Type de rendez-vous"
                value={appointmentType}
                onChange={(v) => setAppointmentType(v as AppointmentType)}
                options={appointmentTypes.map((t) => ({ value: t, label: t }))}
              />
              <Field label="Titre (optionnel)" value={title} onChange={setTitle} placeholder={appointmentType} />
            </>
          )
        ) : (
          <>
            <Field
              label="Titre (privé, jamais visible par les élèves)"
              value={title}
              onChange={setTitle}
              placeholder={kind === "personal" ? "Rendez-vous médical…" : "Formation, réunion…"}
            />
            <CheckboxField label="Toute la journée" checked={allDay} onChange={setAllDay} />
          </>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Date" type="date" value={date} onChange={setDate} />
          {!(kind !== "student" && allDay) && (
            <>
              <Field label="Heure de début" type="time" value={startTime} onChange={setStartTime} />
              <Field
                label="Durée (min)"
                type="number"
                value={String(durationMinutes)}
                onChange={(v) => setDurationMinutes(Number(v) || defaultDurationMinutes)}
              />
            </>
          )}
        </div>

        {kind === "student" ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Lieu" value={location} onChange={setLocation} placeholder="Salle, adresse..." />
              <Field label="Lien visio" value={meetingUrl} onChange={setMeetingUrl} placeholder="https://..." />
            </div>
            <TextareaField label="Description" value={description} onChange={setDescription} rows={2} />
          </>
        ) : (
          <>
            <Field label="Lieu (privé, optionnel)" value={location} onChange={setLocation} placeholder="Adresse..." />
            <TextareaField label="Notes (privées)" value={notes} onChange={setNotes} rows={2} />
            <p className="text-xs text-muted-foreground">
              Cet événement bloque les créneaux de réservation des élèves, mais son contenu reste visible uniquement par toi.
            </p>
          </>
        )}

        {formError && (
          <p role="alert" className="flex items-start gap-2 rounded-panel border border-border bg-surface-soft/60 px-3 py-2 text-sm text-foreground">
            <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
            {formError}
          </p>
        )}

        <PrimaryButton onClick={handleSave} disabled={submitting}>
          {submitting ? "Enregistrement…" : isEdit ? "Enregistrer les modifications" : "Créer l'événement"}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

/* ─── Détail / annulation / suppression ─── */

export function CalendarEventDetailModal({
  event,
  studentName,
  onCancelAppointment,
  onRescheduleAppointment,
  onEditCoachEvent,
  onDeleteCoachEvent,
  onClose,
}: {
  event: AdminCalendarEvent;
  studentName: string | null;
  /** RDV élève : annulation avec motif (jamais de suppression). */
  onCancelAppointment: (reason: string) => Promise<void>;
  /** RDV élève : report vers un nouveau créneau (RPC atomique — refusé si conflit). */
  onRescheduleAppointment: (newStartAt: string, newEndAt: string) => Promise<{ ok: boolean; message?: string }>;
  /** Événement privé : ouvrir le formulaire de modification. */
  onEditCoachEvent: () => void;
  /** Événement privé : suppression réelle (après confirmation). */
  onDeleteCoachEvent: () => Promise<void>;
  onClose: () => void;
}) {
  const [cancelReason, setCancelReason] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState(() => toDateInputValue(new Date(event.startAt)));
  const [rescheduleTime, setRescheduleTime] = useState(() => toTimeInputValue(new Date(event.startAt)));
  const [rescheduleDuration, setRescheduleDuration] = useState(() =>
    Math.max(15, Math.round((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000)),
  );
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  const appointment = event.appointment;
  const coachEvent = event.coachEvent;
  const isActiveAppointment = appointment && (appointment.status === "pending" || appointment.status === "confirmed");

  return (
    <Modal title={CALENDAR_KIND_LABELS[event.kind]} onClose={onClose} maxWidth="max-w-md">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className={`font-heading text-lg font-bold text-foreground ${event.kind === "student_cancelled" ? "line-through" : ""}`}>
            {event.title}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {event.allDay
              ? `${new Date(event.startAt).toLocaleDateString("fr-FR", { dateStyle: "full" })} · toute la journée`
              : `${formatDateTime(event.startAt)} → ${new Date(event.endAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`}
          </p>
          {studentName && <p className="mt-1 text-sm text-foreground">Élève : {studentName}</p>}
          {event.location && <p className="mt-1 text-sm text-muted-foreground">Lieu : {event.location}</p>}
          {appointment?.meetingUrl && <p className="mt-1 break-all text-sm text-muted-foreground">Visio : {appointment.meetingUrl}</p>}
          {appointment?.description && <p className="mt-2 text-sm text-foreground">{appointment.description}</p>}
          {coachEvent?.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{coachEvent.notes}</p>}
          {appointment?.status === "cancelled" && appointment.cancellationReason && (
            <p className="mt-2 text-sm text-muted-foreground">Motif d&apos;annulation : {appointment.cancellationReason}</p>
          )}
        </div>

        {isActiveAppointment && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {rescheduleOpen && (
              <>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Field label="Nouvelle date" type="date" value={rescheduleDate} onChange={setRescheduleDate} />
                  <Field label="Heure" type="time" value={rescheduleTime} onChange={setRescheduleTime} />
                  <Field
                    label="Durée (min)"
                    type="number"
                    value={String(rescheduleDuration)}
                    onChange={(v) => setRescheduleDuration(Number(v) || rescheduleDuration)}
                  />
                </div>
                {rescheduleError && (
                  <p role="alert" className="flex items-start gap-2 text-sm text-foreground">
                    <AlertCircle size={16} className="mt-0.5 flex-shrink-0" />
                    {rescheduleError}
                  </p>
                )}
                <div className="flex gap-2">
                  <PrimaryButton
                    onClick={async () => {
                      if (busy) return;
                      const start = new Date(`${rescheduleDate}T${rescheduleTime}:00`);
                      if (Number.isNaN(start.getTime())) {
                        setRescheduleError("Date ou heure invalide.");
                        return;
                      }
                      const end = new Date(start.getTime() + Math.max(15, rescheduleDuration) * 60_000);
                      setBusy(true);
                      const result = await onRescheduleAppointment(start.toISOString(), end.toISOString());
                      setBusy(false);
                      if (result.ok) {
                        onClose();
                      } else {
                        setRescheduleError(result.message ?? "Report impossible. Réessaie.");
                      }
                    }}
                    disabled={busy}
                  >
                    {busy ? "Report…" : "Confirmer le report"}
                  </PrimaryButton>
                  <OutlineButton onClick={() => setRescheduleOpen(false)}>Retour</OutlineButton>
                </div>
              </>
            )}
            {!rescheduleOpen && !cancelOpen && (
              <OutlineButton onClick={() => setRescheduleOpen(true)}>Reporter ce rendez-vous…</OutlineButton>
            )}
            {cancelOpen ? (
              <>
                <TextareaField label="Motif de l'annulation" value={cancelReason} onChange={setCancelReason} rows={2} placeholder="Expliqué à l'élève dans l'email d'annulation." />
                <div className="flex gap-2">
                  <PrimaryButton
                    onClick={async () => {
                      if (!cancelReason.trim() || busy) return;
                      setBusy(true);
                      await onCancelAppointment(cancelReason.trim());
                      setBusy(false);
                      onClose();
                    }}
                    disabled={busy || !cancelReason.trim()}
                  >
                    {busy ? "Annulation…" : "Confirmer l'annulation"}
                  </PrimaryButton>
                  <OutlineButton onClick={() => setCancelOpen(false)}>Retour</OutlineButton>
                </div>
              </>
            ) : !rescheduleOpen ? (
              <OutlineButton onClick={() => setCancelOpen(true)}>Annuler ce rendez-vous…</OutlineButton>
            ) : null}
          </div>
        )}

        {coachEvent && (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            {confirmDelete ? (
              <>
                <p className="text-sm text-foreground">Supprimer définitivement cet événement privé ? Les créneaux qu&apos;il bloquait redeviendront réservables.</p>
                <div className="flex gap-2">
                  <PrimaryButton
                    onClick={async () => {
                      if (busy) return;
                      setBusy(true);
                      await onDeleteCoachEvent();
                      setBusy(false);
                      onClose();
                    }}
                    disabled={busy}
                  >
                    {busy ? "Suppression…" : "Supprimer définitivement"}
                  </PrimaryButton>
                  <OutlineButton onClick={() => setConfirmDelete(false)}>Retour</OutlineButton>
                </div>
              </>
            ) : (
              <div className="flex flex-wrap gap-2">
                <OutlineButton onClick={onEditCoachEvent}>Modifier</OutlineButton>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Trash2 size={14} />
                  Supprimer
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
