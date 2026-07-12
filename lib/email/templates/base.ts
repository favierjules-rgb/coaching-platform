import "server-only";

/**
 * Composant HTML de base partagé par tous les emails transactionnels
 * (chantier "supabase-resend-transactional-emails") : header (logo texte
 * "SETH" + "Préparation Physique", identique à components/ui/Logo.tsx),
 * contenu, bouton principal, footer avec adresse de contact. Mise en page
 * en tableaux HTML (compatible Outlook/clients email anciens — pas de
 * flexbox/grid), styles principalement inline (les styles `<style>` ne
 * sont qu'un bonus mobile, jamais requis pour un rendu correct). Couleurs
 * alignées sur app/globals.css (fond sombre, texte clair, bouton rouge
 * `--primary`).
 */

const COLORS = {
  background: "#0a0a0a",
  card: "#121212",
  foreground: "#f5f5f4",
  muted: "#a3a3a3",
  border: "#2a2a2a",
  primary: "#d62828",
  primaryForeground: "#ffffff",
};

export interface EmailButton {
  label: string;
  url: string;
}

export interface BaseEmailInput {
  /** Texte d'aperçu caché (affiché par les clients mail à côté du sujet), jamais visible dans le corps rendu. */
  preheader?: string;
  heading: string;
  /** Paragraphes déjà échappés/formatés en HTML simple (`<p>`, `<strong>`, `<br>`) — voir escapeHtml ci-dessous pour toute donnée utilisateur. */
  bodyHtml: string;
  button?: EmailButton;
  secondaryButton?: EmailButton;
  /** Bloc additionnel optionnel (ex : détails d'une formule) inséré après bodyHtml, avant le(s) bouton(s). */
  detailsHtml?: string;
}

/** Échappe une valeur avant de l'insérer dans du HTML — toute donnée provenant de Supabase (nom, titre...) doit passer par ici avant d'être concaténée dans un template. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderButton(button: EmailButton, primary: boolean): string {
  const bg = primary ? COLORS.primary : "transparent";
  const color = primary ? COLORS.primaryForeground : COLORS.foreground;
  const border = primary ? COLORS.primary : COLORS.border;
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto;">
      <tr>
        <td align="center" style="border-radius: 2px; background-color: ${bg}; border: 1px solid ${border};">
          <a href="${escapeHtml(button.url)}" target="_blank" rel="noopener noreferrer"
             style="display: inline-block; padding: 14px 32px; font-family: Arial, Helvetica, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: ${color}; text-decoration: none;">
            ${escapeHtml(button.label)}
          </a>
        </td>
      </tr>
    </table>`;
}

export function renderBaseEmailHtml(input: BaseEmailInput): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
  const replyTo = process.env.RESEND_REPLY_TO || "";

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="X-UA-Compatible" content="IE=edge" />
    <title>${escapeHtml(input.heading)}</title>
    <style>
      @media only screen and (max-width: 600px) {
        .email-container { width: 100% !important; }
        .email-padding { padding-left: 20px !important; padding-right: 20px !important; }
      }
    </style>
  </head>
  <body style="margin: 0; padding: 0; background-color: ${COLORS.background}; font-family: Arial, Helvetica, sans-serif;">
    ${input.preheader ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(input.preheader)}</div>` : ""}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: ${COLORS.background};">
      <tr>
        <td align="center" style="padding: 32px 16px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="email-container" style="width: 600px; max-width: 100%; background-color: ${COLORS.card}; border: 1px solid ${COLORS.border};">
            <tr>
              <td class="email-padding" style="padding: 32px 32px 24px 32px; border-bottom: 1px solid ${COLORS.border};">
                <span style="font-family: Arial, Helvetica, sans-serif; font-size: 20px; font-weight: 800; font-style: italic; letter-spacing: 0.03em; color: ${COLORS.foreground};">SETH</span>
                <span style="font-family: Arial, Helvetica, sans-serif; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; color: ${COLORS.muted}; margin-left: 8px;">Préparation Physique</span>
              </td>
            </tr>
            <tr>
              <td class="email-padding" style="padding: 32px;">
                <h1 style="margin: 0 0 20px 0; font-family: Arial, Helvetica, sans-serif; font-size: 22px; font-weight: 800; text-transform: uppercase; color: ${COLORS.foreground};">
                  ${escapeHtml(input.heading)}
                </h1>
                <div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.6; color: ${COLORS.foreground};">
                  ${input.bodyHtml}
                </div>
                ${input.detailsHtml ? `<div style="margin-top: 20px; padding: 16px 20px; background-color: ${COLORS.background}; border: 1px solid ${COLORS.border};">${input.detailsHtml}</div>` : ""}
                ${
                  input.button || input.secondaryButton
                    ? `<div style="margin-top: 28px;">
                        ${input.button ? renderButton(input.button, true) : ""}
                        ${input.secondaryButton ? `<div style="margin-top: 12px;">${renderButton(input.secondaryButton, false)}</div>` : ""}
                      </div>`
                    : ""
                }
              </td>
            </tr>
            <tr>
              <td class="email-padding" style="padding: 24px 32px; border-top: 1px solid ${COLORS.border};">
                <p style="margin: 0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${COLORS.muted};">
                  SETH Préparation Physique${appUrl ? ` — <a href="${escapeHtml(appUrl)}" style="color: ${COLORS.muted};">${escapeHtml(appUrl.replace(/^https?:\/\//, ""))}</a>` : ""}
                </p>
                ${replyTo ? `<p style="margin: 0 0 4px 0; font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: ${COLORS.muted};">Une question ? Réponds directement à cet email${replyTo ? ` (${escapeHtml(replyTo)})` : ""}.</p>` : ""}
                <p style="margin: 0; font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: ${COLORS.muted};">
                  Cet email transactionnel t'a été envoyé suite à une action sur ton compte SETH Préparation Physique.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface BaseEmailTextInput {
  heading: string;
  bodyText: string;
  button?: EmailButton;
  secondaryButton?: EmailButton;
}

/** Version texte brut en complément du HTML (RFC 2183 multipart/alternative) — mêmes informations, sans mise en forme. */
export function renderBaseEmailText(input: BaseEmailTextInput): string {
  const lines = [`SETH PRÉPARATION PHYSIQUE`, ``, input.heading.toUpperCase(), ``, input.bodyText];
  if (input.button) lines.push(``, `${input.button.label} : ${input.button.url}`);
  if (input.secondaryButton) lines.push(``, `${input.secondaryButton.label} : ${input.secondaryButton.url}`);
  const replyTo = process.env.RESEND_REPLY_TO;
  lines.push(``, `---`, replyTo ? `Une question ? Réponds à cet email (${replyTo}).` : `SETH Préparation Physique`);
  return lines.join("\n");
}
