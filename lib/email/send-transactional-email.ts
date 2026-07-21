import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { areEmailsEnabled, getFromAddress, getReplyToAddress, getResendClient } from "@/lib/email/resend";
import type { EmailType } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Point d'envoi central de tous les emails transactionnels (chantier
 * "supabase-resend-transactional-emails") — server-only, jamais importé
 * côté client. Toujours journalisé dans `email_logs` avant tentative
 * d'envoi (une ligne "pending" existe même si le process crashe pendant
 * l'appel Resend), jamais d'exception qui remonterait au caller : un email
 * qui échoue ne doit jamais faire échouer l'action métier qui l'a
 * déclenché (paiement, attribution, réservation...).
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface EmailAttachment {
  filename: string;
  /** Contenu texte brut (ex: fichier .ics) — encodé en base64 avant l'appel Resend. */
  content: string;
  contentType?: string;
}

export interface SendTransactionalEmailInput {
  emailType: EmailType;
  recipientEmail: string;
  recipientUserId?: string | null;
  subject: string;
  html: string;
  text: string;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  metadata?: Record<string, unknown>;
  attachments?: EmailAttachment[];
  /**
   * Clé d'idempotence Resend (chantier conformité juridique/RGPD, Lot E-bis
   * technique — juillet 2026). Par défaut `logId` (un UUID frais à CHAQUE
   * appel, donc sans effet réel entre deux appels distincts — c'est le
   * comportement historique, inchangé pour tous les appelants existants).
   * Un appelant qui a besoin qu'un retry (webhook Stripe par ex.) ne
   * déclenche jamais un second envoi Resend du même email doit fournir ici
   * une clé STABLE et déterministe, dérivée d'un identifiant métier qui ne
   * change pas d'un retry à l'autre (ex : `program-purchase-confirmation/${session.id}`
   * — voir lib/stripe/webhook-handlers.ts).
   */
  idempotencyKey?: string;
}

export interface SendTransactionalEmailResult {
  status: "sent" | "failed" | "skipped";
  logId: string | null;
  error?: string;
}

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

/** `true` si un email de ce type a déjà été envoyé avec succès pour cette entité — utilisé pour les envois qui ne doivent jamais se répéter (ex : bienvenue). */
export async function wasEmailAlreadySent(
  supabase: TypedSupabaseClient,
  params: { emailType: EmailType; relatedEntityType: string; relatedEntityId: string },
): Promise<boolean> {
  const { data, error } = await supabase
    .from("email_logs")
    .select("id")
    .eq("email_type", params.emailType)
    .eq("related_entity_type", params.relatedEntityType)
    .eq("related_entity_id", params.relatedEntityId)
    .eq("status", "sent")
    .limit(1)
    .maybeSingle();
  devWarn("wasEmailAlreadySent", error);
  return !!data;
}

/** `true` si un email identique a été envoyé il y a moins de `windowSeconds` — garde-fou contre un double-clic/double appel réseau, sans bloquer une vraie nouvelle attribution plus tard. */
export async function wasEmailRecentlySent(
  supabase: TypedSupabaseClient,
  params: { emailType: EmailType; relatedEntityType: string; relatedEntityId: string; windowSeconds?: number },
): Promise<boolean> {
  const windowSeconds = params.windowSeconds ?? 30;
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const { data, error } = await supabase
    .from("email_logs")
    .select("id")
    .eq("email_type", params.emailType)
    .eq("related_entity_type", params.relatedEntityType)
    .eq("related_entity_id", params.relatedEntityId)
    .eq("status", "sent")
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  devWarn("wasEmailRecentlySent", error);
  return !!data;
}

/**
 * Envoie un email transactionnel et journalise le résultat. Ne lance
 * jamais d'exception — `status: "failed"` en cas d'erreur Resend,
 * `"skipped"` si aucun provider n'est configuré ou si `EMAILS_ENABLED`
 * vaut `"false"` (voir lib/email/resend.ts). Utilisable aussi bien
 * directement (handlers webhook Stripe, déjà server-side) que depuis les
 * routes `app/api/email/*` (seuls points d'entrée atteignables depuis du
 * code client-bundlé, ex : lib/email/appointment-emails.ts).
 */
export async function sendTransactionalEmail(
  supabase: TypedSupabaseClient,
  input: SendTransactionalEmailInput,
): Promise<SendTransactionalEmailResult> {
  const logId = crypto.randomUUID();
  const { error: insertError } = await supabase.from("email_logs").insert({
    id: logId,
    recipient_email: input.recipientEmail,
    recipient_user_id: input.recipientUserId ?? null,
    email_type: input.emailType,
    subject: input.subject,
    status: "pending",
    related_entity_type: input.relatedEntityType ?? null,
    related_entity_id: input.relatedEntityId ?? null,
    metadata: input.metadata ?? {},
  });
  devWarn("sendTransactionalEmail (insert pending)", insertError);

  if (!areEmailsEnabled()) {
    await supabase.from("email_logs").update({ status: "skipped", error_message: "EMAILS_ENABLED=false" }).eq("id", logId);
    return { status: "skipped", logId };
  }

  const resend = getResendClient();
  if (!resend) {
    await supabase.from("email_logs").update({ status: "skipped", error_message: "RESEND_API_KEY non configurée" }).eq("id", logId);
    return { status: "skipped", logId };
  }

  try {
    const { data, error } = await resend.emails.send(
      {
        from: getFromAddress(),
        to: input.recipientEmail,
        replyTo: getReplyToAddress(),
        subject: input.subject,
        html: input.html,
        text: input.text,
        attachments: input.attachments?.map((a) => ({
          filename: a.filename,
          content: Buffer.from(a.content, "utf-8").toString("base64"),
          contentType: a.contentType,
        })),
      },
      { idempotencyKey: input.idempotencyKey ?? logId },
    );

    if (error) {
      // `error` provient du SDK Resend (message/type/code) — jamais de secret dedans, sûr à journaliser.
      console.error(`[Resend] Échec d'envoi (${input.emailType} → ${input.recipientEmail}) : ${error.message}`);
      await supabase.from("email_logs").update({ status: "failed", error_message: error.message }).eq("id", logId);
      return { status: "failed", logId, error: error.message };
    }

    await supabase
      .from("email_logs")
      .update({ status: "sent", resend_email_id: data?.id ?? null, sent_at: new Date().toISOString() })
      .eq("id", logId);
    return { status: "sent", logId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue lors de l'envoi de l'email.";
    console.error(`[Resend] Exception lors de l'envoi (${input.emailType} → ${input.recipientEmail}) : ${message}`);
    await supabase.from("email_logs").update({ status: "failed", error_message: message }).eq("id", logId);
    return { status: "failed", logId, error: message };
  }
}
