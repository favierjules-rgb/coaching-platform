import "server-only";

import { areEmailsEnabled, getFromAddress, getResendClient } from "@/lib/email/resend";

/**
 * Envoi Resend BAS NIVEAU, sans journalisation dans `email_logs`.
 *
 * Extrait de `lib/email/send-transactional-email.ts` pour les envois qui ne
 * se rattachent à aucune entité métier de la base (élève, rendez-vous,
 * commande…) et n'ont donc rien à indexer dans `email_logs` — première
 * utilisation : les demandes de contact « Services aux entreprises »
 * (lib/business-inquiry/email.ts).
 *
 * `sendTransactionalEmail` garde son comportement inchangé : même client
 * Resend, même expéditeur, même coupe-circuit `EMAILS_ENABLED`, mais elle
 * continue de journaliser. Aucune migration, aucune modification de la
 * contrainte CHECK de `email_logs`.
 *
 * `sendEmail` est injectable pour que les tests vérifient le contenu réel
 * d'un envoi sans qu'aucun email ne parte.
 */

export interface RawEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Adresse de réponse — ici l'email du prospect, pour répondre directement depuis sa boîte. */
  replyTo?: string;
}

export type RawEmailStatus = "sent" | "failed" | "skipped";

export interface RawEmailResult {
  status: RawEmailStatus;
  /** Message technique — destiné aux logs serveur, JAMAIS affiché à l'utilisateur. */
  error?: string;
}

/** Transport d'email : la vraie implémentation Resend en production, un double en test. */
export type EmailTransport = (input: RawEmailInput) => Promise<RawEmailResult>;

/**
 * Transport Resend réel. Renvoie `skipped` (jamais une erreur) quand les
 * emails sont désactivés ou la clé absente : un environnement sans email
 * configuré ne doit pas faire échouer le parcours utilisateur.
 */
export const resendTransport: EmailTransport = async (input) => {
  if (!areEmailsEnabled()) {
    return { status: "skipped", error: "EMAILS_ENABLED=false" };
  }

  const resend = getResendClient();
  if (!resend) {
    return { status: "skipped", error: "RESEND_API_KEY non configurée" };
  }

  try {
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: input.to,
      replyTo: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
    });

    if (error) {
      // `error` vient du SDK Resend (message/type/code) : aucun secret, aucune
      // donnée du formulaire — sûr à journaliser.
      console.error(`[Resend] Échec d'envoi : ${error.message}`);
      return { status: "failed", error: error.message };
    }
    return { status: "sent" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inconnue lors de l'envoi de l'email.";
    console.error(`[Resend] Exception lors de l'envoi : ${message}`);
    return { status: "failed", error: message };
  }
};
