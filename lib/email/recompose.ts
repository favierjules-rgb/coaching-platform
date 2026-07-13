import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput } from "@/lib/ics";
import { getAppointmentById, getPrimaryCoachInfo } from "@/lib/supabase/appointments";
import { getSubscriptionForStudent } from "@/lib/supabase/billing";
import { getStudentById, getStudentProfile } from "@/lib/supabase/students";
import { getSubscriptionTemplateById } from "@/lib/supabase/subscription-templates";
import type { EmailLog } from "@/types";
import type { Database } from "@/types/supabase";
import {
  composeAppointmentCancelledEmail,
  composeAppointmentCreatedCoachEmail,
  composeAppointmentCreatedStudentEmail,
  composeAppointmentReminderEmail,
  composeDocumentAssignedEmail,
  composeNutritionAssignedEmail,
  composePaymentFailedEmail,
  composePaymentSucceededEmail,
  composeProgramAssignedEmail,
  composeSubscriptionAssignedEmail,
  composeSubscriptionCancelledEmail,
  composeWelcomeEmail,
  type ComposedEmail,
} from "@/lib/email/templates";

type TypedSupabaseClient = SupabaseClient<Database>;

export interface RecomposedEmail extends ComposedEmail {
  attachments?: { filename: string; content: string; contentType?: string }[];
}

/**
 * Recompose le contenu d'un email déjà journalisé (chantier
 * "supabase-resend-transactional-emails"), à partir de son
 * `related_entity_type`/`related_entity_id`/`metadata` uniquement — jamais
 * de HTML stocké tel quel en base. Utilisé exclusivement par le bouton
 * admin "Renvoyer" (`app/api/admin/emails/[id]/resend/route.ts`), sur un
 * email dont le contenu et le destinataire ne changent pas : relit les
 * données à jour (ex : le montant ou le nom de formule peuvent différer
 * légèrement de l'email d'origine s'ils ont changé depuis, ce qui reste
 * préférable à un contenu obsolète). Renvoie `null` si l'entité liée
 * n'existe plus ou si le type n'est pas re-composable — l'appelant doit
 * alors refuser le renvoi plutôt que d'envoyer un email vide.
 */
