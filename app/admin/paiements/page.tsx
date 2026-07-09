"use client";

import { useState } from "react";
import Link from "next/link";
import { CreditCard, ExternalLink, Settings } from "lucide-react";

import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { BillingStatusBadge } from "@/components/shared/BillingStatusBadge";
import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { useSupabaseAdminBilling } from "@/hooks/useSupabaseAdminBilling";
import { useSupabaseSubscriptionTemplates } from "@/hooks/useSupabaseSubscriptionTemplates";
import { formatDate, matchesTextSearch } from "@/lib/admin";
import { buildCheckoutOffers, getPlanLabel, type CheckoutOffer } from "@/lib/stripe/plans";
import { formatAmountCents } from "@/lib/stripe/status";
import { accessReasonLabels } from "@/lib/supabase/student-access";
import type { AdminBillingListItem } from "@/lib/supabase/billing";
import type { StudentBillingStatus } from "@/types";

type StatusFilter = "tous" | "actif" | "en_retard" | "annule" | "sans_abonnement";
type AccessFilter = "tous" | "autorise" | "bloque";

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "actif", label: "Actifs" },
  { value: "en_retard", label: "En retard" },
  { value: "annule", label: "Annulés" },
  { value: "sans_abonnement", label: "Sans abonnement" },
];

const accessFilters: { value: AccessFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "autorise", label: "Accès autorisé" },
  { value: "bloque", label: "Accès bloqué" },
];

function matchesStatusFilter(status: StudentBillingStatus, filter: StatusFilter): boolean {
  if (filter === "tous") return true;
  if (filter === "actif") return status === "actif";
  if (filter === "en_retard") return status === "paiement_echoue";
  if (filter === "annule") return status === "annule" || status === "expire";
  return status === "sans_abonnement";
}

function matchesAccessFilter(allowed: boolean, filter: AccessFilter): boolean {
  if (filter === "tous") return true;
  return filter === "autorise" ? allowed : !allowed;
}

async function createCheckoutLinkFor(
  studentId: string,
  offerId: string,
  hasTemplates: boolean,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const response = await fetch("/api/stripe/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hasTemplates ? { studentId, templateId: offerId } : { studentId, planKey: offerId }),
    });
    const data = await response.json();
    return response.ok ? { url: data.url as string, error: null } : { url: null, error: data.error ?? "Échec de la création du lien." };
  } catch {
    return { url: null, error: "Échec de la création du lien." };
  }
}

