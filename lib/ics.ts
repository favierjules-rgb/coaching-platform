/**
 * Génération d'invitations calendrier .ics (RFC 5545), sans dépendance
 * externe. Utilisé pour la confirmation (METHOD:REQUEST) et l'annulation
 * (METHOD:CANCEL, STATUS:CANCELLED) d'un rendez-vous — voir
 * lib/supabase/appointments.ts et lib/email/appointment-emails.ts.
 *
 * Les horaires sont formatés en UTC (suffixe Z, dérivé de l'instant absolu
 * stocké en base) plutôt qu'avec un bloc VTIMEZONE complet : plus simple à
 * générer correctement, et interprété sans ambiguïté par Apple Calendar,
 * Google Calendar et Outlook (ils convertissent l'UTC vers le fuseau local
 * de l'utilisateur à l'affichage).
 */

export interface IcsAppointmentInput {
  uid: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
  organizerName: string;
  organizerEmail: string;
  attendeeName: string;
  attendeeEmail: string;
  /** Incrémenté à chaque mise à jour du même événement (report, annulation) — RFC 5545 SEQUENCE. */
  sequence?: number;
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatUtc(dateIso: string): string {
  return new Date(dateIso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** Découpe les lignes > 75 octets selon le "folding" requis par RFC 5545. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  parts.push(rest);
  return parts.join("\r\n");
}

function buildEvent(input: IcsAppointmentInput, status: "CONFIRMED" | "CANCELLED", method: "REQUEST" | "CANCEL"): string {
  const nowStamp = formatUtc(new Date().toISOString());
  const lines = [
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${nowStamp}`,
    `DTSTART:${formatUtc(input.startAt)}`,
    `DTEND:${formatUtc(input.endAt)}`,
    `SUMMARY:${escapeIcsText(input.title)}`,
    `DESCRIPTION:${escapeIcsText(input.description)}`,
    input.location ? `LOCATION:${escapeIcsText(input.location)}` : null,
    input.meetingUrl ? `URL:${escapeIcsText(input.meetingUrl)}` : null,
    `ORGANIZER;CN=${escapeIcsText(input.organizerName)}:mailto:${input.organizerEmail}`,
    `ATTENDEE;CN=${escapeIcsText(input.attendeeName)};RSVP=TRUE:mailto:${input.attendeeEmail}`,
    `STATUS:${status}`,
    `SEQUENCE:${input.sequence ?? 0}`,
    method === "CANCEL" ? "METHOD:CANCEL" : null,
    "END:VEVENT",
  ].filter((line): line is string => line !== null);
  return lines.map(foldLine).join("\r\n");
}

/** Invitation de confirmation (nouveau rendez-vous ou report). */
export function buildConfirmationIcs(input: IcsAppointmentInput): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seth Coaching//Booking//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    buildEvent(input, "CONFIRMED", "REQUEST"),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Invitation d'annulation — même UID, SEQUENCE incrémentée, STATUS:CANCELLED. */
export function buildCancellationIcs(input: IcsAppointmentInput): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Seth Coaching//Booking//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:CANCEL",
    buildEvent({ ...input, sequence: (input.sequence ?? 0) + 1 }, "CANCELLED", "CANCEL"),
    "END:VCALENDAR",
  ].join("\r\n");
}

/** Déclenche le téléchargement d'un fichier .ics côté navigateur. */
export function downloadIcsFile(icsContent: string, filename: string): void {
  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".ics") ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
