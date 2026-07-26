/**
 * View-model pur des événements du calendrier admin (chantier
 * "admin-apple-calendar") : convertit les rendez-vous (`appointments`) et
 * les événements du coach (`coach_unavailabilities` étendue) en une liste
 * homogène positionnable par lib/calendar-grid.ts.
 *
 * Chaque nature d'événement est distinguée par `kind` — les composants
 * doivent la traduire par des différences de FORME (bordure, hachures,
 * icône, barré), jamais uniquement par la couleur (identité monochrome +
 * accessibilité). Testé dans scripts/tests/calendar-events.mts.
 */

import type { CalendarEventInput } from "@/lib/calendar-grid";
import type { AdminAppointment, CoachUnavailability } from "@/types";

export type AdminCalendarEventKind =
  | "student" // RDV élève pending/confirmed
  | "student_cancelled" // RDV élève annulé (visible, barré, ne bloque plus)
  | "personal" // événement personnel de l'admin (privé)
  | "professional" // événement professionnel de l'admin (privé)
  | "unavailability"; // indisponibilité simple (onglet Disponibilités)

export interface AdminCalendarEvent extends CalendarEventInput {
  kind: AdminCalendarEventKind;
  /** Titre affiché dans la grille. */
  title: string;
  /** Complément (élève, type de RDV…). */
  subtitle: string;
  location: string;
  /** Source : exactement l'un des deux. */
  appointment?: AdminAppointment;
  coachEvent?: CoachUnavailability;
}

export const CALENDAR_KIND_LABELS: Record<AdminCalendarEventKind, string> = {
  student: "Rendez-vous élève",
  student_cancelled: "Rendez-vous annulé",
  personal: "Événement personnel",
  professional: "Événement professionnel",
  unavailability: "Indisponibilité",
};

/** Un RDV élève terminé/no-show reste affiché comme RDV (l'historique est porté par la date). */
export function appointmentKind(appointment: AdminAppointment): AdminCalendarEventKind {
  return appointment.status === "cancelled" ? "student_cancelled" : "student";
}

export function appointmentToCalendarEvent(
  appointment: AdminAppointment,
  studentName: string,
): AdminCalendarEvent {
  return {
    id: `appointment:${appointment.id}`,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    allDay: false,
    kind: appointmentKind(appointment),
    title: appointment.title || appointment.appointmentType,
    subtitle: studentName,
    location: appointment.location,
    appointment,
  };
}

export function coachEventToCalendarEvent(event: CoachUnavailability): AdminCalendarEvent {
  const kind: AdminCalendarEventKind =
    event.category === "personal" ? "personal" : event.category === "professional" ? "professional" : "unavailability";
  return {
    id: `coach-event:${event.id}`,
    startAt: event.startAt,
    endAt: event.endAt,
    allDay: event.allDay,
    kind,
    title: event.title || (kind === "unavailability" ? event.reason || "Indisponibilité" : CALENDAR_KIND_LABELS[kind]),
    subtitle: "",
    location: event.location,
    coachEvent: event,
  };
}

export interface BuildCalendarEventsParams {
  appointments: AdminAppointment[];
  coachEvents: CoachUnavailability[];
  /** Nom affiché par élève (fullName) — repli "Élève" si absent. */
  studentNameById: Map<string, string>;
  /** Afficher aussi les RDV annulés (visibles mais non bloquants). */
  includeCancelled: boolean;
}

/** Liste homogène, triée par début, prête pour lib/calendar-grid. */
export function buildCalendarEvents(params: BuildCalendarEventsParams): AdminCalendarEvent[] {
  const events: AdminCalendarEvent[] = [];
  for (const appointment of params.appointments) {
    if (appointment.status === "cancelled" && !params.includeCancelled) continue;
    const studentName = appointment.studentId ? params.studentNameById.get(appointment.studentId) ?? "Élève" : "Élève";
    events.push(appointmentToCalendarEvent(appointment, studentName));
  }
  for (const coachEvent of params.coachEvents) {
    events.push(coachEventToCalendarEvent(coachEvent));
  }
  return events.sort((a, b) => a.startAt.localeCompare(b.startAt) || a.id.localeCompare(b.id));
}

/**
 * Périodes occupées côté client (contrôle UI de pré-validation — la garantie
 * réelle est côté serveur/base, voir RPC `create_appointment_checked`).
 * Règle métier : seuls les RDV pending/confirmed et TOUS les événements du
 * coach bloquent ; un RDV annulé libère son créneau.
 */
export function busyPeriodsFrom(
  appointments: AdminAppointment[],
  coachEvents: CoachUnavailability[],
): { id: string; startAt: string; endAt: string }[] {
  const busy: { id: string; startAt: string; endAt: string }[] = [];
  for (const a of appointments) {
    if (a.status === "pending" || a.status === "confirmed") {
      busy.push({ id: `appointment:${a.id}`, startAt: a.startAt, endAt: a.endAt });
    }
  }
  for (const e of coachEvents) {
    busy.push({ id: `coach-event:${e.id}`, startAt: e.startAt, endAt: e.endAt });
  }
  return busy;
}
