import type { SupabaseClient } from "@supabase/supabase-js";

import type { EmailLog, EmailStatus, EmailType } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès Supabase pour le journal des emails transactionnels
 * (chantier "supabase-resend-transactional-emails"), table `email_logs`.
 * Lecture seule côté navigateur (RLS `email_logs_select_staff` — staff
 * uniquement, aucun accès élève) : `/admin/emails`. Toute écriture passe
 * par lib/email/send-transactional-email.ts, jamais ce fichier.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type EmailLogRow = Database["public"]["Tables"]["email_logs"]["Row"];

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

function mapEmailLogRow(row: EmailLogRow): EmailLog {
  return {
    id: row.id,
    recipientEmail: row.recipient_email,
    recipientUserId: row.recipient_user_id,
    emailType: row.email_type as EmailType,
    subject: row.subject,
    resendEmailId: row.resend_email_id,
    status: row.status as EmailStatus,
    relatedEntityType: row.related_entity_type,
    relatedEntityId: row.related_entity_id,
    errorMessage: row.error_message,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    sentAt: row.sent_at,
    createdAt: row.created_at,
  };
}

/** Liste complète des emails journalisés (le plus récent en premier), pour /admin/emails. Filtrage côté application (page component) — volume attendu faible, cohérent avec le reste du repo. */
export async function getEmailLogs(supabase: TypedSupabaseClient, limit = 200): Promise<EmailLog[]> {
  const { data, error } = await supabase.from("email_logs").select("*").order("created_at", { ascending: false }).limit(limit);
  devWarn("getEmailLogs", error);
  return (data ?? []).map(mapEmailLogRow);
}

export async function getEmailLogById(supabase: TypedSupabaseClient, id: string): Promise<EmailLog | null> {
  const { data, error } = await supabase.from("email_logs").select("*").eq("id", id).maybeSingle();
  devWarn("getEmailLogById", error);
  return data ? mapEmailLogRow(data) : null;
}
