import { NextResponse } from "next/server";

import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingCustomerForStudent } from "@/lib/supabase/billing";
import { getStudentById } from "@/lib/supabase/students";
import { getResolvedPlanByKey } from "@/lib/stripe/plans-server";
import { getStripeClient } from "@/lib/stripe/client";

/**
 * POST /api/stripe/create-checkout-session — crée une session Stripe
 * Checkout (mode subscription) pour un élève. Appelable par l'élève
 * lui-même (uniquement pour son propre student_id) ou par un coach/admin
 * (pour n'importe quel élève) — jamais par un élève pour un autre élève
 * (chantier "supabase-stripe-payments-subscriptions").
 *
 * Body attendu : { studentId: string, planKey: string }.
 */
export async function POST(request: Request) {
  let body: { studentId?: string; planKey?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide." }, { status: 400 });
  }

  const { studentId, planKey } = body;
  if (!studentId || !planKey) {
    return NextResponse.json({ error: "studentId et planKey sont requis." }, { status: 400 });
  }

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
      return NextResponse.json({ error: "Un élève ne peut créer une session de paiement que pour lui-même." }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  const plan = getResolvedPlanByKey(planKey);
  if (!plan) {
    return NextResponse.json({ error: "Formule inconnue ou non configurée (price_id manquant en environnement)." }, { status: 400 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquante)." }, { status: 503 });
  }

  const adminSupabase = createSupabaseAdminClient();
  if (!adminSupabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const [student, existingCustomer] = await Promise.all([
    getStudentById(adminSupabase, studentId),
    getBillingCustomerForStudent(adminSupabase, studentId),
  ]);
  if (!student) {
    return NextResponse.json({ error: "Élève introuvable." }, { status: 404 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: existingCustomer?.stripeCustomerId,
      customer_email: existingCustomer ? undefined : student.email || undefined,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${appUrl}/dashboard?payment=success`,
      cancel_url: `${appUrl}/profil?payment=cancelled`,
      client_reference_id: studentId,
      metadata: {
        student_id: studentId,
        email: student.email,
        plan_name: plan.label,
      },
      subscription_data: {
        metadata: {
          student_id: studentId,
          plan_name: plan.label,
        },
      },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("[Stripe] create-checkout-session", error);
    return NextResponse.json({ error: "Échec de la création de la session de paiement." }, { status: 502 });
  }
}
