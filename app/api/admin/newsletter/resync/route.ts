import { NextResponse } from "next/server";
import { parseJsonBody } from "@/lib/api/validate";
import { newsletterResyncBodySchema } from "@/lib/api/schemas/newsletter";
import {
  getSubscriberByIdForStaff,
  updateSubscriberById,
} from "@/lib/newsletter/db";
import { upsertNewsletterContact } from "@/lib/brevo/client";
import { requireAdmin } from "@/lib/api/authz";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Action globale ou destructive : administrateur uniquement (H-3).
  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;

  const parsed = await parseJsonBody(request, newsletterResyncBodySchema);
  if (!parsed.success) return parsed.response;
  const { id } = parsed.data;

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
