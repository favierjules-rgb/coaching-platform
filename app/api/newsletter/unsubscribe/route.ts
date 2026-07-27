import { NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/newsletter/tokens";
import { parseJsonBody } from "@/lib/api/validate";
import { newsletterUnsubscribeBodySchema } from "@/lib/api/schemas/newsletter";
import { normalizeEmail } from "@/lib/newsletter/validation";
import {
  findSubscriberByNormalizedEmail,
  updateSubscriberByNormalizedEmail,
} from "@/lib/newsletter/db";
import { deleteBrevoContact } from "@/lib/brevo/client";
import {
  consumeRateLimit,
  getTrustedClientIp,
  refusDeLimite,
  rateLimitKey,
} from "@/lib/security/rate-limit";
import { NEWSLETTER_UNSUBSCRIBE_IP } from "@/lib/security/rules";

export const runtime = "nodejs";

const GENERIC_MESSAGE = "Vous avez bien été désinscrit(e) de la newsletter.";

export async function POST(request: Request) {
  // getTrustedClientIp ignore `X-Forwarded-For` en production (correctif H-2).
  const ip = getTrustedClientIp(request);
  const rateLimit = await consumeRateLimit(rateLimitKey(["newsletter_unsubscribe", ip]), NEWSLETTER_UNSUBSCRIBE_IP);
  if (!rateLimit.allowed) {
    // 429 quota dépassé / 503 magasin indisponible — dans ce second cas,
    // aucun appel à Brevo n'est effectué (arbitrage H-2).
    return refusDeLimite(rateLimit, "Trop de tentatives. Réessayez plus tard.");
  }

  const parsed = await parseJsonBody(request, newsletterUnsubscribeBodySchema);
  if (!parsed.success) return parsed.response;
  const { token } = parsed.data;

  const verified = verifyUnsubscribeToken(token);
  if (!verified.valid) {
    return NextResponse.json(
      { error: "Ce lien de désinscription est invalide ou a expiré." },
      { status: 400 }
    );
  }

  const normalizedEmail = normalizeEmail(verified.email);
  const existing = await findSubscriberByNormalizedEmail(normalizedEmail);

  if (!existing) {
    // Idempotent / anti-enumeration: behave the same whether or not the
    // address is known to us.
    return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
  }

  const brevoResult = await deleteBrevoContact(existing.email);

  const history = Array.isArray((existing.metadata ?? {}).history)
    ? ((existing.metadata ?? {}).history as unknown[])
    : [];

  await updateSubscriberByNormalizedEmail(normalizedEmail, {
    status: "unsubscribed",
    unsubscribed_at: new Date().toISOString(),
    last_sync_status: brevoResult.skipped
      ? "skipped"
      : brevoResult.ok
        ? "synced"
        : "failed",
    last_sync_error: brevoResult.ok || brevoResult.skipped ? null : brevoResult.error,
    metadata: {
      ...(existing.metadata ?? {}),
      history: [
        ...history,
        { at: new Date().toISOString(), event: "unsubscribe", via: "token" },
      ].slice(-20),
    },
  });

  return NextResponse.json({ message: GENERIC_MESSAGE }, { status: 200 });
}
