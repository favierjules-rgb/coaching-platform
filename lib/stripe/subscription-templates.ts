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

/**
 * ARCHIVAGE STANDARD — désactive UNIQUEMENT le Price du modèle (`active:false`).
 * Le Product est délibérément laissé actif : il peut porter d'autres Prices, et
 * l'objectif de l'archivage est seulement d'empêcher de NOUVELLES ventes de ce
 * tarif. Les abonnements/paiements existants ne sont jamais touchés (Stripe
 * continue de facturer un abonnement sur un Price archivé).
 * Strict : une erreur réelle est levée (l'appelant n'archive alors pas en base).
 * Idempotent : un Price déjà inactif/absent est un succès.
 */
export async function archiveStripePriceOnly(stripe: Stripe, priceId: string | null): Promise<void> {
  if (!priceId) return;
  try {
    await stripe.prices.update(priceId, { active: false });
  } catch (error) {
    if (!isStripeResourceMissing(error)) throw error;
  }
}

/**
 * RÉACTIVATION SYMÉTRIQUE — un Price ne peut pas être actif sous un Product
 * inactif : on réactive donc d'abord le Product (s'il est inactif), puis le
 * Price du modèle. Strict : toute erreur est levée pour que l'appelant
 * conserve le modèle archivé en base (jamais de modèle local actif pointant un
 * Price inactif). Idempotent : Product/Price déjà actifs = succès.
 */
export async function reactivateStripeForTemplate(
  stripe: Stripe,
  input: { productId: string | null; priceId: string | null },
): Promise<{ productReactivated: boolean; priceReactivated: boolean }> {
  let productReactivated = false;
  if (input.productId) {
    const product = await stripe.products.retrieve(input.productId);
    if (product && product.active === false) {
      await stripe.products.update(input.productId, { active: true });
      productReactivated = true;
    }
  }
  let priceReactivated = false;
  if (input.priceId) {
    await stripe.prices.update(input.priceId, { active: true });
    priceReactivated = true;
  }
  return { productReactivated, priceReactivated };
}

export interface ArchiveStripeForDeletedTemplateInput {
  productId: string | null;
  priceId: string | null;
  /** Au moins un AUTRE modèle local référence le même stripe_product_id (calculé par l'appelant en base). Si vrai, le Product n'est jamais archivé. */
  otherTemplatesShareProduct: boolean;
}

export interface ArchiveStripeResult {
  priceArchived: boolean;
  productArchived: boolean;
  /** Renseigné uniquement si le Product N'a PAS été archivé, pour tracer pourquoi. */
  productSkippedReason?: "shared_product" | "active_prices" | "missing_id";
}

/** `true` s'il reste au moins un Price actif rattaché au Product autre que celui qu'on archive (Stripe read, pas d'écriture). */
async function hasOtherActiveStripePrice(stripe: Stripe, productId: string, excludingPriceId: string | null): Promise<boolean> {
  const prices = await stripe.prices.list({ product: productId, active: true, limit: 100 });
  return prices.data.some((price) => price.id !== excludingPriceId);
}

/**
 * Archivage Stripe STRICT pour une suppression définitive de modèle — jamais
 * best-effort : une erreur Stripe réelle est *levée* (l'appelant arrête alors
 * et ne supprime pas la ligne en base). Rien n'est jamais *supprimé* côté
 * Stripe (les objets restent pour l'historique de facturation), seulement
 * passés `active: false`.
 *
 * Ordre : (1) le Price est archivé systématiquement (obligatoire) ; (2) le
 * Product n'est archivé QUE s'il devient réellement inutilisé — pas partagé
 * par un autre modèle local (`otherTemplatesShareProduct`) ET sans autre Price
 * actif rattaché (`hasOtherActiveStripePrice`). Sinon `productArchived: false`
 * avec une raison explicite ; le Product reste actif.
 *
 * Idempotent : un Price/Product déjà inactif ou déjà absent côté Stripe
 * (`resource_missing`) est traité comme un succès d'archivage — une nouvelle
 * tentative après une erreur DB ne réactive jamais quoi que ce soit.
 */
export async function archiveStripeForDeletedTemplate(
  stripe: Stripe,
  input: ArchiveStripeForDeletedTemplateInput,
): Promise<ArchiveStripeResult> {
  // 1. Price — obligatoire.
  let priceArchived = false;
  if (input.priceId) {
    try {
      await stripe.prices.update(input.priceId, { active: false });
      priceArchived = true;
    } catch (error) {
      if (isStripeResourceMissing(error)) {
        priceArchived = true; // idempotent : price déjà absent → considéré archivé
      } else {
        throw error; // échec réel → l'appelant arrête, aucune suppression DB
      }
    }
  }

  // 2. Product — seulement s'il devient réellement inutilisé.
  if (!input.productId) {
    return { priceArchived, productArchived: false, productSkippedReason: "missing_id" };
  }
  if (input.otherTemplatesShareProduct) {
    return { priceArchived, productArchived: false, productSkippedReason: "shared_product" };
  }
  if (await hasOtherActiveStripePrice(stripe, input.productId, input.priceId)) {
    return { priceArchived, productArchived: false, productSkippedReason: "active_prices" };
  }
  try {
    await stripe.products.update(input.productId, { active: false });
    return { priceArchived, productArchived: true };
  } catch (error) {
    if (isStripeResourceMissing(error)) {
      return { priceArchived, productArchived: true }; // idempotent
    }
    throw error; // échec réel → l'appelant arrête, aucune suppression DB
  }
}
