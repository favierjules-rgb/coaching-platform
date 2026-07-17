import { NextResponse } from "next/server";

import { composeAccountExpiryWarningEmail } from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

/**
 * POST /api/internal/cleanup-expired-accounts — chantier "suppression auto.
 * comptes programme_seul après 6 mois" (allège la base au fil du temps).
 * Appelée quotidiennement par un job pg_cron (via pg_net, voir la migration
 * associée), jamais par un utilisateur connecté — protégée par un secret
 * partagé (INTERNAL_CRON_SECRET) plutôt que par l'auth Supabase habituelle.
 *
 * Deux passes, toujours dans cet ordre (pour ne jamais avertir un compte
 * qui va être supprimé dans la même exécution) :
 * 1. Suppression définitive des comptes "programme_seul" créés il y a plus
 *    de 6 mois — la fiche `students` d'abord (cascade déjà en place côté
 *    DB : mesures, photos, assignations, retours de séance...), puis le
 *    compte de connexion via l'API Admin (jamais du SQL brut sur
 *    auth.users) — cascade ensuite `profiles` automatiquement.
 * 2. Email d'avertissement (une seule fois, `deletion_warning_sent_at`) aux
 *    comptes à ~14 jours de l'échéance, pour ne jamais couper l'accès sans
 *    prévenir.
 */
const SIX_MONTHS_MS = 1000 * 60 * 60 * 24 * 30 * 6; // approximation volontaire, cohérente avec un job quotidien
const WARNING_LEAD_MS = 1000 * 60 * 60 * 24 * 14;

export async function POST(request: Request) {
  const secret = process.env.INTERNAL_CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const now = Date.now();
  const deleteThreshold = new Date(now - SIX_MONTHS_MS).toISOString();
  const warnThreshold = new Date(now - SIX_MONTHS_MS + WARNING_LEAD_MS).toISOString();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  // 1. Suppression définitive des comptes échus.
  const { data: toDelete, error: toDeleteError } = await supabase
    .from("students")
    .select("id, user_id")
    .eq("access_type", "programme_seul")
    .lt("created_at", deleteThreshold);
  if (toDeleteError) {
    console.error(`[cleanup-expired-accounts] lecture comptes à supprimer : ${toDeleteError.message}`);
  }

  let deletedCount = 0;
  for (const student of toDelete ?? []) {
    const { error: deleteError } = await supabase.from("students").delete().eq("id", student.id);
    if (deleteError) {
      console.error(`[cleanup-expired-accounts] suppression fiche ${student.id} : ${deleteError.message}`);
      continue;
    }
    if (student.user_id) {
      const { error: authDeleteError } = await supabase.auth.admin.deleteUser(student.user_id);
      if (authDeleteError) {
        console.error(
          `[cleanup-expired-accounts] suppression compte auth ${student.user_id} : ${authDeleteError.message}`,
        );
      }
    }
    deletedCount += 1;
  }

  // 2. Avertissement des comptes à ~14 jours de l'échéance.
  const { data: toWarn, error: toWarnError } = await supabase
    .from("students")
    .select("id, email, first_name")
    .eq("access_type", "programme_seul")
    .is("deletion_warning_sent_at", null)
    .lt("created_at", warnThreshold);
  if (toWarnError) {
    console.error(`[cleanup-expired-accounts] lecture comptes à avertir : ${toWarnError.message}`);
  }

  let warnedCount = 0;
  for (const student of toWarn ?? []) {
    const email = composeAccountExpiryWarningEmail({
      firstName: student.first_name,
      loginUrl: `${appUrl}/connexion`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "account_expiry_warning",
      recipientEmail: student.email,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "student",
      relatedEntityId: student.id,
    });
    const { error: warnUpdateError } = await supabase
      .from("students")
      .update({ deletion_warning_sent_at: new Date().toISOString() })
      .eq("id", student.id);
    if (warnUpdateError) {
      console.error(`[cleanup-expired-accounts] marquage avertissement ${student.id} : ${warnUpdateError.message}`);
      continue;
    }
    warnedCount += 1;
  }

  return NextResponse.json({ ok: true, deletedCount, warnedCount });
}
