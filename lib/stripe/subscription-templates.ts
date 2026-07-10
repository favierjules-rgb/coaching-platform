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

/**
 * Extrait un message d'erreur exploitable d'une erreur Stripe (le SDK jette
 * des `Stripe.errors.StripeError` avec `.message`/`.type`/`.code`, pas de
 * simples `Error`) — utilisé pour logguer le vrai message côté serveur et
 * le renvoyer à l'admin (route réservée au staff, message Stripe non
 * sensible) plutôt qu'un texte générique impossible à diagnostiquer.
 */
export function describeStripeError(error: unknown): string {
  if (error && typeof error === "object") {
    const stripeError = error as { message?: string; type?: string; code?: string };
    if (stripeError.message) {
      const parts = [stripeError.message];
      if (stripeError.code) parts.push(`(code: ${stripeError.code})`);
      return parts.join(" ");
    }
  }
  return error instanceof Error ? error.message : "Erreur Stripe inconnue.";
}

/**
 * `true` si l'erreur Stripe signale que la ressource référencée
 * (produit/prix) n'existe plus — cause fréquente : `stripe_product_id`
 * enregistré dans un mode Stripe (test) différent de celui de la clé
 * secrète actuellement configurée (live), ou produit supprimé côté Stripe.
 */
export function isStripeResourceMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const stripeError = error as { code?: string; message?: string };
  if (stripeError.code === "resource_missing") return true;
  return typeof stripeError.message === "string" && /no such (product|price)/i.test(stripeError.message);
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

/**
 * Changement de prix d'un modèle existant : nouveau Price sur le même
 * Product, ancien Price désactivé (pas supprimé — les abonnements
 * historiques continuent de le référencer). La désactivation de l'ancien
 * Price est best-effort : si elle échoue (ex: price déjà inactif, ou id
 * orphelin d'un autre mode Stripe), le nouveau Price a déjà été créé avec
 * succès — l'échec de désactivation est seulement loggué, jamais renvoyé
 * comme un échec de l'opération globale (le prix reste correct et
 * utilisable, seul le nettoyage de l'ancien échoue).
 */
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
    try {
      await stripe.prices.update(input.previousPriceId, { active: false });
    } catch (error) {
      console.error(
        `[Stripe] désactivation de l'ancien Price ${input.previousPriceId} échouée (nouveau Price ${price.id} créé avec succès) : ${describeStripeError(error)}`,
      );
    }
  }
  return price.id;
}
