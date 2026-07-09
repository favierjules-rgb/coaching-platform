import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import {
  findStudentIdByStripeCustomerId,
  recordStripePayment,
  upsertBillingCustomer,
  upsertSubscription,
} from "@/lib/supabase/billing";
import { getInvoiceCustomerId, getInvoicePaymentIntentId, getInvoiceSubscriptionId } from "@/lib/stripe/invoice-helpers";
import { getResolvedPlanByPriceId } from "@/lib/stripe/plans-server";
import type { Database } from "@/types/supabase";

/**
 * Gestion des 6 évènements webhook Stripe demandés (chantier
 * "supabase-stripe-payments-subscriptions"). Chaque handler reçoit le
 * client Supabase service role (déjà résolu par la route, contourne RLS —
 * légitime ici, l'appelant est Stripe lui-même après vérification de
 * signature, pas un utilisateur du site) et n'écrit jamais le statut
 * autrement que ce que Stripe a réellement envoyé.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function toIso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

function extractId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

/** Upsert la ligne `subscriptions` à partir d'un objet Stripe.Subscription — renvoie le student_id résolu, ou `null` si impossible à résoudre. */
async function upsertSubscriptionFromStripeObject(supabase: TypedSupabaseClient, subscription: Stripe.Subscription): Promise<string | null> {
  const stripeCustomerId = extractId(subscription.customer);
  if (!stripeCustomerId) return null;

  const studentId = subscription.metadata.student_id || (await findStudentIdByStripeCustomerId(supabase, stripeCustomerId));
  if (!studentId) {
    console.error(
      `[Stripe webhook] Impossible de résoudre student_id pour la subscription ${subscription.id} (customer ${stripeCustomerId}).`,
    );
    return null;
  }

  const item = subscription.items.data[0];
  const price = item?.price;
  const priceId = price?.id ?? null;
  const productId = extractId(price?.product as string | { id: string } | undefined) ?? null;
  const plan = getResolvedPlanByPriceId(priceId);

  await upsertSubscription(supabase, {
    studentId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    stripeProductId: productId,
    planName: plan?.label ?? "",
    status: subscription.status,
    currentPeriodStart: toIso(item?.current_period_start),
    currentPeriodEnd: toIso(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelledAt: toIso(subscription.canceled_at),
    amountCents: price?.unit_amount ?? null,
    currency: price?.currency ?? "eur",
  });

  return studentId;
}

/** checkout.session.completed : crée/relie le customer Stripe à l'élève (l'abonnement lui-même arrive via customer.subscription.created juste après). */
export async function handleCheckoutSessionCompleted(supabase: TypedSupabaseClient, session: Stripe.Checkout.Session): Promise<void> {
  const stripeCustomerId = extractId(session.customer as string | { id: string } | null);
  const studentId = session.client_reference_id || session.metadata?.student_id || null;
  if (!stripeCustomerId || !studentId) {
    console.error(`[Stripe webhook] checkout.session.completed sans customer/student_id exploitable (session ${session.id}).`);
    return;
  }
  await upsertBillingCustomer(supabase, {
    studentId,
    stripeCustomerId,
    email: session.customer_details?.email || session.customer_email || "",
  });
}

/** customer.subscription.created / customer.subscription.updated. */
export async function handleSubscriptionUpsert(supabase: TypedSupabaseClient, subscription: Stripe.Subscription): Promise<void> {
  await upsertSubscriptionFromStripeObject(supabase, subscription);
}

/** customer.subscription.deleted. */
export async function handleSubscriptionDeleted(supabase: TypedSupabaseClient, subscription: Stripe.Subscription): Promise<void> {
  const studentId = await upsertSubscriptionFromStripeObject(supabase, subscription);
  if (!studentId) return;
  await logActivityEvent(supabase, {
    studentId,
    actorType: "system",
    eventType: "subscription_cancelled",
    title: "Abonnement annulé",
    description: "L'abonnement Stripe de l'élève a été annulé.",
    metadata: buildStudentActivityLink(studentId),
  });
}

/** invoice.payment_succeeded. */
export async function handleInvoicePaymentSucceeded(supabase: TypedSupabaseClient, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = getInvoiceCustomerId(invoice);
  if (!stripeCustomerId) return;
  const studentId = await findStudentIdByStripeCustomerId(supabase, stripeCustomerId);
  if (!studentId) {
    console.error(`[Stripe webhook] invoice.payment_succeeded sans élève résolu (customer ${stripeCustomerId}).`);
    return;
  }
  await recordStripePayment(supabase, {
    studentId,
    stripeCustomerId,
    stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
    stripeInvoiceId: invoice.id ?? null,
    stripeSubscriptionId: getInvoiceSubscriptionId(invoice),
    amountCents: invoice.amount_paid,
    currency: invoice.currency,
    status: "succeeded",
    paidAt: toIso(invoice.status_transitions?.paid_at) ?? new Date().toISOString(),
  });
  await logActivityEvent(supabase, {
    studentId,
    actorType: "system",
    eventType: "payment_succeeded",
    title: "Paiement reçu",
    description: `${(invoice.amount_paid / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`,
    metadata: buildStudentActivityLink(studentId),
  });
}

/** invoice.payment_failed. */
export async function handleInvoicePaymentFailed(supabase: TypedSupabaseClient, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = getInvoiceCustomerId(invoice);
  if (!stripeCustomerId) return;
  const studentId = await findStudentIdByStripeCustomerId(supabase, stripeCustomerId);
  if (!studentId) {
    console.error(`[Stripe webhook] invoice.payment_failed sans élève résolu (customer ${stripeCustomerId}).`);
    return;
  }
  await recordStripePayment(supabase, {
    studentId,
    stripeCustomerId,
    stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
    stripeInvoiceId: invoice.id ?? null,
    stripeSubscriptionId: getInvoiceSubscriptionId(invoice),
    amountCents: invoice.amount_due,
    currency: invoice.currency,
    status: "failed",
    paidAt: null,
  });
  await logActivityEvent(supabase, {
    studentId,
    actorType: "system",
    eventType: "payment_failed",
    title: "Échec de paiement",
    description: `${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`,
    metadata: buildStudentActivityLink(studentId),
  });
}
