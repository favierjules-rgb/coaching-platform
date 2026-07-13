/** Shared validation helpers for the newsletter feature. */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return EMAIL_REGEX.test(trimmed);
}

/**
 * Normalizes an email for de-duplication: trims whitespace and lowercases.
 * We intentionally do NOT strip "+tags" or dots (Gmail-style aliasing) since
 * that would silently merge distinct addresses a user may rely on.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Current version string for the consent checkbox copy shown on the form. */
export const NEWSLETTER_CONSENT_TEXT_VERSION = "2026-07-fr-v1";

export const NEWSLETTER_CONSENT_TEXT =
  "J'accepte de recevoir par email les conseils, actualités et offres de SETH Préparation Physique. Je peux me désinscrire à tout moment.";
