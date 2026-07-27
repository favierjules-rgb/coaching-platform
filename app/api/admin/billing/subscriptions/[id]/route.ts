import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteSubscriptionRecord } from "@/lib/supabase/billing";
import { parseParams } from "@/lib/api/validate";
import { idParamSchema } from "@/lib/api/schemas/common";
import { requireAdmin } from "@/lib/api/authz";

/**
 * DELETE /api/admin/billing/subscriptions/[id] — supprime définitivement
 * une ligne `subscriptions` (chantier "supabase-stripe-payments-subscriptions").
 * Réservé au staff (RLS `subscriptions_manage_staff`, policy "for all").
 *
 * Nettoyage de données de test/erreur uniquement : n'annule rien côté
 * Stripe. Pour résilier un vrai abonnement actif, utiliser le Customer
 * Portal (`/api/stripe/create-customer-portal-session`) ou le dashboard
 * Stripe — cette route ne fait que supprimer la ligne miroir Supabase, le
 * webhook `customer.subscription.deleted` la recréerait/mettrait à jour si
 * l'abonnement existe toujours réellement côté Stripe.
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

  const ok = await deleteSubscriptionRecord(sessionSupabase, id);
  if (!ok) {
    return NextResponse.json({ error: "Échec de la suppression de l'abonnement." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
