"use client";

import { CreditCard } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { BillingStatusBadge } from "@/components/shared/BillingStatusBadge";
import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { useSupabaseMyAccess } from "@/hooks/useSupabaseMyAccess";
import { useSupabaseMyBilling } from "@/hooks/useSupabaseMyBilling";
import { useSupabaseSubscriptionTemplates } from "@/hooks/useSupabaseSubscriptionTemplates";
import { formatDate } from "@/lib/admin";
import { buildCheckoutOffers, getPlanLabel } from "@/lib/stripe/plans";
import { formatAmountCents } from "@/lib/stripe/status";
import { accessReasonLabels } from "@/lib/supabase/student-access";

/** Section "Mon abonnement" de /profil (chantier "supabase-stripe-payments-subscriptions" + "supabase-stripe-access-control" + "supabase-subscription-templates"). */
export function SubscriptionSection() {
  const billing = useSupabaseMyBilling();
  const access = useSupabaseMyAccess();
  const templates = useSupabaseSubscriptionTemplates(true);

  if (!billing.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!billing.active || !billing.summary) {
    return <p className="text-sm text-muted-foreground">Abonnement non disponible : ce compte n&apos;est pas encore relié à une fiche élève.</p>;
  }

  const { summary } = billing;
  const { subscription, lastPayment, status } = summary;
  const canManage = status !== "sans_abonnement" && status !== "annule" && status !== "expire";

  async function handleOpenPortal() {
    const result = await billing.openPortal();
    if (result.url) {
      window.location.href = result.url;
    }
  }

  const assignedTemplate = templates.templates.find((template) => template.id === access.assignedTemplateId) ?? null;
  const assignedTemplateName = assignedTemplate?.name ?? (access.assignedPlan ? getPlanLabel(access.assignedPlan) : null);
  const offers = buildCheckoutOffers(templates.templates);
  const hasTemplates = templates.templates.length > 0;
  const defaultOfferId = hasTemplates ? access.assignedTemplateId : access.assignedPlan;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BillingStatusBadge status={status} />
        {subscription?.planName && <span className="text-sm font-medium text-foreground">{subscription.planName}</span>}
        {!subscription?.planName && assignedTemplateName && (
          <span className="text-sm text-muted-foreground">Formule attribuée : {assignedTemplateName}</span>
        )}
      </div>

      {access.ready && access.status && (
        <div className="flex flex-wrap items-center gap-3 border border-border bg-background p-4">
          <StatusBadge label={access.status.allowed ? "Accès au site autorisé" : "Accès au site bloqué"} tone={access.status.allowed ? "green" : "red"} />
          <span className="text-xs text-muted-foreground">{accessReasonLabels[access.status.reason]}</span>
        </div>
      )}

      {subscription ? (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Montant</dt>
            <dd className="text-foreground">{formatAmountCents(subscription.amountCents, subscription.currency)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Prochaine échéance</dt>
            <dd className="text-foreground">
              {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
              {subscription.cancelAtPeriodEnd ? " (résiliation programmée)" : ""}
            </dd>
          </div>
          {lastPayment && (
            <div className="col-span-2">
              <dt className="text-xs uppercase tracking-wide text-muted-foreground">Dernier paiement</dt>
              <dd className="text-foreground">
                {formatAmountCents(lastPayment.amountCents, lastPayment.currency)} · {formatDate(lastPayment.paidAt ?? lastPayment.createdAt)}
              </dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Aucun abonnement actif pour le moment.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {canManage ? (
          <button
            type="button"
            onClick={handleOpenPortal}
            className="flex items-center gap-1.5 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <CreditCard size={14} aria-hidden="true" />
            Gérer mon abonnement
          </button>
        ) : (
          <CreateCheckoutLinkModal
            triggerLabel="Activer mon abonnement"
            mode="student"
            offers={offers}
            defaultOfferId={defaultOfferId}
            onCreateCheckout={hasTemplates ? billing.startCheckoutForTemplate : billing.startCheckout}
          />
        )}
      </div>
    </div>
  );
}