async function openPortalFor(studentId: string): Promise<{ url: string | null; error: string | null }> {
  try {
    const response = await fetch("/api/stripe/create-customer-portal-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    });
    const data = await response.json();
    return response.ok ? { url: data.url as string, error: null } : { url: null, error: data.error ?? "Échec de l'ouverture du portail." };
  } catch {
    return { url: null, error: "Échec de l'ouverture du portail." };
  }
}

function planLabelFor(item: AdminBillingListItem): string {
  if (item.subscription?.planName) return item.subscription.planName;
  const assignedName = item.assignedTemplateName ?? (item.assignedStripePlan ? getPlanLabel(item.assignedStripePlan) : null);
  return assignedName ? `${assignedName} (attribuée)` : "—";
}

function BillingRow({ item, offers, hasTemplates }: { item: AdminBillingListItem; offers: CheckoutOffer[]; hasTemplates: boolean }) {
  async function handleOpenPortal() {
    const result = await openPortalFor(item.studentId);
    if (result.url) window.open(result.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Élève</span>
          <span className="font-heading text-lg font-bold text-foreground">
            {item.studentFirstName} {item.studentLastName}
          </span>
          <span className="block text-xs text-muted-foreground">{item.studentEmail}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut abonnement</span>
          <span className="mt-1 block">
            <BillingStatusBadge status={item.status} />
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Accès au site</span>
          <span className="mt-1 block">
            <StatusBadge label={item.access.allowed ? "Autorisé" : "Bloqué"} tone={item.access.allowed ? "green" : "red"} />
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">{accessReasonLabels[item.access.reason]}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Formule · Montant</span>
          <span className="block text-sm text-foreground">{planLabelFor(item)}</span>
          <span className="block text-sm text-muted-foreground">
            {item.subscription ? formatAmountCents(item.subscription.amountCents, item.subscription.currency) : "—"}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Prochaine échéance</span>
          <span className="block text-sm text-foreground">
            {item.subscription?.currentPeriodEnd ? formatDate(item.subscription.currentPeriodEnd) : "—"}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Dernier paiement</span>
          <span className="block text-sm text-foreground">
            {item.lastPayment
              ? `${formatAmountCents(item.lastPayment.amountCents, item.lastPayment.currency)} · ${formatDate(item.lastPayment.paidAt ?? item.lastPayment.createdAt)}`
              : "Aucun"}
          </span>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        <CreateCheckoutLinkModal
          triggerLabel="Créer lien de paiement"
          mode="admin"
          offers={offers}
          defaultOfferId={hasTemplates ? item.assignedSubscriptionTemplateId : item.assignedStripePlan}
          onCreateCheckout={(offerId) => createCheckoutLinkFor(item.studentId, offerId, hasTemplates)}
        />
        {item.customer && (
          <>
            <button
              type="button"
              onClick={handleOpenPortal}
              className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <CreditCard size={13} />
              Portail
            </button>
            <a
              href={`https://dashboard.stripe.com/customers/${item.customer.stripeCustomerId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <ExternalLink size={13} />
              Stripe
            </a>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminBillingPage() {
  const billing = useSupabaseAdminBilling();
  const templates = useSupabaseSubscriptionTemplates(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("tous");

  const offers = buildCheckoutOffers(templates.templates);
  const hasTemplates = templates.templates.length > 0;

  const filtered = billing.items.filter(
    (item) =>
      matchesTextSearch([item.studentFirstName, item.studentLastName, item.studentEmail], query) &&
      matchesStatusFilter(item.status, statusFilter) &&
      matchesAccessFilter(item.access.allowed, accessFilter),
  );

  const activeCount = billing.items.filter((item) => item.status === "actif").length;
  const lateCount = billing.items.filter((item) => item.status === "paiement_echoue").length;
  const blockedCount = billing.items.filter((item) => !item.access.allowed).length;
  const monthlyRevenueCents = billing.items
    .filter((item) => item.status === "actif")
    .reduce((total, item) => total + (item.subscription?.amountCents ?? 0), 0);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Paiements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Statuts d&apos;abonnement et de paiement Stripe de tous les élèves.
          </p>
        </div>
        <Link
          href="/admin/abonnements"
          className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Settings size={14} aria-hidden="true" />
          Gérer les modèles d&apos;abonnements
        </Link>
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Abonnements actifs</span>
          <span className="font-heading text-2xl font-bold text-foreground">{activeCount}</span>
        </div>
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Paiements en retard</span>
          <span className="font-heading text-2xl font-bold text-foreground">{lateCount}</span>
        </div>
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Accès bloqué</span>
          <span className="font-heading text-2xl font-bold text-foreground">{blockedCount}</span>
        </div>
        <div className="border border-border bg-card p-4">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Revenu mensuel estimé</span>
          <span className="font-heading text-2xl font-bold text-foreground">{formatAmountCents(monthlyRevenueCents)}</span>
        </div>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher par nom ou email..." />
        <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
        <FilterButtons options={accessFilters} active={accessFilter} onChange={setAccessFilter} />
      </div>

      {billing.loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun élève ne correspond à ces filtres.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((item) => (
            <BillingRow key={item.studentId} item={item} offers={offers} hasTemplates={hasTemplates} />
          ))}
        </div>
      )}
    </div>
  );
}
