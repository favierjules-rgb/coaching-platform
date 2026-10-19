import { NextResponse } from "next/server";

import { composeWelcomeEmail } from "@/lib/email/templates";
import { sendTransactionalEmail, wasEmailAlreadySent } from "@/lib/email/send-transactional-email";
import { resoudreAuteurEnvoi } from "@/lib/email/auteur-envoi";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getStudentById } from "@/lib/supabase/students";
import { parseJsonBody } from "@/lib/api/validate";
import { welcomeEmailBodySchema } from "@/lib/api/schemas/email";
import { requireStaffForStudent } from "@/lib/api/authz";

/**
 * POST /api/email/welcome — envoie l'email de bienvenue (chantier
 * "supabase-resend-transactional-emails"), déclenché à la fin de
 * l'onboarding (`components/onboarding/OnboardingWizard.tsx`) ou
 * manuellement par un admin/coach ("activation du compte"). Body :
 * `{ studentId }`. Idempotent de façon stricte (jamais un deuxième email de
 * bienvenue pour le même élève, même si l'onboarding est soumis plusieurs
 * fois) via `wasEmailAlreadySent` — contrairement aux autres routes
 * `/api/email/*` qui n'utilisent qu'un court anti-double-clic.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, welcomeEmailBodySchema);
  if (!parsed.success) return parsed.response;
  const { studentId } = parsed.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  const role = await getCurrentUserRole();
  if (role === "student") {
    const ownStudentId = await getCurrentStudentId(sessionSupabase);
    if (!ownStudentId || ownStudentId !== studentId) {
      return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  } else {
    // Correctif H-3 : un coach n'agit que sur les élèves qui lui sont
    // affectés. L'administrateur passe sans condition.
    // P13-B : aucune catégorie n'est déclarée, volontairement — créer
    // l'accès d'un élève est de l'administration de compte, qu'aucune des
    // quatre catégories n'accorde. Un collaborateur reçoit donc 403, même
    // sur un élève qui lui est affecté.
    const accesEleve = await requireStaffForStudent(studentId);
    if (!accesEleve.ok) return accesEleve.response;
  }

  // Client service role : `email_logs` n'a aucune policy d'insert/update
  // pour un rôle authentifié (voir supabase/schema.sql), seul le service
  // role peut y écrire.
  const supabase = createSupabaseAdminClient();

  /*
   * ⚠️ L'AUTEUR DE L'ENVOI SE LIT SUR LA SESSION, PAS DANS LE CORPS DE LA
   * REQUÊTE. `current_staff_id()` est SECURITY DEFINER et ne rend que la fiche
   * de l'appelant : c'est ce qui cloisonne `email_logs`. `null` pour un
   * appelant sans fiche staff — l'envoi est alors journalisé comme système,
   * lisible par l'administrateur seul.
   */
  const auteurEnvoi = await resoudreAuteurEnvoi(sessionSupabase);
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const student = await getStudentById(supabase, studentId);
  if (!student?.email) {
    return NextResponse.json({ error: "Élève introuvable ou sans email." }, { status: 404 });
  }

  const alreadySent = await wasEmailAlreadySent(supabase, {
    emailType: "welcome",
    relatedEntityType: "student",
    relatedEntityId: studentId,
  });
  if (alreadySent) {
    return NextResponse.json({ status: "skipped", reason: "already_sent" });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const email = composeWelcomeEmail({ firstName: student.firstName, dashboardUrl: `${appUrl}/dashboard` });

  const result = await sendTransactionalEmail(supabase, {
    sentByCoachId: auteurEnvoi,
    emailType: "welcome",
    recipientEmail: student.email,
    recipientUserId: student.userId,
    subject: email.subject,
    html: email.html,
    text: email.text,
    relatedEntityType: "student",
    relatedEntityId: studentId,
  });

  return NextResponse.json({ status: result.status });
}
