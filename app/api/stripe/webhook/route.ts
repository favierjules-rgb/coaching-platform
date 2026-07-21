import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  acquirePublicProgramPurchaseEventLock,
  markPublicProgramPurchaseEventFailed,
  markPublicProgramPurchaseEventProcessed,
  recordBillingEventIfNew,
} from "@/lib/supabase/billing";
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
 * jamais `request.json()` avant vérification).
 *
 * Idempotence — DEUX mécanismes distincts, choisis selon l'évènement
 * (chantier conformité juridique/RGPD, Lot E-bis technique — correction de
 * la fenêtre d'échec consentements/email/activation, suite audit) :
 *
 * 1. Achat d'un programme public payant (checkout.session.completed avec
 *    metadata.public_program_id) : acquirePublicProgramPurchaseEventLock,
 *    qui autorise un nouvel essai tant que le traitement précédent n'a pas
 *    entièrement réussi (voir lib/supabase/billing.ts). Acquisition
 *    ATOMIQUE (correctif suite audit — plus un simple read-then-write) :
 *    insert unique + update conditionnel avec vérification des lignes
 *    effectivement modifiées, quatre issues possibles — "proceed"
 *    (verrou acquis, on traite), "already_processed" (terminé avec succès,
 *    on acquitte 200), "already_processing" (un autre traitement est
 *    réellement en cours ou son lease n'a pas encore expiré : AUCUN effet
 *    métier, mais on répond 409 — PAS 200 — pour ne jamais acquitter
 *    prématurément une livraison dont on ne sait pas encore si l'autre
 *    traitement va réussir ; voir le commentaire détaillé sur cette branche
 *    plus bas), "lock_error" (panne DB à l'acquisition elle-même, on répond
 *    500 sans rien marquer). L'évènement n'est marqué "processed" qu'APRÈS
 *    la réussite complète de handleCheckoutSessionCompleted — jamais avant.
 *    En cas d'échec, markPublicProgramPurchaseEventFailed journalise la
 *    raison et la route répond 500 : Stripe programme automatiquement un
 *    nouvel essai.
 *
 * 2. Tout le reste (abonnements, factures, checkout.session.completed pour
 *    un ABONNEMENT — pas un programme public) : recordBillingEventIfNew,
 *    comportement historique inchangé — un évènement déjà vu renvoie 200
 *    immédiatement sans ré-exécuter les écritures. Ces handlers n'ont pas
 *    la même problématique (pas de séquence consentement → email →
 *    activation à protéger) et restent donc sur le mécanisme simple.
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

  // N'utiliser le verrou "reprenable" QUE pour l'achat d'un programme public
  // payant — un checkout.session.completed pour un abonnement (pas de
  // metadata.public_program_id) continue d'utiliser le mécanisme simple,
  // exactement comme tous les autres types d'évènements ci-dessous.
  const isPublicProgramPurchase =
    event.type === "checkout.session.completed" && Boolean((event.data.object as Stripe.Checkout.Session).metadata?.public_program_id);

  if (isPublicProgramPurchase) {
    const lockResult = await acquirePublicProgramPurchaseEventLock(supabase, event.id, event.type, event as unknown as Record<string, unknown>);
    // "already_processed" : traitement RÉELLEMENT terminé avec succès —
    // aucun effet métier à rejouer, on acquitte normalement (200).
    if (lockResult === "already_processed") {
      return NextResponse.json({ received: true, deduplicated: true });
    }
    // "already_processing" (suite audit, correctif comportement HTTP) :
    // aucun effet métier ici non plus, MAIS on ne sait PAS encore si l'autre
    // traitement en cours va réussir — répondre 200 serait un acquittement
    // PRÉMATURÉ de CETTE livraison Stripe. Si ce traitement concurrent
    // échoue silencieusement (crash du premier worker) après qu'on a
    // répondu 200 ici, Stripe ne retentera plus jamais cette livraison :
    // l'évènement resterait bloqué à "processing" jusqu'à expiration du
    // lease, sans qu'aucune nouvelle tentative ne vienne le débloquer. 409
    // (plutôt qu'un 2xx) est une réponse RETRYABLE : Stripe reprogrammera un
    // nouvel essai selon son propre calendrier, qui verra soit
    // "already_processed" (si l'autre a fini par réussir), soit un lease
    // expiré (si l'autre est réellement mort) et pourra alors reprendre.
    if (lockResult === "already_processing") {
      return NextResponse.json({ received: true, deduplicated: true, inFlight: true }, { status: 409 });
    }
    // "lock_error" : l'acquisition elle-même a échoué (panne DB) — on ne
    // détient aucun verrou, donc on ne doit surtout pas prétendre avoir
    // traité l'évènement ni appeler markPublicProgramPurchaseEventFailed
    // (qui suppose une ligne déjà là sous notre contrôle). Réponse 500 pour
    // que Stripe réessaie plus tard.
    if (lockResult === "lock_error") {
      console.error(`[Stripe webhook] Échec d'acquisition du verrou pour ${event.type} (${event.id}, programme public).`);
      return NextResponse.json({ error: "Verrou indisponible." }, { status: 500 });
    }
    try {
      await handleCheckoutSessionCompleted(supabase, event.data.object as Stripe.Checkout.Session, event.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue.";
      console.error(`[Stripe webhook] Échec du traitement de ${event.type} (${event.id}, programme public)`, error);
      await markPublicProgramPurchaseEventFailed(supabase, event.id, message);
      return NextResponse.json({ error: "Échec du traitement." }, { status: 500 });
    }
    await markPublicProgramPurchaseEventProcessed(supabase, event.id);
    return NextResponse.json({ received: true });
  }

  const alreadyProcessed = await recordBillingEventIfNew(supabase, event.id, event.type, event as unknown as Record<string, unknown>);
  if (alreadyProcessed) {
    return NextResponse.json({ received: true, deduplicated: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutSessionCompleted(supabase, event.data.object as Stripe.Checkout.Session, event.id);
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
