import "server-only";

import {
  GOAL_OPTIONS,
  labelFor,
  type FreeAssessmentInput,
} from "@/lib/free-assessment/schema";
import {
  escapeHtml,
  renderBaseEmailHtml,
  renderBaseEmailText,
  type EmailFooterOptions,
} from "@/lib/email/templates/base";
import { resendTransport, type EmailTransport, type RawEmailResult } from "@/lib/email/send-raw-email";

/**
 * Email de demande « Mon bilan offert » (section de la page d'accueil).
 *
 * Destinataire : `FREE_ASSESSMENT_RECIPIENT_EMAIL`, variable SERVEUR unique —
 * l'adresse n'est écrite dans aucun composant, et ne transite jamais par le
 * navigateur. `Reply-To` porte l'email du prospect, pour lui répondre
 * directement depuis la boîte du coach.
 *
 * Toute valeur saisie passe par `escapeHtml` avant d'être concaténée dans le
 * HTML. Les réponses ne sont écrites ni en base, ni dans les logs serveur.
 */

/**
 * Pied de page propre à cette notification interne : le destinataire est le
 * coach, pas un élève — la mention générique « suite à une action sur ton
 * compte » serait fausse. La ligne « Réponds directement à cet email » est
 * masquée car répondre écrit au PROSPECT (Reply-To), pas au support.
 */
export const FREE_ASSESSMENT_FOOTER: EmailFooterOptions = {
  note: "Cette demande a été envoyée depuis le formulaire « Mon bilan offert » de SETH Coaching.",
  showReplyTo: false,
};

export function getFreeAssessmentRecipient(): string | null {
  const recipient = process.env.FREE_ASSESSMENT_RECIPIENT_EMAIL?.trim();
  return recipient && recipient.length > 0 ? recipient : null;
}

/** Sujet : `[Nouveau bilan offert] {prénom} {nom} — {objectif}`. */
export function buildFreeAssessmentSubject(input: FreeAssessmentInput): string {
  return `[Nouveau bilan offert] ${input.firstName} ${input.lastName} — ${labelFor(GOAL_OPTIONS, input.goal)}`;
}

/** Horodatage lisible en Europe/Paris (fuseau métier du projet). */
function formatSubmittedAt(date: Date): string {
  return date.toLocaleString("fr-FR", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  });
}

interface Line {
  label: string;
  value: string;
}

/** Lignes du récapitulatif, dans l'ordre des questions du formulaire. */
export function buildFreeAssessmentLines(input: FreeAssessmentInput, submittedAt: Date): Line[] {
  const goal =
    input.goal === "autre" && input.otherGoal
      ? `Autre : ${input.otherGoal}`
      : labelFor(GOAL_OPTIONS, input.goal);

  return [
    { label: "Reçue le", value: formatSubmittedAt(submittedAt) },
    { label: "Nom", value: input.lastName },
    { label: "Prénom", value: input.firstName },
    { label: "Téléphone", value: input.phone },
    { label: "Email", value: input.email },
    { label: "Objectif principal", value: goal },
    { label: "Plus grande frustration", value: input.frustration },
    {
      label: "Consentement",
      value: "Accepté (utilisation limitée au traitement de la demande de bilan)",
    },
  ];
}

function renderLinesHtml(lines: Line[]): string {
  return lines
    .map(
      ({ label, value }) =>
        `<p style="margin: 0 0 10px;"><strong>${escapeHtml(label)} :</strong><br />${escapeHtml(value).replace(/\n/g, "<br />")}</p>`,
    )
    .join("");
}

function renderLinesText(lines: Line[]): string {
  return lines.map(({ label, value }) => `${label} : ${value}`).join("\n\n");
}

export interface SendFreeAssessmentOptions {
  /** Transport injectable — un double en test, `resendTransport` en production. */
  transport?: EmailTransport;
  /** Horloge injectable, pour un horodatage déterministe en test. */
  now?: Date;
  /** Destinataire explicite (tests) ; sinon lu dans l'environnement serveur. */
  recipient?: string | null;
}

export interface SendFreeAssessmentResult extends RawEmailResult {
  /** Sujet réellement envoyé — utile aux tests et au diagnostic. */
  subject: string;
}

export async function sendFreeAssessmentEmail(
  input: FreeAssessmentInput,
  options: SendFreeAssessmentOptions = {},
): Promise<SendFreeAssessmentResult> {
  const transport = options.transport ?? resendTransport;
  const submittedAt = options.now ?? new Date();
  const recipient = options.recipient !== undefined ? options.recipient : getFreeAssessmentRecipient();
  const subject = buildFreeAssessmentSubject(input);

  if (!recipient) {
    // Aucun destinataire configuré : on ne tente pas l'envoi. La route
    // décide de ce que voit le prospect (message générique).
    console.error("[FreeAssessment] FREE_ASSESSMENT_RECIPIENT_EMAIL non configurée : email non envoyé.");
    return { status: "skipped", error: "FREE_ASSESSMENT_RECIPIENT_EMAIL non configurée", subject };
  }

  const lines = buildFreeAssessmentLines(input, submittedAt);

  const html = renderBaseEmailHtml({
    preheader: `Demande de bilan — ${input.firstName} ${input.lastName}`,
    heading: "Nouvelle demande de bilan offert",
    bodyHtml: renderLinesHtml(lines),
    footer: FREE_ASSESSMENT_FOOTER,
  });

  const text = renderBaseEmailText({
    heading: "Nouvelle demande de bilan offert",
    bodyText: renderLinesText(lines),
    footer: FREE_ASSESSMENT_FOOTER,
  });

  const result = await transport({
    to: recipient,
    subject,
    html,
    text,
    // Répondre au prospect directement depuis la boîte du coach.
    replyTo: input.email,
  });

  return { ...result, subject };
}
