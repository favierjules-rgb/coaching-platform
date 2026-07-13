import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentProfile } from "@/lib/supabase/auth";
import { normalizeEmail, NEWSLETTER_CONSENT_TEXT_VERSION } from "@/lib/newsletter/validation";
import {
  createSubscriber,
  findSubscriberByNormalizedEmail,
  findSubscriberByProfileId,
  updateSubscriberById,
  type NewsletterSubscriberRow,
} from "@/lib/newsletter/db";
import { deleteBrevoContact, upsertNewsletterContact } from "@/lib/brevo/client";

export const runtime = "nodejs";

async function requireProfile() {
  const user = await getCurrentUser();
  if (!user) return { error: NextResponse.json({ error: "Authentification requise." }, { status: 401 }) };
  const profile = await getCurrentProfile();
  if (!profile || !profile.email) {
    return { error: NextResponse.json({ error: "Profil introuvable." }, { status: 404 }) };
  }
  return { profile };
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

export async function GET() {
  const result = await requireProfile();
  if ("error" in result) return result.error;
  const { profile } = result;

  const subscriber = await findSubscriberByProfileId(profile.id);
  return NextResponse.json({
    subscribed: subscriber?.status === "subscribed",
    email: profile.email,
  });
}

export async function POST(request: Request) {
  const result = await requireProfile();
  if ("error" in result) return result.error;
  const { profile } = result;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { subscribed } = (body ?? {}) as { subscribed?: unknown };
  if (typeof subscribed !== "boolean") {
    return NextResponse.json({ error: "Paramètre 'subscribed' manquant." }, { status: 400 });
  }

  const normalizedEmail = normalizeEmail(profile.email);
  const nowIso = new Date().toISOString();

  const existing =
    (await findSubscriberByProfileId(profile.id)) ??
    (await findSubscriberByNormalizedEmail(normalizedEmail));

  if (subscribed) {
    const brevoResult = await upsertNewsletterContact(profile.email);
    const status = brevoResult.skipped
      ? "pending"
      : brevoResult.ok
        ? "subscribed"
        : "sync_failed";

    const historyEntry = {
      at: nowIso,
      event: "subscribe",
      status,
      consent_text_version: NEWSLETTER_CONSENT_TEXT_VERSION,
      source: "profile_toggle",
    };

    if (!existing) {
      await createSubscriber({
        email: profile.email,
        normalized_email: normalizedEmail,
        profile_id: profile.id,
        source: "profile_toggle",
        consent_text_version: NEWSLETTER_CONSENT_TEXT_VERSION,
        status,
        brevo_contact_id: brevoResult.ok ? brevoResult.brevoContactId : null,
        brevo_list_id: brevoResult.ok && brevoResult.listId ? String(brevoResult.listId) : null,
        last_sync_status: brevoResult.skipped ? "skipped" : brevoResult.ok ? "synced" : "failed",
        last_sync_error: brevoResult.ok || brevoResult.skipped ? null : brevoResult.error,
        metadata: appendHistory(null, historyEntry),
      });
    } else {
      await updateSubscriberById(existing.id, {
        profile_id: profile.id,
        status,
        consent_text_version: NEWSLETTER_CONSENT_TEXT_VERSION,
        consent_at: nowIso,
        unsubscribed_at: null,
        brevo_contact_id: brevoResult.ok ? brevoResult.brevoContactId : existing.brevo_contact_id,
        brevo_list_id:
          brevoResult.ok && brevoResult.listId
            ? String(brevoResult.listId)
            : existing.brevo_list_id,
        last_sync_status: brevoResult.skipped ? "skipped" : brevoResult.ok ? "synced" : "failed",
        last_sync_error: brevoResult.ok || brevoResult.skipped ? null : brevoResult.error,
        metadata: appendHistory(existing.metadata, historyEntry),
      });
    }

    return NextResponse.json({ subscribed: true });
  }

  // Turning the preference off.
  if (!existing) {
    return NextResponse.json({ subscribed: false });
  }

  const brevoResult = await deleteBrevoContact(existing.email);
  await updateSubscriberById(existing.id, {
    status: "unsubscribed",
    unsubscribed_at: nowIso,
    last_sync_status: brevoResult.skipped ? "skipped" : brevoResult.ok ? "synced" : "failed",
    last_sync_error: brevoResult.ok || brevoResult.skipped ? null : brevoResult.error,
    metadata: appendHistory(existing.metadata, {
      at: nowIso,
      event: "unsubscribe",
      via: "profile_toggle",
    }),
  });

  return NextResponse.json({ subscribed: false });
}
