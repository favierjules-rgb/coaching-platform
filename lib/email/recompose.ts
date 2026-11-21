import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput, typeMimeIcs } from "@/lib/ics";
import { construireIntituleIcs, formaterIdentiteCoach, formaterIdentiteEleve } from "@/lib/ics-intitules";
import { getAppointmentById, getCoachProprietaireRendezVous } from "@/lib/supabase/appointments";
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
      /*
       * ⚠️ MÊME SOURCE DE VÉRITÉ QUE L'ENVOI INITIAL : le propriétaire se lit
       * sur `appointments.coach_id`, jamais sur la première fiche `coaches`
       * créée. Un renvoi doit reproduire l'invitation d'origine, pas une
       * version avec un autre coach au titre.
       */
      const [student, coachProprietaire] = await Promise.all([
        getStudentById(supabase, appointment.studentId),
        getCoachProprietaireRendezVous(supabase, appointment.coachId),
      ]);
      const isCancelled = log.emailType === "appointment_cancelled";
      const isCoachRecipient = log.metadata.role === "coach";
      /*
       * Ce chemin ne sert QU'UN destinataire — celui du journal — donc une
       * seule pièce jointe, dont l'intitulé suit `metadata.role` renseigné à
       * l'envoi d'origine par app/api/email/appointment-notification/route.ts.
       * Un rôle absent (journal antérieur au chantier) retombe sur l'élève,
       * exactement comme le choix du modèle d'email juste en dessous.
       */
      const icsInput: IcsAppointmentInput = {
        uid: appointment.icsUid,
        title: construireIntituleIcs({
          destinataire: isCoachRecipient ? "coach" : "eleve",
          identiteEleve: formaterIdentiteEleve(student?.firstName ?? "", student?.lastName ?? ""),
          identiteCoach: formaterIdentiteCoach(coachProprietaire?.name ?? ""),
        }),
        description: appointment.description,
        startAt: appointment.startAt,
        endAt: appointment.endAt,
        location: appointment.location,
        meetingUrl: appointment.meetingUrl,
        organizerName: formaterIdentiteCoach(coachProprietaire?.name ?? ""),
        organizerEmail: coachProprietaire?.email ?? "",
        attendeeName: student?.firstName ?? "",
        attendeeEmail: student?.email ?? "",
      };
      /*
       * ⚠️ UN RENVOI = UN E-MAIL = UNE SEULE PIÈCE JOINTE (lot 3-bis,
       * 17/11/2026). Une version intermédiaire de ce lot joignait ici
       * l'annulation de l'ancien rendez-vous en plus de l'invitation. Ce
       * n'est plus nécessaire NI souhaitable : depuis que le report produit
       * DEUX e-mails distincts, l'annulation de l'ancien a sa propre ligne
       * dans `email_logs` (`appointment_cancelled` sur l'ancien
       * `appointment.id`) et se renvoie donc indépendamment, par le même
       * bouton « Renvoyer ».
       *
       * Ce renvoi-là reconstruit alors l'annulation de l'ancien rendez-vous
       * tout seul, par le chemin `isCancelled` ci-dessous : `relatedEntityId`
       * pointe sur l'original, dont `status` vaut `cancelled` et dont
       * `ics_uid` n'a jamais été réécrit. L'ancien UID et les anciennes dates
       * sortent donc naturellement, sans cas particulier.
       */
      const contenuIcs = isCancelled ? buildCancellationIcs(icsInput) : buildConfirmationIcs(icsInput);
      const attachments = [
        {
          filename: isCancelled ? "annulation-rendez-vous.ics" : "rendez-vous.ics",
          content: contenuIcs,
          // ⚠️ Type MIME dérivé du contenu — voir lib/ics.ts::typeMimeIcs.
          contentType: typeMimeIcs(contenuIcs),
        },
      ];
      if (isCancelled) {
        const composed = composeAppointmentCancelledEmail({
          recipientFirstName: isCoachRecipient ? (coachProprietaire?.name ?? "") : (student?.firstName ?? ""),
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          profileOrCalendarUrl: isCoachRecipient ? `${appUrl}/admin/calendrier` : `${appUrl}/rendez-vous`,
        });
        return { ...composed, attachments };
      }
      const composed = isCoachRecipient
        ? composeAppointmentCreatedCoachEmail({
            coachFirstName: coachProprietaire?.name ?? "",
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
            coachName: coachProprietaire?.name || "ton coach",
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
