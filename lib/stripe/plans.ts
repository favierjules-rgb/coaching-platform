/**
 * Formules de coaching proposées (chantier "supabase-stripe-payments-subscriptions").
 * Fichier volontairement sans dépendance serveur (pas de "server-only", pas
 * de lecture de process.env ici) : la clé + le libellé de chaque formule ne
 * sont pas sensibles et doivent pouvoir s'afficher côté client (modal admin
 * "Créer lien de paiement", bouton élève "Activer mon abonnement"/choix de
 * formule). La résolution du vrai `price_id` Stripe (via la variable d'env
 * correspondante) se fait uniquement côté serveur — voir
 * lib/stripe/plans-server.ts — jamais de price_id en dur ici.
 */

import { formatAmountCents } from "@/lib/stripe/status";
import type { BillingInterval, SubscriptionTemplate } from "@/types";

export type PlanKey = "basic" | "premium" | "distanciel";

export interface PlanDefinition {
  key: PlanKey;
  /** Libellé affiché à l'élève/l'admin. */
  label: string;
  /** Nom de la variable d'environnement contenant le price_id Stripe correspondant (jamais sa valeur ici). */
  envVar: string;
}

export const PLAN_DEFINITIONS: PlanDefinition[] = [
  { key: "basic", label: "Coaching mensuel", envVar: "STRIPE_PRICE_COACHING_BASIC" },
  { key: "premium", label: "Coaching premium", envVar: "STRIPE_PRICE_COACHING_PREMIUM" },
  { key: "distanciel", label: "Coaching distanciel", envVar: "STRIPE_PRICE_COACHING_DISTANCIEL" },
];

export function getPlanDefinition(key: string): PlanDefinition | null {
  return PLAN_DEFINITIONS.find((def) => def.key === key) ?? null;
}

export function getPlanLabel(key: string | null | undefined): string {
  if (!key) return "";
  return getPlanDefinition(key)?.label ?? key;
}

/* ─── Offres pour CreateCheckoutLinkModal (chantier "supabase-subscription-templates") ───
 * Les modèles d'abonnements (table `subscription_templates`) sont la source
 * prioritaire des formules proposées à l'achat — ce mapping .env n'est
 * conservé que comme repli temporaire tant qu'aucun modèle n'existe encore.
 */

export const billingIntervalLabels: Record<BillingInterval, string> = {
  monthly: "/mois",
  quarterly: "/trimestre",
  yearly: "/an",
  one_time: " (paiement unique)",
};

/** Libellé "fréquence" autonome (sans le montant devant), pour un affichage en champ dédié. */
export const billingIntervalFrequencyLabels: Record<BillingInterval, string> = {
  monthly: "Mensuel",
  quarterly: "Trimestriel",
  yearly: "Annuel",
  one_time: "Paiement unique",
};

export function formatTemplateOffer(template: SubscriptionTemplate): string {
  return `${template.name} — ${formatAmountCents(template.amountCents, template.currency)}${billingIntervalLabels[template.billingInterval]}`;
}

export interface CheckoutOffer {
  id: string;
  label: string;
}

/** Modèles actifs si disponibles (id = template.id), sinon repli sur les 3 formules statiques par variable d'environnement (id = plan key). */
export function buildCheckoutOffers(templates: SubscriptionTemplate[]): CheckoutOffer[] {
  if (templates.length > 0) {
    return templates.map((template) => ({ id: template.id, label: formatTemplateOffer(template) }));
  }
  return PLAN_DEFINITIONS.map((plan) => ({ id: plan.key, label: plan.label }));
}
