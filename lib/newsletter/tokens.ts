import { createHmac, timingSafeEqual } from "crypto";

/**
 * Signed, single-purpose unsubscribe tokens.
 *
 * We never put a plain email address in a URL. Instead
 * `/newsletter/desinscription` is reached with `?token=...`, a compact
 * HMAC-signed payload that encodes the email address, its purpose, and an
 * expiry. The token is verified server-side before any unsubscribe action is
 * taken.
 *
 * The signing secret reuses `BREVO_WEBHOOK_SECRET` (already a required,
 * server-only secret dedicated to this newsletter feature) rather than
 * introducing a 6th environment variable. See docs/brevo-newsletter.md.
 */

const TOKEN_PURPOSE = "newsletter_unsubscribe";
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSigningSecret(): string | null {
  const secret = process.env.BREVO_WEBHOOK_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + padding, "base64").toString("utf8");
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export interface UnsubscribeTokenPayload {
  email: string;
  purpose: typeof TOKEN_PURPOSE;
  exp: number; // unix ms
}

export interface CreateTokenResult {
  token: string | null;
  reason?: "missing_secret";
}

export function createUnsubscribeToken(
  email: string,
  ttlMs: number = DEFAULT_TTL_MS
): CreateTokenResult {
  const secret = getSigningSecret();
  if (!secret) {
    console.warn(
      "[Newsletter] BREVO_WEBHOOK_SECRET absente. Impossible de signer un lien de désinscription."
    );
    return { token: null, reason: "missing_secret" };
  }

  const payload: UnsubscribeTokenPayload = {
    email,
    purpose: TOKEN_PURPOSE,
    exp: Date.now() + ttlMs,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);
  return { token: `${encodedPayload}.${signature}` };
}

export type VerifyTokenResult =
  | { valid: true; email: string }
  | { valid: false; reason: "malformed" | "missing_secret" | "bad_signature" | "expired" | "wrong_purpose" };

export function verifyUnsubscribeToken(token: string): VerifyTokenResult {
  const secret = getSigningSecret();
  if (!secret) {
    return { valid: false, reason: "missing_secret" };
  }

  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "malformed" };
  }
  const [encodedPayload, signature] = parts;

  const expectedSignature = sign(encodedPayload, secret);
  const expectedBuf = Buffer.from(expectedSignature, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (
    expectedBuf.length !== actualBuf.length ||
    !timingSafeEqual(expectedBuf, actualBuf)
  ) {
    return { valid: false, reason: "bad_signature" };
  }

  let payload: UnsubscribeTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (payload.purpose !== TOKEN_PURPOSE) {
    return { valid: false, reason: "wrong_purpose" };
  }
  if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return { valid: false, reason: "expired" };
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    return { valid: false, reason: "malformed" };
  }

  return { valid: true, email: payload.email };
}
