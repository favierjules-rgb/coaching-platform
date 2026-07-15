import { NextResponse } from "next/server";

import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingCustomerForStudent } from "@/lib/supabase/billing";
import { getStudentById, getStudentProfile } from "@/lib/supabase/students";
import { getSubscriptionTemplateById } from "@/lib/supabase/subscription-templates";
import { getResolvedPlanByKey } from "@/lib/stripe/plans-server";
import { getStripeClient } from "@/lib/stripe/client";
import { parseJsonBody } from "@/lib/api/validate";
import { createCheckoutSessionBodySchema } from "@/lib/api/schemas/stripe";

/**
 * POST /api/stripe/create-checkout-session — crée une session Stripe
 * Checkout pour un élève. Appelable par l'élève lui-même (uniquement pour
 * son propre student_id) ou par un coach/admin (pour n'importe quel élève)
 * — jamais par un élève pour un autre élève (chantier
 * "supabase-stripe-payments-subscriptions", étendu par
 * "supabase-subscription-templates").
 *
 * Body attendu : { studentId: string, templateId?: string, planKey?: string }.
 *
 * **Élève** : `templateId`/`planKey` envoyés par le client sont **ignorés**
 * — l'élève ne choisit jamais librement une formule. Le modèle facturé est
 * systématiquement résolu côté serveur depuis
 * `student_profiles.assigned_subscription_template_id` (attribué par un
 * coach/admin). Si aucun modèle n'est attribué, la création échoue
 * explicitement (400) plutôt que de retomber sur un choix arbitraire.
 *
 * **Admin/coach** : `templateId` (table `subscription_templates`, source
 * prioritaire) ou `planKey` (mapping statique par variable d'environnement,
 * `lib/stripe/plans-server.ts`, repli temporaire) peut être choisi librement
 * pour n'importe quel élève.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createCheckoutSessionBodySchema);
  if (!parsed.success) return parsed.response;
  const { studentId, templateId: bodyTemplateId, planKey: bodyPlanKey } = parsed.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  const role = await getCurrentUserRole();
  const isStudentCaller = role === "student";
  if (isStudentCaller) {
    const ownStudentId = await getCurrentStudentId(sessionSupabase);
    if (!ownStudentId || ownStudentId !== studentId) {
      return NextResponse.json({ error: "Un élève ne peut créer une session de paiement que pour lui-même." }, { status: 403 });
    }
  } else if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  // L'élève ne choisit jamais la formule : on résout systématiquement le
  // modèle attribué par le coach côté serveur, en ignorant tout templateId/
  // planKey éventuellement envoyé par le client.
  let templateId: string | null = null;
  let planKey: string | null = null;
  if (isStudentCaller) {
    const profile = await getStudentProfile(sessionSupabase, studentId);
    if (!profile?.assignedSubscriptionTemplateId) {
      return NextResponse.json({ error: "Aucune formule ne vous a encore été attribuée. Contactez votre coach." }, { status: 400 });
    }
    templateId = profile.assignedSubscriptionTemplateId;
  } else {
    templateId = bodyTemplateId ?? null;
    planKey = bodyPlanKey ?? null;
    if (!templateId && !planKey) {
      return NextResponse.json({ error: "templateId ou planKey est requis." }, { status: 400 });
    }
  }

  let priceId: string | null = null;
  let planLabel = "";
  let resolvedTemplateId: string | null = null;
  let mode: "subscription" | "payment" = "subscription";

  if (templateId) {
    const template = await getSubscriptionTemplateById(sessionSupabase, templateId);
    if (!template || !template.stripePriceId) {
      return NextResponse.json({ error: "Modèle d'abonnement introuvable ou sans prix Stripe configuré." }, { status: 400 });
    }
    priceId = template.stripePriceId;
    planLabel = template.name;
    resolvedTemplateId = template.id;
    mode = template.billingInterval === "one_time" ? "payment" : "subscription";
  } else if (planKey) {
    const plan = getResolvedPlanByKey(planKey);
    if (!plan) {
      return NextResponse.json({ error: "Formule inconnue ou non configurée (price_id manquant en environnement)." }, { status: 400 });
    }
    priceId = plan.priceId;
    planLabel = plan.label;
  }

  if (!priceId) {
    return NextResponse.json({ error: "Aucun price_id Stripe résolu pour cette formule." }, { status: 400 });
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

  const metadata: Record<string, string> = {
    student_id: studentId,
    email: student.email,
    plan_name: planLabel,
    price_id: priceId,
  };
  if (resolvedTemplateId) {
    metadata.template_id = resolvedTemplateId;
    metadata.template_name = planLabel;
  }

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode,
      customer: existingCustomer?.stripeCustomerId,
      customer_email: existingCustomer ? undefined : student.email || undefined,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/paiement/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/paiement/cancel`,
      client_reference_id: studentId,
      metadata,
      ...(mode === "subscription" ? { subscription_data: { metadata } } : {}),
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("[Stripe] create-checkout-session", error);
    const message = error instanceof Error ? error.message : "Échec de la création de la session de paiement.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
