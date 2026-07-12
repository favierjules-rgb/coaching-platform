import "server-only";

import Stripe from "stripe";

/**
 * Client Stripe serveur (clé secrète, jamais exposée au navigateur — ce
 * fichier importe `server-only`, qui fait échouer le build s'il est
 * importé depuis un Client Component). Utilisé uniquement par les routes
 * API `app/api/stripe/*` (chantier "supabase-stripe-payments-subscriptions").
 *
 * Renvoie `null` si STRIPE_SECRET_KEY n'est pas configurée — jamais
 * d'erreur bloquante au chargement du module ; à l'appelant de renvoyer une
 * réponse d'erreur explicite si le client est indisponible.
 */

let cached: Stripe | null = null;

export function getStripeClient(): Stripe | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Stripe] STRIPE_SECRET_KEY absente. Fonctionnalités de paiement indisponibles.");
    }
    return null;
  }
  if (!cached) {
    cached = new Stripe(secretKey);
  }
  return cached;
}
