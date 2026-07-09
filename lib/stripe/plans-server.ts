import "server-only";

import { PLAN_DEFINITIONS, type PlanDefinition } from "@/lib/stripe/plans";

/**
 * Résolution serveur des price_id Stripe réels (jamais en dur dans le
 * code — toujours lus depuis .env.local / les variables d'environnement du
 * déploiement). Utilisé uniquement par les routes API `app/api/stripe/*`.
 */

export interface ResolvedPlan extends PlanDefinition {
  priceId: string;
}

/** Formules réellement configurées (price_id présent en environnement) — les autres sont simplement absentes de la liste. */
export function getAvailablePlans(): ResolvedPlan[] {
  return PLAN_DEFINITIONS.map((def) => ({ ...def, priceId: process.env[def.envVar] ?? "" })).filter(
    (plan): plan is ResolvedPlan => plan.priceId !== "",
  );
}

export function getResolvedPlanByKey(key: string): ResolvedPlan | null {
  return getAvailablePlans().find((plan) => plan.key === key) ?? null;
}

/** Retrouve la formule correspondant à un price_id Stripe (pour le webhook, qui ne connaît que le price_id). */
export function getResolvedPlanByPriceId(priceId: string | null | undefined): ResolvedPlan | null {
  if (!priceId) return null;
  return getAvailablePlans().find((plan) => plan.priceId === priceId) ?? null;
}
