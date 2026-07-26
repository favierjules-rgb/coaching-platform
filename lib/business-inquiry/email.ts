import "server-only";

import {
  FORMAT_OPTIONS,
  HEADCOUNT_OPTIONS,
  NEED_OPTIONS,
  labelFor,
  type BusinessInquiryInput,
} from "@/lib/business-inquiry/schema";
import {
  escapeHtml,
  renderBaseEmailHtml,
  renderBaseEmailText,
  type EmailFooterOptions,
} from "@/lib/email/templates/base";
import { resendTransport, type EmailTransport, type RawEmailResult } from "@/lib/email/send-raw-email";

/**
 * Email de demande « Services aux entreprises ».
 *
 * Destinataire : `B2B_CONTACT_RECIPIENT_EMAIL`, variable SERVEUR unique —
 * l'adresse n'est écrite dans aucun composant, et ne transite jamais par le
 * navigateur. `Reply-To` porte l'email professionnel du prospect, pour
 * répondre directement depuis sa boîte.
 *
 * Toute valeur saisie par le prospect passe par `escapeHtml` avant d'être
 * concaténée dans le HTML (même règle que les autres templates du projet).
 * Les réponses ne sont écrites ni en base, ni dans les logs serveur.
 */

/**
 * Pied de page propre à cette notification. Contrairement aux emails
 * transactionnels adressés aux élèves, le destinataire est ici le coach
 * lui-même : la mention « suite à une action sur ton compte » serait fausse,
 * et la ligne « Réponds directement à cet email » induirait en erreur —
 * répondre écrit au PROSPECT (Reply-To), pas au support.
 */
export const BUSINESS_INQUIRY_FOOTER: EmailFooterOptions = {
  note: "Cette demande a été envoyée depuis le formulaire Services aux entreprises de SETH Coaching.",
  showReplyTo: false,
};

export function getBusinessContactRecipient(): string | null {
  const recipient = process.env.B2B_CONTACT_RECIPIENT_EMAIL?.trim();
  return recipient && recipient.length > 0 ? recipient : null;
}

/** Sujet : `[Demande entreprise] {entreprise} — {effectif}`. */
export function buildBusinessInquirySubject(input: BusinessInquiryInput): string {
  return `[Demande entreprise] ${input.companyName} — ${labelFor(HEADCOUNT_OPTIONS, input.headcount)}`;
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
export function buildBusinessInquiryLines(input: BusinessInquiryInput, submittedAt: Date): Line[] {
  const needs = input.needs.map((need) => labelFor(NEED_OPTIONS, need));
  if (input.needs.includes("autre") && input.otherNeed) {
    const index = needs.indexOf(labelFor(NEED_OPTIONS, "autre"));
    if (index >= 0) needs[index] = `Autre : ${input.otherNeed}`;
  }

  return [
    { label: "Reçue le", value: formatSubmittedAt(submittedAt) },
    { label: "Entreprise", value: input.companyName },
    { label: "Contact", value: `${input.contactName} — ${input.contactRole}` },
    { label: "Email", value: input.email },
    { label: "Téléphone", value: input.phone && input.phone.length > 0 ? input.phone : "Non communiqué" },
    { label: "Effectif concerné", value: labelFor(HEADCOUNT_OPTIONS, input.headcount) },
    { label: "Besoins", value: needs.join(" · ") },
    { label: "Format", value: labelFor(FORMAT_OPTIONS, input.format) },
    { label: "Ville / zone", value: input.city && input.city.length > 0 ? input.city : "Non précisée" },
    {
      label: "Projet",
      value: input.projectDetails && input.projectDetails.length > 0 ? input.projectDetails : "Non précisé",
    },
    {
      label: "Politique de confidentialité",
      value: "Acceptée par le prospect (utilisation limitée au traitement de la demande)",
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

export interface SendBusinessInquiryOptions {
  /** Injectable pour les tests : aucun email réel n'est envoyé. */
  transport?: EmailTransport;
  /** Injectable pour les tests : horodatage déterministe. */
  now?: Date;
  /** Injectable pour les tests : évite de dépendre d'une variable d'environnement. */
  recipient?: string | null;
}

export interface SendBusinessInquiryResult extends RawEmailResult {
  /** Sujet réellement envoyé — utile aux tests et au diagnostic. */
  subject: string;
}

export async function sendBusinessInquiryEmail(
  input: BusinessInquiryInput,
  options: SendBusinessInquiryOptions = {},
): Promise<SendBusinessInquiryResult> {
  const transport = options.transport ?? resendTransport;
  const submittedAt = options.now ?? new Date();
  const recipient = options.recipient !== undefined ? options.recipient : getBusinessContactRecipient();
  const subject = buildBusinessInquirySubject(input);

  if (!recipient) {
    // Aucun destinataire configuré : on ne tente pas l'envoi, et on ne fait
    // pas échouer la requête côté prospect pour autant (la route décide).
    console.error("[BusinessInquiry] B2B_CONTACT_RECIPIENT_EMAIL non configurée : email non envoyé.");
    return { status: "skipped", error: "B2B_CONTACT_RECIPIENT_EMAIL non configurée", subject };
  }

  const lines = buildBusinessInquiryLines(input, submittedAt);

  const html = renderBaseEmailHtml({
    preheader: `Demande de ${input.companyName}`,
    heading: "Nouvelle demande entreprise",
    bodyHtml: renderLinesHtml(lines),
    footer: BUSINESS_INQUIRY_FOOTER,
  });

  const text = renderBaseEmailText({
    heading: "Nouvelle demande entreprise",
    bodyText: renderLinesText(lines),
    footer: BUSINESS_INQUIRY_FOOTER,
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
