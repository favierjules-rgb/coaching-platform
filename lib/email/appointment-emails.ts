import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput } from "@/lib/ics";
import type { Database } from "@/types/supabase";

/**
 * Abstraction d'envoi d'email pour les rendez-vous. Aucun provider email
 * n'existe ailleurs dans le repo (audit : aucune occurrence de Resend/
 * SendGrid/nodemailer/SMTP) — ce fichier prépare l'intégration proprement
 * sans bloquer le chantier calendrier :
 *
 * - `sendAppointmentConfirmationEmail` / `sendAppointmentCancellationEmail` /
 *   `sendAppointmentRescheduleEmail` construisent le sujet/corps/`.ics` et
 *   appellent `dispatchEmail`, qui journalise toujours dans
 *   `appointment_email_logs` (voir supabase/schema.sql) et retourne
 *   `sent: false` tant qu'aucun provider réel n'est branché.
 * - Pour brancher un vrai envoi plus tard : remplacer le corps de
 *   `dispatchEmail` par un appel Resend/SendGrid, ou par l'invocation d'une
 *   Supabase Edge Function dédiée (recommandé pour garder la clé API côté
 *   serveur). Le reste du fichier (contenu, .ics, journalisation) n'a pas à
 *   changer.
 *
 * Tant que l'envoi réel n'est pas branché, l'UI ne dépend jamais du succès
 * de l'email : le bouton "Télécharger l'invitation calendrier (.ics)" (voir
 * components/*Appointment*) fonctionne indépendamment.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

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

function formatDateTimeFr(dateIso: string): { date: string; time: string } {
  const d = new Date(dateIso);
  return {
    date: d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
    time: d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }),
  };
}

function icsInputFrom(ctx: AppointmentEmailContext): IcsAppointmentInput {
  return {
    uid: ctx.icsUid,
    title: ctx.title,
    description: ctx.description,
    startAt: ctx.startAt,
    endAt: ctx.endAt,
    location: ctx.location,
    meetingUrl: ctx.meetingUrl,
    organizerName: ctx.coachName,
    organizerEmail: ctx.coachEmail,
    attendeeName: ctx.studentFirstName,
    attendeeEmail: ctx.studentEmail,
  };
}

interface ComposedEmail {
  subject: string;
  body: string;
  icsContent: string;
}

/**
 * Point d'intégration futur pour un vrai provider email. Reçoit le contenu
 * déjà composé (sujet, corps, .ics) pour qu'un branchement Resend/SendGrid/
 * Edge Function n'ait qu'à remplacer l'intérieur de cette fonction — le
 * reste du fichier n'a pas à changer. Retourne toujours `sent: false`
 * aujourd'hui (aucun provider configuré) — journalise néanmoins la
 * tentative pour garder une trace exploitable une fois un provider branché.
 */
async function dispatchEmail(
  supabase: TypedSupabaseClient | null,
  appointmentId: string,
  recipientEmail: string,
  type: "confirmation" | "cancellation" | "reschedule",
  email: ComposedEmail,
): Promise<EmailSendResult> {
  if (process.env.NODE_ENV !== "production") {
    console.info(`[email:${type}] (non envoyé — aucun provider configuré) à ${recipientEmail} : "${email.subject}"`);
  }
  const result: EmailSendResult = { sent: false, reason: "no_email_provider_configured" };
  if (supabase) {
    await supabase.from("appointment_email_logs").insert({
      appointment_id: appointmentId,
      recipient_email: recipientEmail,
      type,
      status: "not_configured",
      error: "Aucun provider email configuré — voir lib/email/appointment-emails.ts",
    });
  }
  return result;
}

function composeConfirmationEmail(ctx: AppointmentEmailContext): ComposedEmail {
  const { date, time } = formatDateTimeFr(ctx.startAt);
  return {
    subject: `Confirmation de rendez-vous — ${ctx.appointmentType} — ${date}`,
    body: `Bonjour ${ctx.studentFirstName},\nTon rendez-vous est confirmé :\n- Date : ${date}\n- Heure : ${time}\n- Lieu ou lien visio : ${ctx.location || ctx.meetingUrl || "à confirmer"}\n- Coach : ${ctx.coachName}\nTu peux ajouter ce rendez-vous à ton calendrier avec l'invitation jointe.`,
    icsContent: buildConfirmationIcs(icsInputFrom(ctx)),
  };
}

export async function sendAppointmentConfirmationEmail(
  supabase: TypedSupabaseClient | null,
  ctx: AppointmentEmailContext,
): Promise<EmailSendResult> {
  return dispatchEmail(supabase, ctx.appointmentId, ctx.studentEmail, "confirmation", composeConfirmationEmail(ctx));
}

export async function sendAppointmentCancellationEmail(
  supabase: TypedSupabaseClient | null,
  ctx: AppointmentEmailContext,
): Promise<EmailSendResult> {
  const { date, time } = formatDateTimeFr(ctx.startAt);
  const email: ComposedEmail = {
    subject: `Rendez-vous annulé — ${ctx.appointmentType} — ${date}`,
    body: `Bonjour ${ctx.studentFirstName},\nTon rendez-vous du ${date} à ${time} a été annulé.\nContacte ton coach pour en reprogrammer un si besoin.`,
    icsContent: buildCancellationIcs(icsInputFrom(ctx)),
  };
  return dispatchEmail(supabase, ctx.appointmentId, ctx.studentEmail, "cancellation", email);
}

export async function sendAppointmentRescheduleEmail(
  supabase: TypedSupabaseClient | null,
  ctx: AppointmentEmailContext,
): Promise<EmailSendResult> {
  const composed = composeConfirmationEmail(ctx);
  const email: ComposedEmail = { ...composed, subject: composed.subject.replace("Confirmation", "Report") };
  return dispatchEmail(supabase, ctx.appointmentId, ctx.studentEmail, "reschedule", email);
}
