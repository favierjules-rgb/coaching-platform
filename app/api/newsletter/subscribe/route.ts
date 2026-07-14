import { NextResponse } from "next/server";
import {
  isValidEmail,
  normalizeEmail,
  NEWSLETTER_CONSENT_TEXT_VERSION,
} from "@/lib/newsletter/validation";
import { checkRateLimit, getClientIp } from "@/lib/newsletter/rate-limit";
import {
  createSubscriber,
  findSubscriberByNormalizedEmail,
  updateSubscriberByNormalizedEmail,
  type NewsletterSubscriberRow,
} from "@/lib/newsletter/db";
import { upsertNewsletterContact } from "@/lib/brevo/client";

export const runtime = "nodejs";

const GENERIC_SUCCESS_MESSAGE =
  "Merci ! Votre inscription a bien été prise en compte.";

function appendHistory(
  metadata: Record<string, unknown> | null | undefined,
  entry: Record<string, unknown>
): Record<string, unknown> {
  const history = Array.isArray((metadata ?? {}).history)
    ? ((metadata ?? {}).history as unknown[])
    : [];
  return { ...(metadata ?? {}), history: [...history, entry].slice(-20) };
}

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`newsletter_subscribe:${ip}`, 5, 10 * 60 * 1000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Trop de tentatives. Réessayez plus tard." },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { email, consent, source } = (body ?? {}) as {
    email?: unknown;
    consent?: unknown;
    source?: unknown;
  };

  if (typeof email !== "string" || !isValidEmail(email)) {
    return NextResponse.json({ error: "Adresse email invalide." }, { status: 400 });
  }
  if (consent !== true) {
    return NextResponse.json(
      { error: "Le consentement est requis pour s'inscrire." },
      { status: 400 }
    );
  }

  const normalizedEmail = normalizeEmail(email);
  const nowIso = new Date().toISOString();
  const resolvedSource = typeof source === "string" && source.trim() ? source.trim() : "landing_page";

  const existing = await findSubscriberByNormalizedEmail(normalizedEmail);

  // Attempt the Brevo sync before finalizing the row's status, so the DB
  // reflects the real outcome (subscribed / pending / sync_failed).
  const brevoResult = await upsertNewsletterContact(email);

  let status: NewsletterSubscriberRow["status"];
  let lastSyncStatus: string;
  let lastSyncError: string | null;

  if (brevoResult.skipped) {
    status = "pending";
    lastSyncStatus = "skipped";
    lastSyncError = null;
  } else if (brevoResult.ok) {
    status = "subscribed";
    lastSyncStatus = "synced";
    lastSyncError = null;
  } else {
    status = "sync_failed";
    lastSyncStatus = "failed";
    lastSyncError = brevoResult.error;
    console.error(
      "[Newsletter] Échec de synchronisation Brevo pour un abonné (email masqué):",
      brevoResult.error
    );
  }

  const historyEntry = {
    at: nowIso,
    event: "subscribe",
    status,
    consent_text_version: NEWSLETTER_CONSENT_TEXT_VERSION,
    source: resolvedSource,
  };

  if (!existing) {
    await createSubscriber({
      email,
      normalized_email: normalizedEmail,
      source: resolvedSource,
      consent_text_version: NEWSLETTER_CONSENT_TEXT_VERSION,
      status,
      brevo_contact_id: brevoResult.ok ? brevoResult.brevoContactId : null,
      brevo_list_id: brevoResult.ok && brevoResult.listId ? String(brevoResult.listId) : null,
      last_sync_status: lastSyncStatus,
      last_sync_error: lastSyncError,
      metadata: appendHistory(null, historyEntry),
    });
  } else {
    await updateSubscriberByNormalizedEmail(normalizedEmail, {
      email,
      status,
      source: resolvedSource,
      consent_text_version: NEWSLETTER_CONSENT_TEXT_VERSION,
      consent_at: nowIso,
      unsubscribed_at: status === "subscribed" ? null : existing.unsubscribed_at,
      brevo_contact_id: brevoResult.ok ? brevoResult.brevoContactId : existing.brevo_contact_id,
      brevo_list_id:
        brevoResult.ok && brevoResult.listId
          ? String(brevoResult.listId)
          : existing.brevo_list_id,
      last_sync_status: lastSyncStatus,
      last_sync_error: lastSyncError,
      metadata: appendHistory(existing.metadata, historyEntry),
    });
  }

  // Always a generic, non-enumerating response: we never reveal whether the
  // address was already known.
  return NextResponse.json({ message: GENERIC_SUCCESS_MESSAGE }, { status: 200 });
}
