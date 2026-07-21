import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  acquirePublicProgramPurchaseEventLock,
  acquireStripeEventLock,
  markPublicProgramPurchaseEventFailed,
  markPublicProgramPurchaseEventProcessed,
  markStripeEventFailed,
  markStripeEventProcessed,
} from "@/lib/supabase/billing";
import { getStripeClient } from "@/lib/stripe/client";
import { checkStripeLivemode, describeLivemodeRejection } from "@/lib/stripe/livemode";
import {
  handleCheckoutSessionCompleted,
  handleInvoicePaymentFailed,
  handleInvoicePaymentSucceeded,
  handleSubscriptionDeleted,
  handleSubscriptionUpsert,
  IGNORED_UNRELATED_STRIPE_OBJECT,
  StripeUnrelatedObjectError,
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
 *    un ABONNEMENT — pas un programme public) : acquireStripeEventLock
 *    (Lot W1 — juillet 2026), qui REMPLACE recordBillingEventIfNew.
 *
 *    Ce que faisait l'ancien mécanisme, et pourquoi il était cassé :
 *    la ligne billing_events était insérée AVANT l'exécution du handler,
 *    et processed_at avait `default now()`. Un handler en échec renvoyait
 *    500, Stripe réessayait — mais l'évènement existait déjà, la route
 *    répondait alors 200 "deduplicated" et le handler n'était PLUS JAMAIS
 *    rejoué. Tout échec transitoire (timeout Supabase, redéploiement en
 *    plein traitement) devenait une perte définitive et silencieuse.
 *    Second défaut : le SELECT puis INSERT n'étaient pas atomiques et la
 *    violation 23505 était avalée, si bien que deux livraisons simultanées
 *    recevaient toutes deux "nouveau, traite-le" et exécutaient le handler
 *    deux fois.
 *
 *    acquireStripeEventLock applique la stratégie d'acquisition atomique
 *    déjà validée au Lot E-bis pour les programmes publics, mais sur les
 *    vraies colonnes status/processing_started_at/… créées par la
 *    migration 20260721180920. Le verrou programme public (point 1) n'est
 *    PAS remplacé : il conserve sa logique propre `_seth_*` et ses 17
 *    tests, et se contente désormais de renseigner AUSSI les colonnes
 *    réelles pour ne pas laisser de lignes incohérentes.
 *
 * ORDRE DE TRAITEMENT OBLIGATOIRE (Lot W1) :
 *   1. vérifier la signature Stripe ;
 *   2. vérifier event.livemode contre STRIPE_EXPECTED_LIVEMODE ;
 *   3. acquérir atomiquement l'évènement ;
 *   4. exécuter le handler ;
 *   5. vérifier explicitement sa réussite (toute exception remonte ici) ;
 *   6. marquer "processed" UNIQUEMENT après réussite complète ;
 *   7. répondre 200.
 * En cas d'erreur : status="failed" + failed_at + error_message, jamais de
 * processed_at, réponse 500 pour que Stripe reprogramme un essai.
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

  // Étape 2 — garde test/live (Lot W1). Placée APRÈS la vérification de
  // signature (on ne fait confiance au champ livemode qu'une fois
  // l'authenticité établie) et AVANT toute écriture : un évènement rejeté
  // ici ne laisse AUCUNE trace dans billing_events, sans quoi il
  // polluerait l'idempotence de l'environnement légitime. Réponse 403,
  // non-2xx et volontairement non retryable côté métier : Stripe
  // réessaiera, mais la réponse reste identifiable dans ses logs comme un
  // refus de mode, pas comme une panne.
  const livemodeCheck = checkStripeLivemode(event.livemode);
  if (!livemodeCheck.ok) {
    console.error(describeLivemodeRejection(livemodeCheck, event.type));
    return NextResponse.json({ error: "Mode Stripe incompatible." }, { status: 403 });
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

  // Étape 3 — acquisition atomique.
  const lockResult = await acquireStripeEventLock(supabase, event.id, event.type, event as unknown as Record<string, unknown>);

  if (lockResult === "already_processed") {
    // Traitement réellement terminé avec succès (ou ligne "unknown_legacy"
    // antérieure au Lot W1, jamais rejouée par prudence) : aucun effet
    // métier à reproduire, on acquitte normalement.
    return NextResponse.json({ received: true, deduplicated: true });
  }

  if (lockResult === "already_processing") {
    // Un autre traitement est en cours et son lease n'a pas expiré. Aucun
    // effet métier ici, MAIS on ignore encore si l'autre va réussir :
    // répondre 200 acquitterait prématurément CETTE livraison et Stripe ne
    // la retenterait jamais. 409 est retryable — un essai ultérieur verra
    // soit "already_processed", soit un lease expiré et pourra reprendre.
    // Même raisonnement que la branche programme public ci-dessus.
    return NextResponse.json({ received: true, deduplicated: true, inFlight: true }, { status: 409 });
  }

  if (lockResult === "lock_error") {
    // L'acquisition elle-même a échoué : on ne détient aucun verrou, donc
    // on ne marque surtout rien. 500 pour que Stripe réessaie.
    console.error(`[Stripe webhook] Échec d'acquisition du verrou pour ${event.type} (${event.id}).`);
    return NextResponse.json({ error: "Verrou indisponible." }, { status: 500 });
  }

  // Étape 4 — exécution du handler.
  // `ignoredReason` distingue TROIS issues, jamais confondues :
  //   - undefined            → évènement réellement traité ;
  //   - "ignored_unhandled_event_type"    → type non géré par ce chantier ;
  //   - "ignored_unrelated_stripe_object" → objet démontrablement étranger
  //     à SETH (aucune metadata, aucun billing_customer, aucun price connu).
  // Un objet qui APPARTIENT à SETH mais dont le rattachement n'est pas
  // encore résolu n'entre dans AUCUNE de ces catégories : il lève
  // StripeCustomerMappingUnresolvedError, tombe dans le catch, et repart
  // en "failed" + 500 pour être rejoué. Stripe ne garantissant pas l'ordre
  // de livraison, c'est la seule façon de ne pas perdre un abonnement dont
  // le Checkout arrive après.
  let ignoredReason: string | undefined;
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
        // Évènement reçu mais non géré par ce chantier (charge.*,
        // payment_intent.*, customer.created…). Ce N'EST PAS une erreur :
        // le marquer "processed" avec une raison explicite évite un retry
        // Stripe inutile tout en gardant la décision traçable.
        ignoredReason = "ignored_unhandled_event_type";
        break;
    }
  } catch (error) {
    // CAS A — objet démontrablement étranger à SETH. Le rejouer
    // n'aboutirait jamais : on acquitte proprement, sans effet métier,
    // avec la raison persistée. C'est la SEULE situation où un
    // rattachement absent vaut succès.
    if (error instanceof StripeUnrelatedObjectError) {
      console.warn(`[Stripe webhook] ${event.type} (${event.id}) ignoré — ${error.context}`);
      await markStripeEventProcessed(supabase, event.id, { ignoredReason: IGNORED_UNRELATED_STRIPE_OBJECT });
      return NextResponse.json({ received: true, ignored: true, reason: IGNORED_UNRELATED_STRIPE_OBJECT });
    }

    // Étape 5/6 (échec) — inclut CAS B
    // (StripeCustomerMappingUnresolvedError, dont le message vaut
    // "customer_or_student_mapping_unresolved"). L'erreur est persistée et
    // processed_at reste NULL, ce qui autorise explicitement un rejeu au
    // prochain essai de Stripe. C'est précisément ce qui était impossible
    // avant le Lot W1.
    const message = error instanceof Error ? error.message : "Erreur inconnue.";
    console.error(`[Stripe webhook] Échec du traitement de ${event.type} (${event.id})`, error);
    await markStripeEventFailed(supabase, event.id, message);
    return NextResponse.json({ error: "Échec du traitement." }, { status: 500 });
  }

  // Étape 6 — marquage "processed" APRÈS la réussite complète, jamais avant.
  await markStripeEventProcessed(supabase, event.id, ignoredReason ? { ignoredReason } : undefined);

  // Étape 7.
  return NextResponse.json({ received: true, ignored: ignoredReason ? true : undefined });
}
