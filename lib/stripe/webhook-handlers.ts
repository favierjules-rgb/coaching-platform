import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  composePaymentFailedEmail,
  composePaymentSucceededEmail,
  composeSubscriptionCancelledEmail,
} from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { getStripeClient } from "@/lib/stripe/client";
import { getInvoiceCustomerId, getInvoicePaymentIntentId, getInvoiceSubscriptionId } from "@/lib/stripe/invoice-helpers";
import { getResolvedPlanByPriceId } from "@/lib/stripe/plans-server";
import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import {
  findStudentIdByStripeCustomerId,
  getSubscriptionForStudent,
  recordStripePayment,
  upsertBillingCustomer,
  upsertSubscription,
} from "@/lib/supabase/billing";
import { getStudentById } from "@/lib/supabase/students";
import { getSubscriptionTemplateByPriceId } from "@/lib/supabase/subscription-templates";
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

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

/** Portail client Stripe pour le bouton "Mettre à jour mon moyen de paiement" de l'email d'échec de paiement — repli sur /profil (où l'élève peut relancer le portail lui-même) si la création échoue ou si Stripe n'est pas disponible. */
async function buildPortalUrlOrFallback(stripeCustomerId: string): Promise<string> {
  const profileUrl = `${appUrl()}/profil`;
  const stripe = getStripeClient();
  if (!stripe) return profileUrl;
  try {
    const session = await stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: profileUrl });
    return session.url;
  } catch (error) {
    console.error("[Stripe webhook] Échec de création du lien portail pour l'email d'échec de paiement", error);
    return profileUrl;
  }
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
  // Nom de formule : `subscription_templates` (source prioritaire, chantier
  // "supabase-subscription-templates") d'abord, mapping .env
  // (lib/stripe/plans-server.ts) en repli tant qu'aucun modèle ne
  // correspond à ce price_id.
  const template = priceId ? await getSubscriptionTemplateByPriceId(supabase, priceId) : null;
  const plan = getResolvedPlanByPriceId(priceId);

  await upsertSubscription(supabase, {
    studentId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    stripeProductId: productId,
    planName: template?.name ?? plan?.label ?? "",
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

  const student = await getStudentById(supabase, studentId);
  if (student?.email) {
    const item = subscription.items.data[0];
    const email = composeSubscriptionCancelledEmail({
      firstName: student.firstName,
      accessEndDate: toIso(item?.current_period_end),
      profileUrl: `${appUrl()}/profil`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "subscription_cancelled",
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "subscription",
      relatedEntityId: studentId,
      metadata: { stripeSubscriptionId: subscription.id },
    });
  }
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

  // Seule source de l'email "paiement réussi" : invoice.payment_succeeded,
  // jamais checkout.session.completed (qui ne fait que relier le customer,
  // voir handleCheckoutSessionCompleted) — évite tout doublon entre les
  // deux évènements, conformément à la consigne du chantier.
  const student = await getStudentById(supabase, studentId);
  if (student?.email) {
    const subscription = await getSubscriptionForStudent(supabase, studentId);
    const email = composePaymentSucceededEmail({
      firstName: student.firstName,
      planName: subscription?.planName ?? "",
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      dashboardUrl: `${appUrl()}/dashboard`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "payment_succeeded",
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "stripe_invoice",
      relatedEntityId: studentId,
      metadata: { stripeInvoiceId: invoice.id, amountCents: invoice.amount_paid },
    });
  }
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

  const student = await getStudentById(supabase, studentId);
  if (student?.email) {
    const portalUrl = await buildPortalUrlOrFallback(stripeCustomerId);
    const email = composePaymentFailedEmail({
      firstName: student.firstName,
      portalUrl,
      profileUrl: `${appUrl()}/profil`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "payment_failed",
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "stripe_invoice",
      relatedEntityId: studentId,
      metadata: { stripeInvoiceId: invoice.id, amountCents: invoice.amount_due },
    });
  }
}
