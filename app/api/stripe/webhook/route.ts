import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { recordBillingEventIfNew } from "@/lib/supabase/billing";
import { getStripeClient } from "@/lib/stripe/client";
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
  handleSubscriptionDeleted,
  handleSubscriptionUpsert,
} from "@/lib/stripe/webhook-handlers";

/**
 * POST /api/stripe/webhook — point d'entrée unique des évènements Stripe
 * (chantier "supabase-stripe-payments-subscriptions"). Source de vérité
 * pour tout statut d'abonnement/paiement : jamais modifié autrement.
 *
 * Sécurité : signature Stripe vérifiée via STRIPE_WEBHOOK_SECRET avant tout
 * traitement (`stripe.webhooks.constructEvent`, nécessite le corps brut —
 * jamais `request.json()` avant vérification). Idempotent via
 * `billing_events.stripe_event_id` : un évènement déjà traité renvoie 200
 * immédiatement sans ré-exécuter les écritures.
 */
export async function POST(request: Request) {
  const stripe = getStripeClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !webhookSecret) {
    console.error("[Stripe webhook] STRIPE_SECRET_KEY et/ou STRIPE_WEBHOOK_SECRET manquantes.");
    return NextResponse.json({ error: "Stripe non configuré." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Signature Stripe manquante." }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error("[Stripe webhook] Signature invalide", error);
    return NextResponse.json({ error: "Signature invalide." }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    console.error("[Stripe webhook] Client Supabase service role indisponible.");
    return NextResponse.json({ error: "Supabase indisponible." }, { status: 503 });
  }

  const alreadyProcessed = await recordBillingEventIfNew(supabase, event.id, event.type, event as unknown as Record<string, unknown>);
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, deduplicated: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(supabase, event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
        await handleSubscriptionUpsert(supabase, event.data.object as Stripe.Subscription);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, event.data.object as Stripe.Subscription);
        break;
      case "invoice.payment_succeeded":
        await handleInvoicePaymentSucceeded(supabase, event.data.object as Stripe.Invoice);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(supabase, event.data.object as Stripe.Invoice);
        break;
      default:
        // Évènement reçu mais non géré par ce chantier — ignoré volontairement.
        break;
    }
  } catch (error) {
    console.error(`[Stripe webhook] Échec du traitement de ${event.type} (${event.id})`, error);
    return NextResponse.json({ error: "Échec du traitement." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
