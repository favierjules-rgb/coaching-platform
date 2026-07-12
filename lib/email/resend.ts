import "server-only";

import { Resend } from "resend";

/**
 * Client Resend serveur (chantier "supabase-resend-transactional-emails").
 * Ce fichier importe `server-only` : le build échoue s'il est jamais
 * importé depuis un Client Component, pour qu'une clé API Resend ne se
 * retrouve jamais dans le bundle navigateur — même règle que
 * lib/stripe/client.ts et lib/supabase/admin.ts.
 *
 * Renvoie `null` si RESEND_API_KEY n'est pas configurée — jamais d'erreur
 * bloquante au chargement du module, à l'appelant
 * (lib/email/send-transactional-email.ts) de journaliser un envoi
 * "skipped" plutôt que de planter.
 */

let cached: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Resend] RESEND_API_KEY absente. Emails transactionnels indisponibles (journalisés \"skipped\").");
    }
    return null;
  }
  if (!cached) {
    cached = new Resend(apiKey);
  }
  return cached;
}

/** `false` si EMAILS_ENABLED="false" — coupe-circuit global indépendant de la présence de la clé API (utile en préprod/staging). Par défaut activé. */
export function areEmailsEnabled(): boolean {
  return process.env.EMAILS_ENABLED !== "false";
}

export function getFromAddress(): string {
  return process.env.RESEND_FROM_EMAIL || "SETH Préparation Physique <onboarding@resend.dev>";
}

export function getReplyToAddress(): string | undefined {
  return process.env.RESEND_REPLY_TO || undefined;
}
