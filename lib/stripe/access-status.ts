import type { BillingAccessMode, StudentAccessReason, StudentAccessStatus } from "@/types";

/**
 * Calcul pur du statut d'accès élève (chantier "supabase-stripe-access-control"),
 * sans aucune dépendance Supabase — séparé de lib/supabase/student-access.ts
 * et lib/supabase/billing.ts pour que les deux puissent l'utiliser sans
 * import circulaire (billing.ts fournit les abonnements consommés par
 * student-access.ts, et a lui-même besoin de ce calcul pour la liste admin
 * /admin/paiements).
 */

const STRIPE_STATUS_REASONS: Record<string, StudentAccessReason> = {
  incomplete: "subscription_incomplete",
  incomplete_expired: "subscription_incomplete_expired",
  past_due: "subscription_past_due",
  canceled: "subscription_canceled",
  unpaid: "subscription_unpaid",
  paused: "subscription_paused",
};

export function computeStudentAccess(accessMode: BillingAccessMode, subscriptionStatus: string | null): StudentAccessStatus {
  if (accessMode === "manual_blocked") {
    return { allowed: false, reason: "manual_blocked", accessMode, subscriptionStatus };
  }
  if (accessMode === "manual_allowed") {
    return { allowed: true, reason: "manual_allowed", accessMode, subscriptionStatus };
  }
  // accessMode === "subscription_required" (par défaut)
  if (subscriptionStatus === "active" || subscriptionStatus === "trialing") {
    return { allowed: true, reason: "subscription_active", accessMode, subscriptionStatus };
  }
  if (!subscriptionStatus) {
    return { allowed: false, reason: "no_subscription", accessMode, subscriptionStatus };
  }
  return { allowed: false, reason: STRIPE_STATUS_REASONS[subscriptionStatus] ?? "no_subscription", accessMode, subscriptionStatus };
}

/**
 * OÙ ENVOYER UN ÉLÈVE DONT L'ACCÈS EST REFUSÉ.
 *
 * ⚠️ DEUX REFUS, DEUX ÉCRANS, ET LA DISTINCTION N'EST PAS COSMÉTIQUE.
 * `/acces-limite` AFFIRME quelque chose sur le compte : « votre accès sera
 * activé après validation de votre abonnement », et, sans formule attribuée,
 * « aucune formule attribuée pour le moment ». C'est une affirmation vraie
 * quand elle découle d'une lecture réussie — et entièrement fausse quand le
 * mode de facturation n'a PAS PU être lu. Le 18/10, 34 élèves en accès
 * manuel autorisé ont lu cette phrase à cause d'un privilège de colonne.
 *
 * Une panne va donc sur `/acces-indisponible` : même fermeture du contenu,
 * mais un message honnête et un bouton Réessayer.
 */
export function destinationRefusAcces(statut: { reason: StudentAccessReason }): "/acces-limite" | "/acces-indisponible" {
  return statut.reason === "indetermine" ? "/acces-indisponible" : "/acces-limite";
}
