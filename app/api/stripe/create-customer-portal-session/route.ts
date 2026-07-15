import { NextResponse } from "next/server";

import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingCustomerForStudent } from "@/lib/supabase/billing";
import { getStripeClient } from "@/lib/stripe/client";
import { parseJsonBody } from "@/lib/api/validate";
import { createCustomerPortalSessionBodySchema } from "@/lib/api/schemas/stripe";

/**
 * POST /api/stripe/create-customer-portal-session — ouvre le portail
 * client Stripe (gestion moyen de paiement, factures, résiliation) pour un
 * élève ayant déjà un `billing_customers` (donc déjà passé par Checkout au
 * moins une fois). Mêmes règles d'autorisation que create-checkout-session.
 *
 * Body attendu : { studentId: string }.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createCustomerPortalSessionBodySchema);
  if (!parsed.success) return parsed.response;
  const { studentId } = parsed.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  const role = await getCurrentUserRole();
  if (role === "student") {
    const ownStudentId = await getCurrentStudentId(sessionSupabase);
    if (!ownStudentId || ownStudentId !== studentId) {
      return NextResponse.json({ error: "Un élève ne peut ouvrir le portail que pour lui-même." }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquante)." }, { status: 503 });
  }

  const adminSupabase = createSupabaseAdminClient();
  if (!adminSupabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const customer = await getBillingCustomerForStudent(adminSupabase, studentId);
  if (!customer) {
    return NextResponse.json({ error: "Aucun client Stripe pour cet élève — aucun paiement n'a encore été initié." }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.stripeCustomerId,
      return_url: `${appUrl}/profil`,
    });
    return NextResponse.json({ url: portalSession.url });
  } catch (error) {
    console.error("[Stripe] create-customer-portal-session", error);
    return NextResponse.json({ error: "Échec de l'ouverture du portail client." }, { status: 502 });
  }
}