export async function recomposeEmail(supabase: TypedSupabaseClient, log: EmailLog, appUrl: string): Promise<RecomposedEmail | null> {
  switch (log.emailType) {
    case "welcome": {
      const student = await getStudentById(supabase, log.relatedEntityId ?? "");
      if (!student) return null;
      return composeWelcomeEmail({ firstName: student.firstName, dashboardUrl: `${appUrl}/dashboard` });
    }

    case "subscription_assigned": {
      const studentId = log.relatedEntityId ?? "";
      const [student, profile] = await Promise.all([getStudentById(supabase, studentId), getStudentProfile(supabase, studentId)]);
      if (!student || !profile?.assignedSubscriptionTemplateId) return null;
      const template = await getSubscriptionTemplateById(supabase, profile.assignedSubscriptionTemplateId);
      if (!template) return null;
      return composeSubscriptionAssignedEmail({
        firstName: student.firstName,
        templateName: template.name,
        amountCents: template.amountCents,
        currency: template.currency,
        billingInterval: template.billingInterval,
        durationMonths: template.durationMonths,
        payUrl: `${appUrl}/profil`,
        profileUrl: `${appUrl}/profil`,
      });
    }

    case "program_assigned": {
      const contentId = log.metadata.contentId as string | undefined;
      const studentId = log.metadata.studentId as string | undefined;
      if (!contentId || !studentId) return null;
      const [student, program] = await Promise.all([
        getStudentById(supabase, studentId),
        supabase.from("programs").select("name").eq("id", contentId).maybeSingle(),
      ]);
      if (!student || !program.data) return null;
      return composeProgramAssignedEmail({
        firstName: student.firstName,
        programName: program.data.name,
        startDate: null,
        trainingUrl: `${appUrl}/entrainement`,
      });
    }

    case "nutrition_assigned": {
      const contentId = log.metadata.contentId as string | undefined;
      const studentId = log.metadata.studentId as string | undefined;
      if (!contentId || !studentId) return null;
      const [student, plan] = await Promise.all([
        getStudentById(supabase, studentId),
        supabase.from("nutrition_plans").select("name").eq("id", contentId).maybeSingle(),
      ]);
      if (!student || !plan.data) return null;
      return composeNutritionAssignedEmail({ firstName: student.firstName, planName: plan.data.name, nutritionUrl: `${appUrl}/nutrition` });
    }

    case "document_assigned": {
      const contentId = log.metadata.contentId as string | undefined;
      const studentId = log.metadata.studentId as string | undefined;
      if (!contentId || !studentId) return null;
      const [student, document] = await Promise.all([
        getStudentById(supabase, studentId),
        supabase.from("documents").select("title").eq("id", contentId).maybeSingle(),
      ]);
      if (!student || !document.data) return null;
      return composeDocumentAssignedEmail({ firstName: student.firstName, documentTitle: document.data.title, documentsUrl: `${appUrl}/documents` });
    }

    case "payment_succeeded": {
      const studentId = log.relatedEntityId ?? "";
      const [student, subscription] = await Promise.all([getStudentById(supabase, studentId), getSubscriptionForStudent(supabase, studentId)]);
      if (!student) return null;
      const amountCents = (log.metadata.amountCents as number) ?? subscription?.amountCents ?? 0;
      return composePaymentSucceededEmail({
        firstName: student.firstName,
        planName: subscription?.planName ?? "",
        amountCents,
        currency: subscription?.currency ?? "eur",
        dashboardUrl: `${appUrl}/dashboard`,
      });
    }

    case "payment_failed": {
      const studentId = log.relatedEntityId ?? "";
      const student = await getStudentById(supabase, studentId);
      if (!student) return null;
      return composePaymentFailedEmail({ firstName: student.firstName, portalUrl: `${appUrl}/profil`, profileUrl: `${appUrl}/profil` });
    }

    case "subscription_cancelled": {
      const studentId = log.relatedEntityId ?? "";
      const student = await getStudentById(supabase, studentId);
      if (!student) return null;
      return composeSubscriptionCancelledEmail({ firstName: student.firstName, accessEndDate: null, profileUrl: `${appUrl}/profil` });
    }

    case "appointment_created":
    case "appointment_cancelled": {
      const appointment = await getAppointmentById(supabase, log.relatedEntityId ?? "");
      if (!appointment?.studentId) return null;
      const [student, coach] = await Promise.all([getStudentById(supabase, appointment.studentId), getPrimaryCoachInfo(supabase)]);
      const isCancelled = log.emailType === "appointment_cancelled";
      const isCoachRecipient = log.metadata.role === "coach";
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
      const attachments = [
        {
          filename: "rendez-vous.ics",
          content: isCancelled ? buildCancellationIcs(icsInput) : buildConfirmationIcs(icsInput),
          contentType: "text/calendar",
        },
      ];
      if (isCancelled) {
        const composed = composeAppointmentCancelledEmail({
          recipientFirstName: isCoachRecipient ? coach.name : (student?.firstName ?? ""),
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          profileOrCalendarUrl: isCoachRecipient ? `${appUrl}/admin/calendrier` : `${appUrl}/rendez-vous`,
        });
        return { ...composed, attachments };
      }
      const composed = isCoachRecipient
        ? composeAppointmentCreatedCoachEmail({
            coachFirstName: coach.name,
            studentName: student ? `${student.firstName} ${student.lastName}`.trim() : "Un élève",
            appointmentType: appointment.appointmentType,
            startAt: appointment.startAt,
            appointmentUrl: `${appUrl}/admin/calendrier`,
            isReschedule: !!appointment.rescheduledFromId,
          })
        : composeAppointmentCreatedStudentEmail({
            firstName: student?.firstName ?? "",
            appointmentType: appointment.appointmentType,
            startAt: appointment.startAt,
            location: appointment.location,
            meetingUrl: appointment.meetingUrl,
            coachName: coach.name,
            appointmentUrl: `${appUrl}/rendez-vous`,
            isReschedule: !!appointment.rescheduledFromId,
          });
      return { ...composed, attachments };
    }

    case "appointment_reminder": {
      const appointment = await getAppointmentById(supabase, log.relatedEntityId ?? "");
      if (!appointment?.studentId) return null;
      const student = await getStudentById(supabase, appointment.studentId);
      if (!student) return null;
      const hoursBefore = (log.metadata.reminderHours as 24 | 2) ?? 24;
      return composeAppointmentReminderEmail({
        firstName: student.firstName,
        appointmentType: appointment.appointmentType,
        startAt: appointment.startAt,
        location: appointment.location,
        meetingUrl: appointment.meetingUrl,
        hoursBefore,
        appointmentUrl: `${appUrl}/rendez-vous`,
      });
    }

    default:
      return null;
  }
}
