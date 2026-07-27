import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteStripePayment } from "@/lib/supabase/billing";
import { parseParams } from "@/lib/api/validate";
import { idParamSchema } from "@/lib/api/schemas/common";
import { requireAdmin } from "@/lib/api/authz";

/**
 * DELETE /api/admin/billing/payments/[id] — supprime définitivement une
 * ligne `stripe_payments` (chantier "supabase-stripe-payments-subscriptions").
 * Réservé au staff (RLS `stripe_payments_manage_staff`, policy "for all").
 *
 * Nettoyage de données de test/erreur uniquement : ne rembourse ni
 * n'annule rien côté Stripe (voir le Customer Portal / dashboard Stripe
 * pour une vraie action sur le paiement réel). Le webhook Stripe peut
 * réécrire une ligne équivalente si l'évènement Stripe correspondant est
 * retraité (aucune suppression du billing_events associé).
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsedParams = parseParams(await params, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;
  const { id } = parsedParams.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  // Action globale ou destructive : administrateur uniquement (H-3).
  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;

  const ok = await deleteStripePayment(sessionSupabase, id);
  if (!ok) {
    return NextResponse.json({ error: "Échec de la suppression du paiement." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
