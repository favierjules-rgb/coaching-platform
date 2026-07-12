import { NextResponse } from "next/server";

import { composeSubscriptionAssignedEmail } from "@/lib/email/templates";
import { sendTransactionalEmail, wasEmailRecentlySent } from "@/lib/email/send-transactional-email";
import { getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentById, getStudentProfile } from "@/lib/supabase/students";
import { getSubscriptionTemplateById } from "@/lib/supabase/subscription-templates";

/**
 * POST /api/email/subscription-assigned — envoie l'email "formule
 * attribuée" (chantier "supabase-resend-transactional-emails"). Réservé
 * admin/coach (déclenché juste après le bouton "Attribuer" de
 * `StudentSubscriptionSection`). Body : `{ studentId }` uniquement —
 * aucun contenu ni destinataire fourni par le client : le modèle attribué
 * et l'email de l'élève sont relus côté serveur depuis
 * `student_profiles.assigned_subscription_template_id`, jamais transmis
 * depuis le navigateur.
 */
export async function POST(request: Request) {
  let body: { studentId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { studentId } = body;
  if (!studentId) {
    return NextResponse.json({ error: "studentId est requis." }, { status: 400 });
  }

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  // Client service role pour les lectures/écritures qui suivent : `email_logs`
  // n'a aucune policy d'insert/update pour un rôle authentifié (même staff),
  // volontairement (voir supabase/schema.sql) — seul le service role peut y
  // écrire, comme pour le webhook Stripe.
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const [student, profile] = await Promise.all([getStudentById(supabase, studentId), getStudentProfile(supabase, studentId)]);
  if (!student?.email) {
    return NextResponse.json({ error: "Élève introuvable ou sans email." }, { status: 404 });
  }
  if (!profile?.assignedSubscriptionTemplateId) {
    return NextResponse.json({ error: "Aucun modèle attribué à cet élève." }, { status: 400 });
  }

  const template = await getSubscriptionTemplateById(supabase, profile.assignedSubscriptionTemplateId);
  if (!template) {
    return NextResponse.json({ error: "Modèle attribué introuvable." }, { status: 404 });
  }

  const alreadySent = await wasEmailRecentlySent(supabase, {
    emailType: "subscription_assigned",
    relatedEntityType: "student_profile",
    relatedEntityId: studentId,
  });
  if (alreadySent) {
    return NextResponse.json({ status: "skipped", reason: "already_sent_recently" });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  // Lien vers /profil plutôt qu'une session Stripe Checkout déjà créée :
  // une session Checkout expire (24h) et ce lien peut être ouvert plus
  // tard — /profil crée une session fraîche au clic sur "Activer mon
  // abonnement", toujours valide.
  const email = composeSubscriptionAssignedEmail({
    firstName: student.firstName,
    templateName: template.name,
    amountCents: template.amountCents,
    currency: template.currency,
    billingInterval: template.billingInterval,
    durationMonths: template.durationMonths,
    payUrl: `${appUrl}/profil`,
    profileUrl: `${appUrl}/profil`,
  });

  const result = await sendTransactionalEmail(supabase, {
    emailType: "subscription_assigned",
    recipientEmail: student.email,
    recipientUserId: student.userId,
    subject: email.subject,
    html: email.html,
    text: email.text,
    relatedEntityType: "student_profile",
    relatedEntityId: studentId,
    metadata: { templateId: template.id, templateName: template.name },
  });

  return NextResponse.json({ status: result.status });
}
