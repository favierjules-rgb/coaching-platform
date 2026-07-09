import { StatusBadge } from "@/components/admin/StatusBadge";
import { billingStatusLabels, billingStatusTone } from "@/lib/stripe/status";
import type { StudentBillingStatus } from "@/types";

/** Badge de statut billing élève — jamais la couleur seule (StatusBadge porte déjà un libellé texte). */
export function BillingStatusBadge({ status }: { status: StudentBillingStatus }) {
  return <StatusBadge label={billingStatusLabels[status]} tone={billingStatusTone(status)} />;
}
