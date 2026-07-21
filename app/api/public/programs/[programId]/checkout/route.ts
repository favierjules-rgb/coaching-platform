import { NextResponse } from "next/server";

import { idParamSchema } from "@/lib/api/schemas/common";
import { publicProgramCheckoutBodySchema } from "@/lib/api/schemas/stripe";
import { parseJsonBody, parseParams } from "@/lib/api/validate";
import { CGV_PROGRAMME_CONSENT_TEXT_VERSION, RETRACTATION_WAIVER_CONSENT_TEXT_VERSION } from "@/lib/legal-consents";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";

/**
 * POST /api/public/programs/[programId]/checkout — session Stripe Checkout
 * **anonyme** pour un programme public payant, mode "payment" (achat
 * unique, jamais "subscription") — chantier module Programmation, étape 6.
 * Contrairement à /api/stripe/create-checkout-session (toujours
 * authentifié, studentId déjà existant), aucun compte n'existe encore ici :
 * l'identité (prénom/nom/email) voyage dans les metadata de la session pour
 * que le webhook (checkout.session.completed) puisse provisionner le compte
 * après paiement confirmé — voir lib/stripe/webhook-handlers.ts et
 * lib/supabase/public-program-provisioning.ts. `customer_creation: "always"`
 * garantit un Customer Stripe même sans compte élève préexistant.
 */
export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const routeParams = await params;
  const parsedParams = parseParams({ id: routeParams.programId }, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;

  const parsedBody = await parseJsonBody(request, publicProgramCheckoutBodySchema);
  if (!parsedBody.success) return parsedBody.response;

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, name, status, is_public, public_subscription_template_id")
    .eq("id", parsedParams.data.id)
    .maybeSingle();
  if (programError) {
    console.error(`[public/programs/checkout] lecture programme : ${programError.message}`);
  }

  // status !== "actif" couvre aussi bien un programme archivé après coup
  // qu'un lien direct vers un brouillon jamais publié (correctif : un
  // programme archivé restait achetable via un lien déjà partagé).
  if (!program || !program.is_public || program.status !== "actif" || !program.public_subscription_template_id) {
    return NextResponse.json({ error: "Programme introuvable ou non payant." }, { status: 404 });
  }

  const { data: template, error: templateError } = await supabase
    .from("subscription_templates")
    .select("stripe_price_id, billing_interval")
    .eq("id", program.public_subscription_template_id)
    .maybeSingle();
  if (templateError) {
    console.error(`[public/programs/checkout] lecture formule : ${templateError.message}`);
  }
  if (!template?.stripe_price_id || template.billing_interval !== "one_time") {
    return NextResponse.json({ error: "Ce programme n'a pas de prix Stripe valide configuré." }, { status: 400 });
  }

  const stripe = getStripeClient();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe non configuré (STRIPE_SECRET_KEY manquante)." }, { status: 503 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
  const metadata: Record<string, string> = {
    public_program_id: program.id,
    program_name: program.name,
    first_name: parsedBody.data.firstName,
    last_name: parsedBody.data.lastName,
    email: parsedBody.data.email,
    // Preuve de consentement CGV (chantier conformité juridique/RGPD, lot
    // technique — juillet 2026) : la metadata Stripe est le seul support
    // qui traverse le paiement anonyme jusqu'au webhook, où elle est
    // reportée dans legal_consents une fois le compte élève créé — voir
    // lib/stripe/webhook-handlers.ts et
    // lib/supabase/public-program-provisioning.ts.
    cgv_accepted: "true",
    cgv_version: CGV_PROGRAMME_CONSENT_TEXT_VERSION,
    // Idem pour les deux consentements de rétractation (Lot E) — obligatoires
    // ici (publicProgramCheckoutBodySchema), jamais sur le chemin gratuit.
    retractation_waiver_accepted: "true",
    retractation_waiver_version: RETRACTATION_WAIVER_CONSENT_TEXT_VERSION,
  };

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      customer_creation: "always",
      customer_email: parsedBody.data.email,
      line_items: [{ price: template.stripe_price_id, quantity: 1 }],
      success_url: `${appUrl}/programmes/merci?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/programmes/${program.id}`,
      metadata,
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("[Stripe] public program checkout", error);
    const message = error instanceof Error ? error.message : "Échec de la création de la session de paiement.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
