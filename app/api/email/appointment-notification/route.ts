import { NextResponse } from "next/server";

import {
  composeAppointmentCancelledEmail,
  composeAppointmentCreatedCoachEmail,
  composeAppointmentCreatedStudentEmail,
} from "@/lib/email/templates";
import { sendTransactionalEmail, wasEmailRecentlySent } from "@/lib/email/send-transactional-email";
import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput } from "@/lib/ics";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getAppointmentById, getPrimaryCoachInfo } from "@/lib/supabase/appointments";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getStudentById } from "@/lib/supabase/students";
import type { EmailType } from "@/types";
import { parseJsonBody } from "@/lib/api/validate";
import { appointmentNotificationBodySchema } from "@/lib/api/schemas/email";

/**
 * POST /api/email/appointment-notification — envoie l'email de
 * confirmation/annulation/report de rendez-vous, à l'élève ET au coach
 * (chantier "supabase-resend-transactional-emails"). Remplace le stub
 * `dispatchEmail` de lib/email/appointment-emails.ts, appelé depuis du code
 * client-bundlé (`createAppointment`/`cancelAppointment`/
 * `rescheduleAppointment` s'exécutent dans le navigateur, RLS directe) —
 * cette route est donc le seul point où la clé Resend est réellement
 * utilisée pour ce flux.
 *
 * Body : `{ appointmentId }` uniquement. Le sujet/contenu de l'email n'est
 * jamais fourni par le client : l'état réel du rendez-vous (confirmé,
 * annulé, reporté — déduit de `appointments.status`/`rescheduled_from_id`)
 * est relu côté serveur, ainsi que les emails élève/coach.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, appointmentNotificationBodySchema);
  if (!parsed.success) return parsed.response;
  const { appointmentId } = parsed.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  const adminSupabase = createSupabaseAdminClient();
  if (!adminSupabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const appointment = await getAppointmentById(adminSupabase, appointmentId);
  if (!appointment?.studentId) {
    return NextResponse.json({ error: "Rendez-vous introuvable." }, { status: 404 });
  }

  const role = await getCurrentUserRole();
  if (role === "student") {
    const ownStudentId = await getCurrentStudentId(sessionSupabase);
    if (!ownStudentId || ownStudentId !== appointment.studentId) {
      return NextResponse.json({ error: "Accès refusé à ce rendez-vous." }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const [student, coach] = await Promise.all([
    getStudentById(adminSupabase, appointment.studentId),
    getPrimaryCoachInfo(adminSupabase),
  ]);

  const isCancelled = appointment.status === "cancelled";
  const isReschedule = !isCancelled && !!appointment.rescheduledFromId;
  const emailType: EmailType = isCancelled ? "appointment_cancelled" : "appointment_created";

  const alreadySent = await wasEmailRecentlySent(adminSupabase, {
    emailType,
    relatedEntityType: "appointment",
    relatedEntityId: appointment.id,
  });
  if (alreadySent) {
    return NextResponse.json({ status: "skipped", reason: "already_sent_recently" });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const icsInput: IcsAppointmentInput = {
    uid: appointment.icsUid,
    title: appointment.title || appointment.appointmentType,
    description: appointment.description,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    location: appointment.location,
    meetingUrl: appointment.meetingUrl,
    organizerName: coach.name,
    organizerEmail: coach.email,
    attendeeName: student?.firstName ?? "",
    attendeeEmail: student?.email ?? "",
  };
  const icsContent = isCancelled ? buildCancellationIcs(icsInput) : buildConfirmationIcs(icsInput);
  const attachments = [{ filename: "rendez-vous.ics", content: icsContent, contentType: "text/calendar" }];

  const results: { recipient: string; status: string }[] = [];

  if (student?.email) {
    const email = isCancelled
      ? composeAppointmentCancelledEmail({
          recipientFirstName: student.firstName,
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          profileOrCalendarUrl: `${appUrl}/rendez-vous`,
        })
      : composeAppointmentCreatedStudentEmail({
          firstName: student.firstName,
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          location: appointment.location,
          meetingUrl: appointment.meetingUrl,
          coachName: coach.name,
          appointmentUrl: `${appUrl}/rendez-vous`,
          isReschedule,
        });
    const result = await sendTransactionalEmail(adminSupabase, {
      emailType,
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "appointment",
      relatedEntityId: appointment.id,
      metadata: { role: "student", appointmentType: appointment.appointmentType },
      attachments,
    });
    results.push({ recipient: "student", status: result.status });
  }

  if (coach.email) {
    const email = isCancelled
      ? composeAppointmentCancelledEmail({
          recipientFirstName: coach.name,
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          profileOrCalendarUrl: `${appUrl}/admin/calendrier`,
        })
      : composeAppointmentCreatedCoachEmail({
          coachFirstName: coach.name,
          studentName: student ? `${student.firstName} ${student.lastName}`.trim() : "Un élève",
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          appointmentUrl: `${appUrl}/admin/calendrier`,
          isReschedule,
        });
    const result = await sendTransactionalEmail(adminSupabase, {
      emailType,
      recipientEmail: coach.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "appointment",
      relatedEntityId: appointment.id,
      metadata: { role: "coach", appointmentType: appointment.appointmentType },
      attachments,
    });
    results.push({ recipient: "coach", status: result.status });
  }

  return NextResponse.json({ status: "ok", results });
}
