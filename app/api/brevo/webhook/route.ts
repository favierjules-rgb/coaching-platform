import { NextResponse } from "next/server";
import { normalizeEmail } from "@/lib/newsletter/validation";
import {
  findSubscriberByNormalizedEmail,
  updateSubscriberByNormalizedEmail,
  type NewsletterSubscriberRow,
} from "@/lib/newsletter/db";

export const runtime = "nodejs";

/**
 * Brevo doesn't sign webhook payloads with an HMAC by default. The
 * recommended way to authenticate a Brevo webhook is to configure, in the
 * Brevo dashboard, a webhook URL that includes a shared secret as a query
 * parameter, e.g.:
 *
 *   https://<votre-domaine>/api/brevo/webhook?secret=<BREVO_WEBHOOK_SECRET>
 *
 * See docs/brevo-newsletter.md for the exact setup steps.
 */
function isAuthorized(request: Request): boolean {
  const expected = process.env.BREVO_WEBHOOK_SECRET;
  if (!expected) {
    console.error(
      "[Brevo webhook] BREVO_WEBHOOK_SECRET absente : webhook refusé par sécurité."
    );
    return false;
  }
  const url = new URL(request.url);
  const provided = url.searchParams.get("secret");
  return provided === expected;
}

interface BrevoWebhookEvent {
  event?: string;
  email?: string;
  date?: string;
  ts?: number;
  reason?: string;
  [key: string]: unknown;
}

function appendHistory(
  metadata: NewsletterSubscriberRow["metadata"] | null | undefined,
  entry: Record<string, unknown>
) {
  const history = Array.isArray((metadata ?? {}).history)
    ? ((metadata ?? {}).history as unknown[])
    : [];
  return { ...(metadata ?? {}), history: [...history, entry].slice(-20) };
}

async function handleEvent(event: BrevoWebhookEvent) {
  const email = event.email;
  const type = event.event;
  if (!email || !type) return;

  const normalizedEmail = normalizeEmail(email);
  const existing = await findSubscriberByNormalizedEmail(normalizedEmail);
  if (!existing) return; // Nothing to reconcile locally.

  const nowIso = new Date().toISOString();
  const historyEntry = { at: nowIso, event: `brevo_webhook:${type}` };

  switch (type) {
    case "unsubscribe":
      await updateSubscriberByNormalizedEmail(normalizedEmail, {
        status: "unsubscribed",
        unsubscribed_at: nowIso,
        last_sync_status: "synced",
        last_sync_error: null,
        metadata: appendHistory(existing.metadata, historyEntry),
      });
      return;

    case "hardBounce":
    case "bounce":
    case "hard_bounce":
      await updateSubscriberByNormalizedEmail(normalizedEmail, {
        status: "bounced",
        last_sync_status: "synced",
        last_sync_error: event.reason ?? null,
        metadata: appendHistory(existing.metadata, historyEntry),
      });
      return;

    case "spam":
    case "complaint":
      await updateSubscriberByNormalizedEmail(normalizedEmail, {
        status: "complained",
        last_sync_status: "synced",
        last_sync_error: null,
        metadata: appendHistory(existing.metadata, historyEntry),
      });
      return;

    case "delivered":
      await updateSubscriberByNormalizedEmail(normalizedEmail, {
        metadata: appendHistory(existing.metadata, historyEntry),
      });
      return;

    default:
      // Unknown/irrelevant event type: acknowledge without changing state.
      return;
  }
}

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed payload: acknowledge so Brevo doesn't retry forever.
    return NextResponse.json({ ok: true }, { status: 200 });
  }

  const events: BrevoWebhookEvent[] = Array.isArray(body)
    ? (body as BrevoWebhookEvent[])
    : [body as BrevoWebhookEvent];

  for (const event of events) {
    try {
      await handleEvent(event);
    } catch (error) {
      console.error("[Brevo webhook] Erreur de traitement d'un événement:", error);
    }
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
