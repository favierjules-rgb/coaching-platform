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
