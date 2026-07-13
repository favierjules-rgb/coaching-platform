"use client";

import { type ReactNode, useId, useState } from "react";
import { CreditCard, ExternalLink } from "lucide-react";

import { AdminSection, InfoRow } from "@/components/admin/AdminSection";
import { PaymentSectionContent } from "@/components/admin/PaymentSection";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { BillingStatusBadge } from "@/components/shared/BillingStatusBadge";
import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { useSupabaseStudentAccess } from "@/hooks/useSupabaseStudentAccess";
import { useSupabaseStudentBilling } from "@/hooks/useSupabaseStudentBilling";
import { useSupabaseSubscriptionTemplates } from "@/hooks/useSupabaseSubscriptionTemplates";
import { formatDate } from "@/lib/admin";
import { remainingAmountEuros } from "@/lib/payments";
import { buildCheckoutOffers, formatTemplateOffer } from "@/lib/stripe/plans";
import { formatAmountCents, toStudentBillingStatus } from "@/lib/stripe/status";
import { accessModeLabels, accessReasonLabels, type UpdateStudentAccessInput } from "@/lib/supabase/student-access";
import type { BillingAccessMode, StudentAccessStatus, StudentBillingSummary, StudentPaymentProfile, SubscriptionTemplate } from "@/types";

const accessModeOptions: { value: BillingAccessMode; label: string }[] = [
  { value: "subscription_required", label: accessModeLabels.subscription_required },
  { value: "manual_allowed", label: accessModeLabels.manual_allowed },
  { value: "manual_blocked", label: accessModeLabels.manual_blocked },
];

/**
 * Carte "Abonnement & Paiement" de la fiche élève admin — fusion des 3
 * blocs précédents (Paiement/abonnement Stripe, Accès au site, Paiement
 * manuel) en une seule carte avec résumé + 3 sous-sections repliables
 * (chantier "supabase-subscription-templates"). Remplace
 * StudentBillingSection + StudentAccessSection (supprimés) ; PaymentSection
 * reste utilisable seule ailleurs mais son contenu est réutilisé ici via
 * PaymentSectionContent pour ne rien dupliquer.
 */
export function StudentSubscriptionSection({
  studentId,
  profile,
  onUpdatePayment,
}: {
  studentId: string;
  profile: StudentPaymentProfile;
  onUpdatePayment: (next: StudentPaymentProfile) => void;
}) {
  const access = useSupabaseStudentAccess(studentId);
  const billing = useSupabaseStudentBilling(studentId);
  const templates = useSupabaseSubscriptionTemplates(true);

  const loading = access.loading || billing.loading || templates.loading || !access.status;

  return (
    <AdminSection title="Abonnement & Paiement">
      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <StudentSubscriptionForm
          studentId={studentId}
          profile={profile}
          onUpdatePayment={onUpdatePayment}
          status={access.status as StudentAccessStatus}
          assignedTemplateId={access.assignedTemplateId}
          accessNote={access.accessNote}
          saveAccess={access.save}
          billingSummary={billing.summary}
          createCheckoutLinkForTemplate={billing.createCheckoutLinkForTemplate}
          openPortal={billing.openPortal}
          templates={templates.templates}
        />
      )}
    </AdminSection>
  );
}

function Subsection({ title, defaultOpen, children }: { title: string; defaultOpen?: boolean; children: ReactNode }) {
  return (
    <details className="group border border-border" open={defaultOpen}>
      <summary className="cursor-pointer list-none px-4 py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:text-primary [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>
        {title}
      </summary>
      <div className="border-t border-border p-4">{children}</div>
    </details>
  );
}

interface StudentSubscriptionFormProps {
  studentId: string;
  profile: StudentPaymentProfile;
  onUpdatePayment: (next: StudentPaymentProfile) => void;
  status: StudentAccessStatus;
  assignedTemplateId: string | null;
  accessNote: string;
  saveAccess: (input: UpdateStudentAccessInput) => Promise<boolean>;
  billingSummary: StudentBillingSummary | null;
  createCheckoutLinkForTemplate: (templateId: string) => Promise<{ url: string | null; error: string | null }>;
  openPortal: () => Promise<{ url: string | null; error: string | null }>;
  templates: SubscriptionTemplate[];
}

