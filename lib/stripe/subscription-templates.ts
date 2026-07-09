import "server-only";

import type Stripe from "stripe";

import type { BillingInterval } from "@/types";

/**
 * Création des Product/Price Stripe correspondant à un modèle d'abonnement
 * (chantier "supabase-subscription-templates") : un Price Stripe est
 * immuable une fois créé — tout changement de montant doit créer un
 * nouveau Price puis désactiver l'ancien (jamais de mutation en place).
 */

function toStripeRecurring(billingInterval: BillingInterval): Stripe.PriceCreateParams["recurring"] {
  switch (billingInterval) {
    case "monthly":
      return { interval: "month", interval_count: 1 };
    case "quarterly":
      return { interval: "month", interval_count: 3 };
    case "yearly":
      return { interval: "year", interval_count: 1 };
    case "one_time":
      return undefined;
  }
}

export interface CreateStripeProductAndPriceInput {
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  billingInterval: BillingInterval;
}

export async function createStripeProductAndPrice(
  stripe: Stripe,
  input: CreateStripeProductAndPriceInput,
): Promise<{ productId: string; priceId: string }> {
  const product = await stripe.products.create({
    name: input.name,
    description: input.description || undefined,
  });
  const price = await stripe.prices.create({
    product: product.id,
    unit_amount: input.amountCents,
    currency: input.currency,
    recurring: toStripeRecurring(input.billingInterval),
  });
  return { productId: product.id, priceId: price.id };
}

export interface CreateStripePriceForExistingProductInput {
  productId: string;
  amountCents: number;
  currency: string;
  billingInterval: BillingInterval;
  /** Ancien price_id à désactiver après création du nouveau (jamais supprimé, garde l'historique). */
  previousPriceId: string | null;
}

/** Changement de prix d'un modèle existant : nouveau Price sur le même Product, ancien Price désactivé (pas supprimé — les abonnements historiques continuent de le référencer). */
export async function createStripePriceForExistingProduct(
  stripe: Stripe,
  input: CreateStripePriceForExistingProductInput,
): Promise<string> {
  const price = await stripe.prices.create({
    product: input.productId,
    unit_amount: input.amountCents,
    currency: input.currency,
    recurring: toStripeRecurring(input.billingInterval),
  });
  if (input.previousPriceId) {
    await stripe.prices.update(input.previousPriceId, { active: false });
  }
  return price.id;
}
