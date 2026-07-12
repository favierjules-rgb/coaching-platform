import type { StudentBillingStatus, StripeSubscriptionStatus } from "@/types";

/**
 * Traduction du statut Stripe brut (jamais stocké transformé — voir
 * supabase/schema.sql, table `subscriptions`) vers le statut simplifié
 * demandé côté élève : actif / en attente / paiement échoué / annulé /
 * expiré / sans abonnement. Fonction pure, utilisable aussi bien côté
 * client (badges) que serveur (résumé billing).
 */
export function toStudentBillingStatus(subscriptionStatus: string | null | undefined): StudentBillingStatus {
  switch (subscriptionStatus as StripeSubscriptionStatus | null | undefined) {
    case "active":
    case "trialing":
      return "actif";
    case "past_due":
    case "unpaid":
      return "paiement_echoue";
    case "canceled":
      return "annule";
    case "incomplete_expired":
      return "expire";
    case "incomplete":
    case "paused":
      return "en_attente";
    default:
      return "sans_abonnement";
  }
}

export const billingStatusLabels: Record<StudentBillingStatus, string> = {
  actif: "Actif",
  en_attente: "En attente",
  paiement_echoue: "Paiement échoué",
  annule: "Annulé",
  expire: "Expiré",
  sans_abonnement: "Sans abonnement",
};

export type BillingStatusTone = "green" | "amber" | "muted" | "red" | "primary";

export function billingStatusTone(status: StudentBillingStatus): BillingStatusTone {
  if (status === "actif") return "green";
  if (status === "en_attente") return "amber";
  if (status === "paiement_echoue") return "red";
  if (status === "annule" || status === "expire") return "muted";
  return "muted";
}

export function formatAmountCents(amountCents: number | null | undefined, currency = "eur"): string {
  if (amountCents === null || amountCents === undefined) return "—";
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: currency.toUpperCase() }).format(amountCents / 100);
}
