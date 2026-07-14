import { NextResponse } from "next/server";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import {
  getSubscriberByIdForStaff,
  updateSubscriberById,
} from "@/lib/newsletter/db";
import { upsertNewsletterContact } from "@/lib/brevo/client";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { id } = (body ?? {}) as { id?: unknown };
  if (typeof id !== "string" || id.length === 0) {
    return NextResponse.json({ error: "Identifiant d'abonné manquant." }, { status: 400 });
  }

  const subscriber = await getSubscriberByIdForStaff(id);
  if (!subscriber) {
    return NextResponse.json({ error: "Abonné introuvable." }, { status: 404 });
  }

  const brevoResult = await upsertNewsletterContact(subscriber.email);

  const status = brevoResult.skipped
    ? "pending"
    : brevoResult.ok
      ? "subscribed"
      : "sync_failed";

  const updated = await updateSubscriberById(subscriber.id, {
    status: subscriber.status === "unsubscribed" ? subscriber.status : status,
    brevo_contact_id: brevoResult.ok ? brevoResult.brevoContactId : subscriber.brevo_contact_id,
    brevo_list_id:
      brevoResult.ok && brevoResult.listId
        ? String(brevoResult.listId)
        : subscriber.brevo_list_id,
    last_sync_status: brevoResult.skipped ? "skipped" : brevoResult.ok ? "synced" : "failed",
    last_sync_error: brevoResult.ok || brevoResult.skipped ? null : brevoResult.error,
  });

  if (!updated) {
    return NextResponse.json({ error: "Échec de la mise à jour." }, { status: 500 });
  }

  return NextResponse.json({ subscriber: updated }, { status: 200 });
}
