import { NextResponse } from "next/server";

import { recomposeEmail } from "@/lib/email/recompose";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getEmailLogById } from "@/lib/supabase/email-logs";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * POST /api/admin/emails/[id]/resend — renvoie un email transactionnel en
 * échec (chantier "supabase-resend-transactional-emails"). Réservé
 * admin/coach. Ne renvoie **jamais** un email déjà envoyé avec succès
 * (`status: "sent"`) — seul un email `"failed"` peut être renvoyé, ce qui
 * empêche tout doublon dangereux (double confirmation de paiement, double
 * notification de rendez-vous...). Le contenu est recomposé à partir des
 * données actuelles (`lib/email/recompose.ts`), jamais rejoué depuis un
 * HTML stocké — le destinataire reste strictement celui du log d'origine.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  // Client service role : `email_logs` n'a aucune policy d'insert/update
  // pour un rôle authentifié (voir supabase/schema.sql), seul le service
  // role peut y écrire.
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const log = await getEmailLogById(supabase, id);
  if (!log) {
    return NextResponse.json({ error: "Email introuvable." }, { status: 404 });
  }
  if (log.status !== "failed") {
    return NextResponse.json({ error: "Seul un email en échec peut être renvoyé." }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const recomposed = await recomposeEmail(supabase, log, appUrl);
  if (!recomposed) {
    return NextResponse.json({ error: "Impossible de recomposer cet email (donnée liée introuvable ou supprimée depuis)." }, { status: 409 });
  }

  const result = await sendTransactionalEmail(supabase, {
    emailType: log.emailType,
    recipientEmail: log.recipientEmail,
    recipientUserId: log.recipientUserId,
    subject: recomposed.subject,
    html: recomposed.html,
    text: recomposed.text,
    relatedEntityType: log.relatedEntityType,
    relatedEntityId: log.relatedEntityId,
    metadata: { ...log.metadata, resentFromLogId: log.id },
    attachments: recomposed.attachments,
  });

  return NextResponse.json({ status: result.status });
}