/**
 * Séparé de StudentSubscriptionSection pour ne monter qu'une fois les
 * données réelles chargées : les `useState` d'édition s'initialisent
 * directement avec les valeurs reçues, sans effet de synchronisation après
 * coup (règle react-hooks/set-state-in-effect).
 */
function StudentSubscriptionForm({
  studentId,
  profile,
  onUpdatePayment,
  status,
  assignedTemplateId,
  accessNote,
  saveAccess,
  billingSummary,
  createCheckoutLinkForTemplate,
  openPortal,
  templates,
}: StudentSubscriptionFormProps) {
  const [mode, setMode] = useState<BillingAccessMode>(status.accessMode);
  const [templateId, setTemplateId] = useState(assignedTemplateId ?? "");
  const [note, setNote] = useState(accessNote);
  const [savingAccess, setSavingAccess] = useState(false);
  const [savedAccess, setSavedAccess] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assigned, setAssigned] = useState(false);
  const [deletingSubscription, setDeletingSubscription] = useState(false);
  const [deletingPayment, setDeletingPayment] = useState(false);
  const modeSelectId = useId();
  const templateSelectId = useId();
  const noteId = useId();

  const assignedTemplate = templates.find((t) => t.id === templateId) ?? null;
  const activeSubscription = billingSummary?.subscription ?? null;
  const displayedPlanName = activeSubscription?.planName || assignedTemplate?.name || "Aucune";
  const billingStatus = billingSummary ? toStudentBillingStatus(activeSubscription?.status ?? null) : "sans_abonnement";

  async function handleSaveAccess() {
    setSavingAccess(true);
    setSavedAccess(false);
    const ok = await saveAccess({ billingAccessMode: mode, assignedSubscriptionTemplateId: templateId || null, accessNote: note });
    setSavingAccess(false);
    setSavedAccess(ok);
  }

  async function handleAssignTemplate() {
    setAssigning(true);
    setAssigned(false);
    const isNewAssignment = !!templateId && templateId !== assignedTemplateId;
    const ok = await saveAccess({ billingAccessMode: mode, assignedSubscriptionTemplateId: templateId || null, accessNote: note });
    setAssigning(false);
    setAssigned(ok);
    // Email envoyé uniquement lors d'une vraie nouvelle attribution (pas si
    // le modèle attribué n'a pas changé, pas si on l'a retiré) — best-effort,
    // n'affecte jamais le retour visuel "Modèle attribué." ci-dessus.
    if (ok && isNewAssignment) {
      fetch("/api/email/subscription-assigned", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      }).catch(() => {});
    }
  }

  async function handleOpenPortal() {
    const result = await openPortal();
    if (result.url) {
      window.open(result.url, "_blank", "noopener,noreferrer");
    }
  }

  async function handleDeleteSubscription() {
    if (!activeSubscription) return;
    if (!window.confirm("Supprimer définitivement cette ligne d'abonnement Supabase ? Ceci ne résilie rien côté Stripe.")) return;
    setDeletingSubscription(true);
    try {
      await fetch(`/api/admin/billing/subscriptions/${activeSubscription.id}`, { method: "DELETE" });
      window.location.reload();
    } finally {
      setDeletingSubscription(false);
    }
  }

  async function handleDeletePayment() {
    const lastPayment = billingSummary?.lastPayment;
    if (!lastPayment) return;
    if (!window.confirm("Supprimer définitivement ce paiement Supabase ? Ceci ne rembourse rien côté Stripe.")) return;
    setDeletingPayment(true);
    try {
      await fetch(`/api/admin/billing/payments/${lastPayment.id}`, { method: "DELETE" });
      window.location.reload();
    } finally {
      setDeletingPayment(false);
    }
  }

  const checkoutOffers = buildCheckoutOffers(templates);

  return (
    <div className="flex flex-col gap-6">
      {/* Résumé */}
      <div className="flex flex-col gap-3 border border-border bg-background/40 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge label={status.allowed ? "Accès autorisé" : "Accès bloqué"} tone={status.allowed ? "green" : "red"} />
          <span className="text-sm text-muted-foreground">{accessReasonLabels[status.reason]}</span>
          <BillingStatusBadge status={billingStatus} />
        </div>
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <InfoRow label="Formule attribuée" value={displayedPlanName} />
          <InfoRow
            label="Montant"
            value={activeSubscription ? formatAmountCents(activeSubscription.amountCents, activeSubscription.currency) : "—"}
          />
          <InfoRow
            label="Prochaine échéance"
            value={
              activeSubscription?.currentPeriodEnd
                ? formatDate(activeSubscription.currentPeriodEnd) + (activeSubscription.cancelAtPeriodEnd ? " (résiliation programmée)" : "")
                : "—"
            }
          />
          <InfoRow
            label="Dernier paiement"
            value={
              billingSummary?.lastPayment
                ? `${formatAmountCents(billingSummary.lastPayment.amountCents, billingSummary.lastPayment.currency)} · ${formatDate(billingSummary.lastPayment.paidAt ?? billingSummary.lastPayment.createdAt)}`
                : "Aucun paiement Stripe"
            }
          />
          <InfoRow label="Reste à payer (manuel)" value={`${remainingAmountEuros(profile)} €`} />
        </div>
        {(activeSubscription || billingSummary?.lastPayment) && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            {activeSubscription && (
              <button
                type="button"
                onClick={handleDeleteSubscription}
                disabled={deletingSubscription}
                className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingSubscription ? "Suppression…" : "Supprimer l'abonnement (Supabase)"}
              </button>
            )}
            {billingSummary?.lastPayment && (
              <button
                type="button"
                onClick={handleDeletePayment}
                disabled={deletingPayment}
                className="text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deletingPayment ? "Suppression…" : "Supprimer le dernier paiement (Supabase)"}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Subsection title="A. Accès au site">
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor={modeSelectId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Mode d&apos;accès
              </label>
              <select
                id={modeSelectId}
                value={mode}
                onChange={(event) => setMode(event.target.value as BillingAccessMode)}
                className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none sm:max-w-sm"
              >
                {accessModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={noteId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Note (optionnel, interne)
              </label>
              <input
                id={noteId}
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Ex : élève offert, accès test, ancien élève..."
                className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSaveAccess}
                disabled={savingAccess}
                className="border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {savingAccess ? "Enregistrement…" : "Enregistrer"}
              </button>
              {savedAccess && <span className="text-xs text-green-400">Enregistré.</span>}
            </div>
          </div>
        </Subsection>

        <Subsection title="B. Modèle d'abonnement">
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor={templateSelectId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Modèle attribué
              </label>
              <select
                id={templateSelectId}
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none sm:max-w-sm"
              >
                <option value="">Aucun</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {formatTemplateOffer(template)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleAssignTemplate}
                disabled={assigning}
                className="border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {assigning ? "Attribution…" : "Attribuer"}
              </button>
              {assigned && <span className="text-xs text-green-400">Modèle attribué.</span>}
              <CreateCheckoutLinkModal
                triggerLabel="Créer lien de paiement Stripe"
                mode="admin"
                offers={checkoutOffers}
                defaultOfferId={templateId || checkoutOffers[0]?.id}
                onCreateCheckout={(offerId) => createCheckoutLinkForTemplate(offerId)}
              />
            </div>

            {billingSummary?.customer && (
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <button
                  type="button"
                  onClick={handleOpenPortal}
                  className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <CreditCard size={14} aria-hidden="true" />
                  Ouvrir le portail client
                </button>
                <a
                  href={`https://dashboard.stripe.com/customers/${billingSummary.customer.stripeCustomerId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Voir dans Stripe
                </a>
              </div>
            )}
          </div>
        </Subsection>

        <Subsection title="C. Paiement manuel existant">
          <PaymentSectionContent studentId={studentId} profile={profile} onUpdate={onUpdatePayment} />
        </Subsection>
      </div>
    </div>
  );
}
