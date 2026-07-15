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
import { checkRateLimit, getClientIp } from "@/lib/newsletter/rate-limit";

export const runtime = "nodejs";

const GENERIC_MESSAGE = "Vous avez bien été désinscrit(e) de la newsletter.";

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`newsletter_unsubscribe:${ip}`, 10, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez plus tard." },
      { status: 429 }
    );
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
