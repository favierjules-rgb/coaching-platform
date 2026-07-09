"use client";

import { CreditCard, ExternalLink } from "lucide-react";

import { AdminSection, InfoRow } from "@/components/admin/AdminSection";
import { BillingStatusBadge } from "@/components/shared/BillingStatusBadge";
import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { useSupabaseStudentBilling } from "@/hooks/useSupabaseStudentBilling";
import { formatDate } from "@/lib/admin";
import { formatAmountCents } from "@/lib/stripe/status";

/**
 * Section "Paiement / abonnement" de la fiche élève admin (chantier
 * "supabase-stripe-payments-subscriptions"). Distincte de la section
 * "Paiement" existante (PaymentSection, fiche manuelle saisie par le
 * coach) — ne la remplace pas, ne lit ni n'écrit les mêmes tables.
 */
export function StudentBillingSection({ studentId }: { studentId: string }) {
  const billing = useSupabaseStudentBilling(studentId);

  async function handleOpenPortal() {
    const result = await billing.openPortal();
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <AdminSection title="Paiement / abonnement (Stripe)">
      {billing.loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : !billing.summary ? (
        <p className="text-sm text-muted-foreground">Statut de paiement indisponible.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <BillingStatusBadge status={billing.summary.status} />
            {billing.summary.subscription?.planName && (
              <span className="text-sm font-medium text-foreground">{billing.summary.subscription.planName}</span>
            )}
          </div>

          <InfoRow
            label="Montant"
            value={
              billing.summary.subscription
                ? formatAmountCents(billing.summary.subscription.amountCents, billing.summary.subscription.currency)
                : "—"
            }
          />
          <InfoRow
            label="Prochaine échéance"
            value={
              billing.summary.subscription?.currentPeriodEnd
                ? formatDate(billing.summary.subscription.currentPeriodEnd) +
                  (billing.summary.subscription.cancelAtPeriodEnd ? " (résiliation programmée)" : "")
                : "—"
            }
          />
          <InfoRow
            label="Dernier paiement"
            value={
              billing.summary.lastPayment
                ? `${formatAmountCents(billing.summary.lastPayment.amountCents, billing.summary.lastPayment.currency)} · ${formatDate(billing.summary.lastPayment.paidAt ?? billing.summary.lastPayment.createdAt)}`
                : "Aucun paiement enregistré"
            }
          />

          <div className="mt-2 flex flex-wrap gap-2">
            <CreateCheckoutLinkModal
              triggerLabel="Créer lien de paiement"
              mode="admin"
              onCreateCheckout={billing.createCheckoutLink}
            />
            {billing.summary.customer && (
              <>
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <CreditCard size={14} aria-hidden="true" />
                  Ouvrir le portail client
                </button>
                <a
                  href={`https://dashboard.stripe.com/customers/${billing.summary.customer.stripeCustomerId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Voir dans Stripe
                </a>
              </>
            )}
          </div>
        </div>
      )}
    </AdminSection>
  );
}
