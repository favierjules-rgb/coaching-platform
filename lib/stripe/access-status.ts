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
