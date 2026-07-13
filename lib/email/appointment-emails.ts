/**
 * Déclencheurs d'emails de rendez-vous, appelés depuis du code client-bundlé
 * (`lib/supabase/appointments.ts::notifyAppointmentConfirmation/Cancellation/Reschedule`,
 * elles-mêmes appelées depuis `app/(student)/rendez-vous/page.tsx` et
 * `app/admin/calendrier/page.tsx` — écriture directe en base via RLS,
 * comme partout ailleurs dans ce repo). Ce fichier ne compose ni n'envoie
 * plus rien lui-même (aucune dépendance à Resend, jamais de clé API ici) :
 * il se contente de notifier `POST /api/email/appointment-notification`
 * (chantier "supabase-resend-transactional-emails"), seul endroit
 * server-only où l'envoi réel a lieu — la route relit l'état du rendez-vous
 * en base (confirmé/annulé/reporté) plutôt que de faire confiance au
 * contenu construit ici.
 *
 * Signatures inchangées par rapport à la version précédente (stub sans
 * provider réel) pour ne rien casser côté appelants.
 */

export interface AppointmentEmailContext {
  appointmentId: string;
  icsUid: string;
  title: string;
  description: string;
  appointmentType: string;
  startAt: string;
  endAt: string;
  location: string;
  meetingUrl: string;
  studentFirstName: string;
  studentEmail: string;
  coachName: string;
  coachEmail: string;
}

export interface EmailSendResult {
  sent: boolean;
  reason?: string;
}

async function notifyAppointmentNotificationRoute(appointmentId: string): Promise<EmailSendResult> {
  try {
    const response = await fetch("/api/email/appointment-notification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId }),
    });
    if (!response.ok) {
      return { sent: false, reason: `http_${response.status}` };
    }
    return { sent: true };
  } catch {
    return { sent: false, reason: "network_error" };
  }
}

export async function sendAppointmentConfirmationEmail(
  _supabase: unknown,
  ctx: AppointmentEmailContext,
): Promise<EmailSendResult> {
  return notifyAppointmentNotificationRoute(ctx.appointmentId);
}

export async function sendAppointmentCancellationEmail(
  _supabase: unknown,
  ctx: AppointmentEmailContext,
): Promise<EmailSendResult> {
  return notifyAppointmentNotificationRoute(ctx.appointmentId);
}

export async function sendAppointmentRescheduleEmail(
  _supabase: unknown,
  ctx: AppointmentEmailContext,
): Promise<EmailSendResult> {
  return notifyAppointmentNotificationRoute(ctx.appointmentId);
}
