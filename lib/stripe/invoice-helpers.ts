import "server-only";

import type Stripe from "stripe";

/**
 * Extraction défensive de champs de facture Stripe dont l'emplacement a
 * changé entre versions d'API (`invoice.subscription` / `invoice.payment_intent`
 * historiques vs `invoice.parent.subscription_details.subscription` /
 * `invoice.confirmation_secret` plus récents). Lit les deux emplacements
 * possibles via des vérifications à l'exécution plutôt que de dépendre d'un
 * seul jeu de types — le compte Stripe réel peut être sur une version d'API
 * différente de celle du SDK installé (chantier
 * "supabase-stripe-payments-subscriptions").
 */

function extractId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value) {
    const id = (value as { id: unknown }).id;
    return typeof id === "string" ? id : null;
  }
  return null;
}

export function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const record = invoice as unknown as Record<string, unknown>;
  const legacy = extractId(record.subscription);
  if (legacy) return legacy;
  const parent = record.parent as { subscription_details?: { subscription?: unknown } } | null | undefined;
  return extractId(parent?.subscription_details?.subscription);
}

export function getInvoicePaymentIntentId(invoice: Stripe.Invoice): string | null {
  const record = invoice as unknown as Record<string, unknown>;
  return extractId(record.payment_intent);
}

export function getInvoiceCustomerId(invoice: Stripe.Invoice): string | null {
  return extractId(invoice.customer);
}
