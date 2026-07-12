import { NextResponse } from "next/server";

import { composeAppointmentReminderEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAllAppointments, getPrimaryCoachInfo } from "@/lib/supabase/appointments";
import { getStudentById } from "@/lib/supabase/students";

/**
 * GET /api/cron/appointment-reminders — envoie les rappels de rendez-vous
 * à 24h et 2h de l'échéance (chantier "supabase-resend-transactional-emails",
 * type `appointment_reminder`). Aucune infrastructure de tâche planifiée
 * n'existait avant ce chantier : cette route est le point d'entrée à
 * appeler périodiquement (voir vercel.json — cron horaire — et
 * docs/resend-transactional-emails.md pour la configuration complète).
 *
 * Sécurité : réservée à l'appel du cron lui-même, jamais publique.
 * Vercel Cron envoie automatiquement `Authorization: Bearer $CRON_SECRET`
 * quand `CRON_SECRET` est configuré (voir .env.example) — toute autre
 * requête est rejetée. Si `CRON_SECRET` n'est pas configuré, la route
 * refuse tout appel plutôt que de rester ouverte par défaut.
 *
 * Idempotence : un rappel à 24h et un rappel à 2h pour le **même**
 * rendez-vous sont deux envois distincts (fenêtres horaires différentes),
 * mais un rappel déjà envoyé pour une fenêtre donnée n'est jamais renvoyé
 * (vérifié via `email_logs.metadata.reminderHours`).
 */

const REMINDER_WINDOWS: { hoursBefore: 24 | 2; toleranceMinutes: number }[] = [
  { hoursBefore: 24, toleranceMinutes: 35 },
  { hoursBefore: 2, toleranceMinutes: 35 },
];

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET non configuré." }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const now = Date.now();

  const [appointments, coach] = await Promise.all([getAllAppointments(supabase), getPrimaryCoachInfo(supabase)]);
  const upcoming = appointments.filter((a) => (a.status === "pending" || a.status === "confirmed") && new Date(a.startAt).getTime() > now);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const appointment of upcoming) {
    const hoursUntil = (new Date(appointment.startAt).getTime() - now) / (1000 * 60 * 60);

    for (const window of REMINDER_WINDOWS) {
      const toleranceHours = window.toleranceMinutes / 60;
      if (Math.abs(hoursUntil - window.hoursBefore) > toleranceHours) continue;
      if (!appointment.studentId) continue;

      const { data: existingLogs } = await supabase
        .from("email_logs")
        .select("metadata")
        .eq("email_type", "appointment_reminder")
        .eq("related_entity_type", "appointment")
        .eq("related_entity_id", appointment.id)
        .eq("status", "sent");
      const alreadySentForWindow = (existingLogs ?? []).some(
        (log) => (log.metadata as { reminderHours?: number } | null)?.reminderHours === window.hoursBefore,
      );
      if (alreadySentForWindow) {
        skipped++;
        continue;
      }

      const student = await getStudentById(supabase, appointment.studentId);
      if (!student?.email) {
        skipped++;
        continue;
      }

      const email = composeAppointmentReminderEmail({
        firstName: student.firstName,
        appointmentType: appointment.appointmentType,
        startAt: appointment.startAt,
        location: appointment.location,
        meetingUrl: appointment.meetingUrl,
        hoursBefore: window.hoursBefore,
        appointmentUrl: `${appUrl}/rendez-vous`,
      });

      const result = await sendTransactionalEmail(supabase, {
        emailType: "appointment_reminder",
        recipientEmail: student.email,
        recipientUserId: student.userId,
        subject: email.subject,
        html: email.html,
        text: email.text,
        relatedEntityType: "appointment",
        relatedEntityId: appointment.id,
        metadata: { reminderHours: window.hoursBefore, coachEmail: coach.email },
      });

      if (result.status === "sent") sent++;
      else if (result.status === "failed") failed++;
      else skipped++;
    }
  }

  return NextResponse.json({ status: "ok", checked: upcoming.length, sent, skipped, failed });
}
