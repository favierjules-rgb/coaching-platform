import { NextResponse } from "next/server";

import {
  composeAppointmentCancelledEmail,
  composeAppointmentCreatedCoachEmail,
  composeAppointmentCreatedStudentEmail,
} from "@/lib/email/templates";
import { sendTransactionalEmail, wasEmailRecentlySent } from "@/lib/email/send-transactional-email";
import { resoudreAuteurEnvoi } from "@/lib/email/auteur-envoi";
import { buildCancellationIcs, buildConfirmationIcs, type IcsAppointmentInput, typeMimeIcs } from "@/lib/ics";
import {
  construireIntituleIcs,
  type DestinataireIcs,
  formaterIdentiteCoach,
  formaterIdentiteEleve,
} from "@/lib/ics-intitules";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { type CoachProprietaire, getAppointmentById, getCoachProprietaireRendezVous } from "@/lib/supabase/appointments";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getStudentById } from "@/lib/supabase/students";
import type { EmailType } from "@/types";
import { parseJsonBody } from "@/lib/api/validate";
import { appointmentNotificationBodySchema } from "@/lib/api/schemas/email";
import { requireStaffForStudent } from "@/lib/api/authz";

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

  /*
   * ⚠️ L'AUTEUR DE L'ENVOI SE LIT SUR LA SESSION, PAS DANS LE CORPS DE LA
   * REQUÊTE. `current_staff_id()` est SECURITY DEFINER et ne rend que la fiche
   * de l'appelant : c'est ce qui cloisonne `email_logs`. `null` pour un
   * appelant sans fiche staff — l'envoi est alors journalisé comme système,
   * lisible par l'administrateur seul.
   */
  const auteurEnvoi = await resoudreAuteurEnvoi(sessionSupabase);
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
  } else {
    // Correctif H-3 : un coach ne notifie que les rendez-vous de SES élèves.
    // L'administrateur passe sans condition.
    // P13-B : notifier un rendez-vous relève de `agenda_communication` en
    // écriture (un email part réellement).
    const accesEleve = await requireStaffForStudent(appointment.studentId, {
      categorie: "agenda_communication",
      niveau: "ecriture",
    });
    if (!accesEleve.ok) return accesEleve.response;
  }

  /*
   * ⚠️ LE COACH SE LIT SUR LE RENDEZ-VOUS, PAS SUR LA PREMIÈRE FICHE CRÉÉE.
   * Jusqu'au lot 2, cette route appelait `getPrimaryCoachInfo`, soit
   * `coaches order by created_at limit 1` : le coach le plus ancien, qui
   * n'est le propriétaire que par accident. `appointments.coach_id` était
   * déjà chargé ici (mapAppointmentRow) et n'était utilisé nulle part.
   */
  const [student, coachProprietaire] = await Promise.all([
    getStudentById(adminSupabase, appointment.studentId),
    getCoachProprietaireRendezVous(adminSupabase, appointment.coachId),
  ]);

  /*
   * ⚠️ UN PROPRIÉTAIRE INTROUVABLE NE SE REMPLACE PAS. On n'envoie alors
   * AUCUNE invitation coach — l'adresser au coach principal lui révélerait
   * l'élève d'un confrère — mais l'élève est notifié normalement, avec
   * l'intitulé de secours. L'avertissement part dans les logs de la fonction
   * ET dans la réponse, pour que l'anomalie soit visible sans fouiller.
   */
  if (!coachProprietaire) {
    console.error(
      `[appointment-notification] rendez-vous ${appointment.id} : coach propriétaire introuvable ` +
        `(appointments.coach_id = ${appointment.coachId ?? "null"}). Aucune invitation coach envoyée ; ` +
        `l'élève reçoit l'intitulé de secours.`,
    );
  }

  const isCancelled = appointment.status === "cancelled";
  const isReschedule = !isCancelled && !!appointment.rescheduledFromId;
  const emailType: EmailType = isCancelled ? "appointment_cancelled" : "appointment_created";

  /*
   * ⚠️ UN REPORT DOIT ANNULER L'ANCIEN ÉVÉNEMENT, SUR SON PROPRE UID — lot 3,
   * 17/11/2026. `reschedule_appointment_atomic` annule l'original EN BASE et
   * crée un nouveau rendez-vous avec un nouvel `ics_uid`, mais cette route ne
   * produisait qu'une seule invitation, celle du NOUVEL UID. L'ancien
   * événement n'étant jamais annulé côté client, il restait affiché dans
   * Apple Calendar et Google Calendar à côté du nouveau.
   *
   * On relit donc l'original par `rescheduled_from_id` pour récupérer les
   * seules valeurs qui permettent de l'annuler : son `ics_uid` et ses
   * anciennes dates. Jamais un UID recalculé — un UID inconnu du client ne
   * supprime rien, il crée un événement annulé de plus.
   */
  const original =
    isReschedule && appointment.rescheduledFromId
      ? await getAppointmentById(adminSupabase, appointment.rescheduledFromId)
      : null;
  if (isReschedule && !original) {
    console.error(
      `[appointment-notification] rendez-vous ${appointment.id} : report dont l'original ` +
        `(${appointment.rescheduledFromId ?? "null"}) est introuvable. L'ancien événement ne peut pas ` +
        `être annulé — il restera affiché dans les calendriers.`,
    );
  }

  /*
   * ⚠️ L'INTITULÉ DE L'ANNULATION EST CELUI DE L'ANCIEN RENDEZ-VOUS. Mesuré
   * dans la migration 20261115090000 : `reschedule_appointment_atomic` recopie
   * `student_id` ET `coach_id` de l'original, donc les deux identités
   * coïncident dans le cas normal et `student` est réutilisable tel quel. Le
   * coach est tout de même relu quand les deux lignes divergent — une
   * réaffectation manuelle entre l'original et son report est possible (le
   * script D3 du lot 1 fait précisément cela).
   */
  let coachOriginal: CoachProprietaire | null = null;
  if (original) {
    coachOriginal =
      original.coachId === appointment.coachId
        ? coachProprietaire
        : await getCoachProprietaireRendezVous(adminSupabase, original.coachId);
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  const identiteEleve = formaterIdentiteEleve(student?.firstName ?? "", student?.lastName ?? "");
  const identiteCoach = formaterIdentiteCoach(coachProprietaire?.name ?? "");
  const identiteCoachOriginal = formaterIdentiteCoach(coachOriginal?.name ?? "");

  /*
   * ⚠️ `DTSTAMP` SE LIT SUR `updated_at`, PAS SUR L'HORLOGE — lot 3-bis,
   * 17/11/2026. Deux raisons mesurées, la seconde étant la contraignante :
   *
   *   - les deux destinataires reçoivent des fichiers qui ne doivent différer
   *     que par leur `SUMMARY` (exigence du lot 2) ; deux appels à
   *     `new Date()` pouvaient les séparer d'une seconde ;
   *   - chaque envoi porte désormais une clé d'idempotence STABLE, et une
   *     même clé présentée avec une charge utile DIFFÉRENTE est rejetée par
   *     le fournisseur. Un `DTSTAMP` tiré de l'horloge changerait à chaque
   *     tentative et transformerait un retry légitime en erreur.
   *
   * `appointments.updated_at` est `NOT NULL` (types/supabase.ts), stable
   * entre deux tentatives, et postérieur à l'envoi initial de l'événement
   * qu'on annule — l'ordre des révisions reste correct, `SEQUENCE` le
   * garantissant de toute façon.
   */

  type RoleEnvoi = "student" | "coach";
  interface Destinataire {
    role: RoleEnvoi;
    cle: DestinataireIcs;
    email: string;
    recipientUserId: string | null;
    prenomAffiche: string;
    urlCalendrier: string;
  }

  /**
   * Destinataires d'UN événement : l'élève, plus le coach qui POSSÈDE cet
   * événement-là.
   *
   * ⚠️ LE COACH DÉPEND DE L'ÉVÉNEMENT, PAS DU RENDEZ-VOUS COURANT. Sur un
   * report avec réaffectation, l'ancien créneau est dans l'agenda de l'ANCIEN
   * coach : c'est lui qui doit recevoir l'annulation, sinon l'événement
   * périmé reste chez lui pour toujours. Le nouveau coach, lui, ne reçoit que
   * l'invitation — une annulation d'un créneau qu'il n'a jamais eu ne lui
   * apprendrait rien et nommerait un élève sur un rendez-vous qui ne lui
   * appartenait pas.
   */
  function destinatairesPour(coach: CoachProprietaire | null): Destinataire[] {
    const liste: Destinataire[] = [];
    if (student?.email) {
      liste.push({
        role: "student",
        cle: "eleve",
        email: student.email,
        recipientUserId: student.userId,
        prenomAffiche: student.firstName,
        urlCalendrier: `${appUrl}/rendez-vous`,
      });
    }
    if (coach?.email) {
      liste.push({
        role: "coach",
        cle: "coach",
        email: coach.email,
        recipientUserId: null,
        prenomAffiche: coach.name,
        urlCalendrier: `${appUrl}/admin/calendrier`,
      });
    }
    return liste;
  }

  /**
   * Un envoi = un e-mail = UNE pièce jointe .ics.
   *
   * ⚠️ DEUX E-MAILS DISTINCTS POUR UN REPORT, PLUS UN SEUL À DEUX FICHIERS
   * (arbitrage du 17/11/2026). Un message portant deux parties
   * `text/calendar` est traité de façon imprévisible par les clients de
   * messagerie : Apple Mail et Gmail n'en retiennent en général qu'une, donc
   * l'annulation pouvait être ignorée — exactement le symptôme à corriger.
   *
   * ⚠️ CE QUI REND LES DEUX ENVOIS INDÉPENDANTS, ce sont leurs CLÉS :
   *   - `emailType` + `relatedEntityId` diffèrent (l'annulation est
   *     journalisée sur l'ANCIEN rendez-vous, l'invitation sur le nouveau),
   *     donc le garde-fou anti-doublon ne peut pas confondre les deux ;
   *   - `recipientEmail` entre dans le garde-fou, sans quoi l'envoi réussi
   *     vers l'élève masquerait celui du coach (même type, même entité) ;
   *   - la clé d'idempotence porte en plus le rôle : un rejeu ne produit
   *     jamais deux messages identiques chez le même destinataire.
   */
  interface EnvoiPrevu {
    etape: "annulation_ancien" | "evenement_courant";
    role: RoleEnvoi;
    recipientEmail: string;
    recipientUserId: string | null;
    emailType: EmailType;
    relatedEntityId: string;
    sujet: string;
    html: string;
    texte: string;
    piece: { filename: string; content: string; contentType: string };
    idempotencyKey: string;
  }

  const envois: EnvoiPrevu[] = [];

  /* ── 1. Annulation de l'ANCIEN rendez-vous, sur son propre UID ── */
  if (original) {
    for (const destinataire of destinatairesPour(coachOriginal)) {
      const corps = composeAppointmentCancelledEmail({
        recipientFirstName: destinataire.prenomAffiche,
        appointmentType: original.appointmentType,
        startAt: original.startAt,
        profileOrCalendarUrl: destinataire.urlCalendrier,
      });
      envois.push({
        etape: "annulation_ancien",
        role: destinataire.role,
        recipientEmail: destinataire.email,
        recipientUserId: destinataire.recipientUserId,
        emailType: "appointment_cancelled",
        relatedEntityId: original.id,
        sujet: corps.subject,
        html: corps.html,
        texte: corps.text,
        piece: ((): { filename: string; content: string; contentType: string } => {
          const contenu = buildCancellationIcs({
            uid: original.icsUid,
            title: construireIntituleIcs({
              destinataire: destinataire.cle,
              identiteEleve,
              identiteCoach: identiteCoachOriginal,
            }),
            description: original.description,
            startAt: original.startAt,
            endAt: original.endAt,
            location: original.location,
            meetingUrl: original.meetingUrl,
            organizerName: identiteCoachOriginal,
            organizerEmail: coachOriginal?.email ?? "",
            attendeeName: student?.firstName ?? "",
            attendeeEmail: student?.email ?? "",
            dtstamp: original.updatedAt,
          });
          /*
           * ⚠️ LE TYPE MIME SE DÉDUIT DU FICHIER (lot 4). `typeMimeIcs` relit
           * le `METHOD:` écrit dans le contenu : le paramètre MIME `method`,
           * dont Apple Mail se sert pour décider s'il s'agit d'une invitation
           * ou d'une pièce jointe ordinaire, ne peut donc pas le contredire.
           */
          return { filename: "annulation-ancien-rendez-vous.ics", content: contenu, contentType: typeMimeIcs(contenu) };
        })(),
        idempotencyKey: `appointment-cancelled/${original.id}/${destinataire.role}`,
      });
    }
  }

  /* ── 2. Événement COURANT : invitation, ou annulation si c'en est une ── */
  for (const destinataire of destinatairesPour(coachProprietaire)) {
    const entreeCourante: IcsAppointmentInput = {
      uid: appointment.icsUid,
      title: construireIntituleIcs({ destinataire: destinataire.cle, identiteEleve, identiteCoach }),
      description: appointment.description,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      location: appointment.location,
      meetingUrl: appointment.meetingUrl,
      organizerName: identiteCoach,
      organizerEmail: coachProprietaire?.email ?? "",
      attendeeName: student?.firstName ?? "",
      attendeeEmail: student?.email ?? "",
      dtstamp: appointment.updatedAt,
    };
    const corpsCourant = isCancelled
      ? composeAppointmentCancelledEmail({
          recipientFirstName: destinataire.prenomAffiche,
          appointmentType: appointment.appointmentType,
          startAt: appointment.startAt,
          profileOrCalendarUrl: destinataire.urlCalendrier,
        })
      : destinataire.role === "coach"
        ? composeAppointmentCreatedCoachEmail({
            coachFirstName: destinataire.prenomAffiche,
            studentName: student ? `${student.firstName} ${student.lastName}`.trim() : "Un élève",
            appointmentType: appointment.appointmentType,
            startAt: appointment.startAt,
            appointmentUrl: destinataire.urlCalendrier,
            isReschedule,
          })
        : composeAppointmentCreatedStudentEmail({
            firstName: destinataire.prenomAffiche,
            appointmentType: appointment.appointmentType,
            startAt: appointment.startAt,
            location: appointment.location,
            meetingUrl: appointment.meetingUrl,
            // ⚠️ Repli de CORPS d'email, pas d'intitulé : « ton coach » ne
            // nomme personne. Nommer le coach principal ici serait aussi
            // faux que dans le .ics.
            coachName: coachProprietaire?.name || "ton coach",
            appointmentUrl: destinataire.urlCalendrier,
            isReschedule,
          });
    envois.push({
      etape: "evenement_courant",
      role: destinataire.role,
      recipientEmail: destinataire.email,
      recipientUserId: destinataire.recipientUserId,
      emailType,
      relatedEntityId: appointment.id,
      sujet: corpsCourant.subject,
      html: corpsCourant.html,
      texte: corpsCourant.text,
      piece: ((): { filename: string; content: string; contentType: string } => {
        const contenu = isCancelled ? buildCancellationIcs(entreeCourante) : buildConfirmationIcs(entreeCourante);
        return { filename: "rendez-vous.ics", content: contenu, contentType: typeMimeIcs(contenu) };
      })(),
      idempotencyKey: `${emailType}/${appointment.id}/${destinataire.role}`,
    });
  }

  /*
   * ⚠️ ENVOI SÉQUENTIEL, ANNULATION D'ABORD. L'ordre de `envois` est celui de
   * construction : pour chaque destinataire, l'annulation de l'ancien précède
   * l'invitation du nouveau. Un `await` par envoi, jamais un `Promise.all` :
   * c'est ce qui garantit que l'annulation part avant l'invitation, et non
   * seulement « en même temps ».
   *
   * ⚠️ UN ÉCHEC N'INTERROMPT RIEN. `sendTransactionalEmail` ne lève jamais et
   * rend `failed` ; la boucle continue, et comme le garde-fou ne compte que
   * les lignes `sent`, la tentative suivante reprendra exactement les envois
   * manquants — l'annulation déjà partie ne sera pas rejouée inutilement.
   */
  const results: { recipient: string; etape: string; status: string; raison?: string }[] = [];
  for (const envoi of envois) {
    const dejaEnvoye = await wasEmailRecentlySent(adminSupabase, {
      emailType: envoi.emailType,
      relatedEntityType: "appointment",
      relatedEntityId: envoi.relatedEntityId,
      recipientEmail: envoi.recipientEmail,
    });
    if (dejaEnvoye) {
      results.push({ recipient: envoi.role, etape: envoi.etape, status: "skipped", raison: "already_sent_recently" });
      continue;
    }
    const result = await sendTransactionalEmail(adminSupabase, {
      sentByCoachId: auteurEnvoi,
      emailType: envoi.emailType,
      recipientEmail: envoi.recipientEmail,
      recipientUserId: envoi.recipientUserId,
      subject: envoi.sujet,
      html: envoi.html,
      text: envoi.texte,
      relatedEntityType: "appointment",
      relatedEntityId: envoi.relatedEntityId,
      metadata: { role: envoi.role, etape: envoi.etape, appointmentType: appointment.appointmentType },
      attachments: [envoi.piece],
      idempotencyKey: envoi.idempotencyKey,
    });
    results.push({ recipient: envoi.role, etape: envoi.etape, status: result.status });
  }

  if (!coachProprietaire?.email) {
    results.push({
      recipient: "coach",
      etape: "aucun",
      status: coachProprietaire ? "skipped_email_coach_absent" : "skipped_coach_proprietaire_introuvable",
    });
  }

  return NextResponse.json({
    status: "ok",
    results,
    ...(isReschedule
      ? { reportAnnulationAncien: original ? "envoi_distinct" : "ancien_rendez_vous_introuvable" }
      : {}),
  });
}
