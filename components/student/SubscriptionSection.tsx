"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";

import { StatusBadge } from "@/components/admin/StatusBadge";
import { BillingStatusBadge } from "@/components/shared/BillingStatusBadge";
import { useSupabaseMyAccess } from "@/hooks/useSupabaseMyAccess";
import { useSupabaseMyBilling } from "@/hooks/useSupabaseMyBilling";
import { formatDate } from "@/lib/admin";
import { billingIntervalFrequencyLabels, billingIntervalLabels } from "@/lib/stripe/plans";
import { formatAmountCents } from "@/lib/stripe/status";
import { accessReasonLabels } from "@/lib/supabase/student-access";

/**
 * Section "Mon abonnement" de /profil. L'élève ne choisit jamais une
 * formule : il ne voit et ne peut payer que le modèle qui lui a été
 * attribué par le coach (`student_profiles.assigned_subscription_template_id`,
 * chantier "supabase-subscription-templates") — plus de sélecteur des 3
 * anciennes formules fixes.
 */
export function SubscriptionSection() {
  const billing = useSupabaseMyBilling();
  const access = useSupabaseMyAccess();
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);

  if (!billing.ready || !access.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!billing.active || !billing.summary) {
    return <p className="text-sm text-muted-foreground">Abonnement non disponible : ce compte n&apos;est pas encore relié à une fiche élève.</p>;
  }

  const { summary } = billing;
  const { subscription, lastPayment, status } = summary;
  const canManage = status !== "sans_abonnement" && status !== "annule" && status !== "expire";
  const template = access.assignedTemplate;

  async function handleOpenPortal() {
    const result = await billing.openPortal();
    if (result.url) {
      window.location.href = result.url;
    }
  }

  async function handlePay() {
    setPaying(true);
    setPayError(null);
    const result = await access.payAssignedTemplate();
    if (result.url) {
      window.location.href = result.url;
      return;
    }
    setPaying(false);
    setPayError(result.error ?? "Échec de la création du paiement.");
  }

  if (!template && !subscription) {
    return (
      <div className="flex flex-col gap-4">
        {access.status && (
          <div className="flex flex-wrap items-center gap-3 border border-border bg-background p-4">
            <StatusBadge label={access.status.allowed ? "Accès au site autorisé" : "Accès au site bloqué"} tone={access.status.allowed ? "green" : "red"} />
            <span className="text-xs text-muted-foreground">{accessReasonLabels[access.status.reason]}</span>
          </div>
        )}
        <p className="text-sm text-muted-foreground">Aucune formule ne vous a encore été attribuée. Contactez votre coach.</p>
      </div>
    );
  }

  const displayName = subscription?.planName || template?.name || "—";
  const displayAmountCents = subscription?.amountCents ?? template?.amountCents ?? null;
  const displayCurrency = subscription?.currency ?? template?.currency ?? "eur";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <BillingStatusBadge status={status} />
        <span className="text-sm font-medium text-foreground">{displayName}</span>
      </div>

      {access.status && (
        <div className="flex flex-wrap items-center gap-3 border border-border bg-background p-4">
          <StatusBadge label={access.status.allowed ? "Accès au site autorisé" : "Accès au site bloqué"} tone={access.status.allowed ? "green" : "red"} />
          <span className="text-xs text-muted-foreground">{accessReasonLabels[access.status.reason]}</span>
        </div>
      )}

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Prix</dt>
          <dd className="text-foreground">
            {formatAmountCents(displayAmountCents, displayCurrency)}
            {template ? billingIntervalLabels[template.billingInterval] : ""}
          </dd>
        </div>
        {template && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Fréquence</dt>
            <dd className="text-foreground">{billingIntervalFrequencyLabels[template.billingInterval]}</dd>
          </div>
        )}
        {template?.durationMonths && (
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Durée</dt>
            <dd className="text-foreground">{template.durationMonths} mois</dd>
          </div>
        )}
        <div>
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">Prochaine échéance</dt>
          <dd className="text-foreground">
            {subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "—"}
            {subscription?.cancelAtPeriodEnd ? " (résiliation programmée)" : ""}
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

      <div className="flex flex-wrap items-center gap-3">
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
          template && (
            <button
              type="button"
              onClick={handlePay}
              disabled={paying}
              className="flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CreditCard size={14} aria-hidden="true" />
              {paying ? "Redirection…" : "Activer mon abonnement"}
            </button>
          )
        )}
        {payError && <span className="text-xs text-red-400">{payError}</span>}
      </div>
    </div>
  );
}
