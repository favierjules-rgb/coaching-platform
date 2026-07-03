import type { PaymentMethod, PaymentStatus, StudentPaymentProfile } from "@/types";

export const paymentStatusLabels: Record<PaymentStatus, string> = {
  "à jour": "À jour",
  "en attente": "En attente",
  "en retard": "En retard",
  "terminé": "Terminé",
};

export const paymentStatusTone: Record<PaymentStatus, "green" | "amber" | "red" | "muted"> = {
  "à jour": "green",
  "en attente": "amber",
  "en retard": "red",
  "terminé": "muted",
};

export const paymentMethodLabels: Record<PaymentMethod, string> = {
  virement: "Virement",
  carte: "Carte",
  "espèces": "Espèces",
  "chèque": "Chèque",
  autre: "Autre",
};

/**
 * Reste à payer, jamais négatif ni NaN : borné à 0 même si les données
 * mockées sont incohérentes (paidAmountEuros > totalPriceEuros après une
 * saisie manuelle de test, valeurs manquantes...).
 */
export function remainingAmountEuros(profile: StudentPaymentProfile | null | undefined): number {
  if (!profile) return 0;
  const total = Number.isFinite(profile.totalPriceEuros) ? profile.totalPriceEuros : 0;
  const paid = Number.isFinite(profile.paidAmountEuros) ? profile.paidAmountEuros : 0;
  return Math.max(0, Math.round((total - paid) * 100) / 100);
}

/**
 * Résumé compact affiché dans la liste /admin/eleves, ex :
 * "180 €/mois · reste 180 € · en attente".
 */
export function paymentSummaryLabel(profile: StudentPaymentProfile | null | undefined): string {
  if (!profile) {
    return "Aucun paiement renseigné";
  }
  const monthly = Number.isFinite(profile.monthlyPriceEuros) ? profile.monthlyPriceEuros : 0;
  const remaining = remainingAmountEuros(profile);
  const statusLabel = paymentStatusLabels[profile.status] ?? "Statut inconnu";
  return `${monthly} €/mois · reste ${remaining} € · ${statusLabel.toLowerCase()}`;
}

/**
 * Défensif : garantit une StudentPaymentProfile exploitable même si
 * l'enregistrement localStorage date d'avant l'ajout du module paiement
 * (partiel/undefined), pour ne jamais planter la fiche élève ni la liste.
 */
export function normalizePaymentProfile(
  studentId: string,
  profile: StudentPaymentProfile | null | undefined,
): StudentPaymentProfile {
  const now = new Date().toISOString();
  if (!profile) {
    return {
      studentId,
      offerName: "",
      monthlyPriceEuros: 0,
      durationMonths: 0,
      totalPriceEuros: 0,
      paidAmountEuros: 0,
      status: "en attente",
      method: "autre",
      nextPaymentDate: null,
      installmentsTotal: 0,
      installmentsPaid: 0,
      entries: [],
      createdAt: now,
      updatedAt: now,
    };
  }
  return {
    ...profile,
    offerName: profile.offerName ?? "",
    monthlyPriceEuros: Number.isFinite(profile.monthlyPriceEuros) ? profile.monthlyPriceEuros : 0,
    durationMonths: Number.isFinite(profile.durationMonths) ? profile.durationMonths : 0,
    totalPriceEuros: Number.isFinite(profile.totalPriceEuros) ? profile.totalPriceEuros : 0,
    paidAmountEuros: Number.isFinite(profile.paidAmountEuros) ? profile.paidAmountEuros : 0,
    installmentsTotal: Number.isFinite(profile.installmentsTotal) ? profile.installmentsTotal : 0,
    installmentsPaid: Number.isFinite(profile.installmentsPaid) ? profile.installmentsPaid : 0,
    entries: Array.isArray(profile.entries) ? profile.entries : [],
  };
}
