import { NextResponse } from "next/server";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteSubscriptionRecord } from "@/lib/supabase/billing";

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
  const { id } = await params;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const ok = await deleteSubscriptionRecord(sessionSupabase, id);
  if (!ok) {
    return NextResponse.json({ error: "Échec de la suppression de l'abonnement." }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
