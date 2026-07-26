"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, CheckCircle, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { useSupabaseSubscriptionTemplates } from "@/hooks/useSupabaseSubscriptionTemplates";
import { billingIntervalLabels } from "@/lib/stripe/plans";
import { formatAmountCents } from "@/lib/stripe/status";
import type { BillingInterval, SubscriptionTemplate } from "@/types";

const intervalOptions: { value: BillingInterval; label: string }[] = [
  { value: "monthly", label: "Mensuel" },
  { value: "quarterly", label: "Trimestriel" },
  { value: "yearly", label: "Annuel" },
  { value: "one_time", label: "Paiement unique" },
];

function CreateTemplateModal({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [amountEuros, setAmountEuros] = useState("");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  const [durationMonths, setDurationMonths] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function openModal() {
    setName("");
    setDescription("");
    setAmountEuros("");
    setBillingInterval("monthly");
    setDurationMonths("");
    setError(null);
    setSuccess(false);
    setOpen(true);
  }

  const canSubmit = name.trim() !== "" && Number(amountEuros) > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/subscription-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          amountCents: Math.round(Number(amountEuros) * 100),
          currency: "eur",
          billingInterval,
          durationMonths: durationMonths ? Number(durationMonths) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Échec de la création du modèle.");
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setSubmitting(false);
      onCreated();
    } catch {
      setError("Échec de la création du modèle.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Plus size={14} aria-hidden="true" />
        Créer un modèle
      </button>

      {open && (
        <Modal title="Créer un modèle d'abonnement" onClose={() => setOpen(false)} maxWidth="max-w-lg">
          {success ? (
            <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success" role="status">
              <CheckCircle size={18} aria-hidden="true" className="flex-shrink-0" />
              Modèle créé (Product/Price Stripe inclus si Stripe est configuré).
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Nom" value={name} onChange={setName} placeholder="Ex : Coaching premium" />
              <TextareaField label="Description (optionnel)" value={description} onChange={setDescription} rows={2} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prix (€ TTC)" type="number" step="0.01" value={amountEuros} onChange={setAmountEuros} />
                <SelectField
                  label="Période de facturation"
                  value={billingInterval}
                  onChange={(v) => setBillingInterval(v as BillingInterval)}
                  options={intervalOptions}
                />
              </div>
              <Field
                label="Durée (mois, optionnel)"
                type="number"
                value={durationMonths}
                onChange={setDurationMonths}
                placeholder="Laisser vide si sans durée fixe"
              />
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
              <PrimaryButton onClick={handleSubmit} disabled={submitting || !canSubmit}>
                {submitting ? "Création…" : "Créer le modèle"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function EditTemplateModal({ template, onUpdated }: { template: SubscriptionTemplate; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [amountEuros, setAmountEuros] = useState(String(template.amountCents / 100));
  const [durationMonths, setDurationMonths] = useState(template.durationMonths ? String(template.durationMonths) : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const priceWillChange = Math.round(Number(amountEuros) * 100) !== template.amountCents;

  function openModal() {
    setName(template.name);
    setDescription(template.description);
    setAmountEuros(String(template.amountCents / 100));
    setDurationMonths(template.durationMonths ? String(template.durationMonths) : "");
    setError(null);
    setSuccess(false);
    setOpen(true);
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/subscription-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          amountCents: Math.round(Number(amountEuros) * 100),
          durationMonths: durationMonths ? Number(durationMonths) : null,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Échec de la mise à jour du modèle.");
        setSubmitting(false);
        return;
      }
      setSuccess(true);
      setSubmitting(false);
      onUpdated();
    } catch {
      setError("Échec de la mise à jour du modèle.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <OutlineButton onClick={openModal}>
        <span className="flex items-center gap-1.5">
          <Pencil size={13} />
          Modifier
        </span>
      </OutlineButton>

      {open && (
        <Modal title="Modifier le modèle" onClose={() => setOpen(false)} maxWidth="max-w-lg">
          {success ? (
            <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success" role="status">
              <CheckCircle size={18} aria-hidden="true" className="flex-shrink-0" />
              Modèle mis à jour.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Nom" value={name} onChange={setName} />
              <TextareaField label="Description" value={description} onChange={setDescription} rows={2} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prix (€ TTC)" type="number" step="0.01" value={amountEuros} onChange={setAmountEuros} />
                <Field label="Durée (mois, optionnel)" type="number" value={durationMonths} onChange={setDurationMonths} />
              </div>
              {priceWillChange && (
                <p className="rounded-panel border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Le prix Stripe étant immuable, un changement crée un nouveau Price et désactive l&apos;ancien (l&apos;historique des
                  abonnements existants n&apos;est pas affecté).
                </p>
              )}
              <p className="rounded-panel border border-border bg-surface-soft/40 px-3 py-2 text-xs text-muted-foreground">
                Le statut actif/archivé se gère via les actions dédiées <strong>Archiver</strong> et{" "}
                <strong>Réactiver</strong> : elles synchronisent aussi le tarif Stripe.
              </p>
              {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
              <PrimaryButton onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Enregistrement…" : "Enregistrer"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

interface TemplateReferences {
  studentsByTemplateId: number;
  studentsByPriceId: number;
  subscriptions: number;
  payments: number;
  otherTemplatesSharingProduct: number;
}
interface TemplateReferencesResponse {
  references: TemplateReferences;
  deletable: boolean;
  productShared: boolean;
  hasStripePrice: boolean;
}

/**
 * Confirmation de suppression DÉFINITIVE d'un modèle — charge d'abord les
 * références réelles (GET) pour n'autoriser la suppression que si le modèle est
 * inutilisé, et sinon proposer l'archivage. Affiche nom, montant/périodicité,
 * nombre d'élèves attribués, état Stripe, Product partagé ou non, et la
 * conséquence exacte. Aucune action n'est déclenchée à l'ouverture.
 */
function DeleteTemplateModal({ template, onChanged }: { template: SubscriptionTemplate; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<TemplateReferencesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  async function openModal() {
    setOpen(true);
    setInfo(null);
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/subscription-templates/${template.id}`, { method: "GET" });
      const data = await res.json();
      if (!res.ok) setError(data.error ?? "Impossible de charger les références du modèle.");
      else setInfo(data as TemplateReferencesResponse);
    } catch {
      setError("Impossible de charger les références du modèle.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/subscription-templates/${template.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setOpen(false);
        onChanged();
        return;
      }
      setError(data.error ?? "Échec de la suppression.");
    } catch {
      setError("Échec de la suppression.");
    } finally {
      setWorking(false);
    }
  }

  async function handleArchive() {
    setWorking(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/subscription-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      if (res.ok) {
        setOpen(false);
        onChanged();
        return;
      }
      setError("Échec de l'archivage.");
    } catch {
      setError("Échec de l'archivage.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-label={`Supprimer le modèle ${template.name}`}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/50 px-4 py-2 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
      >
        <Trash2 size={13} aria-hidden="true" />
        Supprimer
      </button>

      {open && (
        <Modal title="Supprimer le modèle" onClose={() => setOpen(false)} maxWidth="max-w-lg">
          {loading ? (
            <p className="text-sm text-muted-foreground">Chargement…</p>
          ) : info ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
                <p className="font-heading text-base font-bold text-foreground">{template.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatAmountCents(template.amountCents, template.currency)}
                  {billingIntervalLabels[template.billingInterval]}
                </p>
                <dl className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
                  {[
                    ["État local", template.isActive ? "Actif" : "Archivé"],
                    ["Élèves (par modèle)", String(info.references.studentsByTemplateId)],
                    ["Élèves (par tarif)", String(info.references.studentsByPriceId)],
                    ["Abonnements liés", String(info.references.subscriptions)],
                    ["Paiements liés", String(info.references.payments)],
                    ["Tarif Stripe", info.hasStripePrice ? "Sera archivé" : "Aucun"],
                    [
                      "Produit Stripe",
                      info.productShared
                        ? `Partagé (${info.references.otherTemplatesSharingProduct} autre(s) modèle(s)) — conservé actif`
                        : "Archivé s'il devient inutilisé",
                    ],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-center justify-between gap-4 border-b border-border py-2 last:border-0">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="text-right text-sm text-foreground">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {info.deletable ? (
                <>
                  <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
                    Supprimer définitivement ce modèle ? Le tarif Stripe associé sera archivé et ne pourra plus être
                    proposé à de nouveaux clients. Cette suppression est autorisée uniquement si aucun élève, abonnement,
                    paiement ou historique ne dépend du modèle — c&apos;est le cas ici.
                  </p>
                  {error && (
                    <p className="text-xs text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={working}
                      className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-control bg-destructive px-4 py-2 text-xs font-bold uppercase tracking-widest text-destructive-foreground transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 size={13} aria-hidden="true" />
                      {working ? "Suppression…" : "Supprimer définitivement"}
                    </button>
                    <OutlineButton onClick={() => setOpen(false)}>Annuler</OutlineButton>
                  </div>
                </>
              ) : (
                <>
                  <p className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning" role="alert">
                    Suppression impossible — références bloquantes :{" "}
                    {[
                      info.references.studentsByTemplateId > 0 &&
                        `${info.references.studentsByTemplateId} élève(s) attribué(s) par modèle`,
                      info.references.studentsByPriceId > 0 &&
                        `${info.references.studentsByPriceId} élève(s) attribué(s) par tarif`,
                      info.references.subscriptions > 0 && `${info.references.subscriptions} abonnement(s)`,
                      info.references.payments > 0 && `${info.references.payments} paiement(s)`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    . Détache d&apos;abord les élèves et clôture les abonnements, ou archive le modèle (son tarif Stripe
                    sera désactivé) pour le retirer des nouvelles ventes sans rien casser.
                  </p>
                  {error && (
                    <p className="text-xs text-destructive" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={handleArchive}
                      disabled={working}
                      className="pressable inline-flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Archive size={13} aria-hidden="true" />
                      {working ? "Archivage…" : "Archiver le modèle"}
                    </button>
                    <OutlineButton onClick={() => setOpen(false)}>Fermer</OutlineButton>
                  </div>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-destructive" role="alert">
              {error ?? "Erreur de chargement."}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

function TemplateRow({ template, onChanged }: { template: SubscriptionTemplate; onChanged: () => void }) {
  const [archiving, setArchiving] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  /** Archive (isActive:false) ou réactive (true) — la route applique le flux Stripe symétrique. */
  async function toggleActive(nextActive: boolean) {
    setArchiving(true);
    setToggleError(null);
    try {
      const res = await fetch(`/api/admin/subscription-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setToggleError(data.error ?? (nextActive ? "Échec de la réactivation." : "Échec de l'archivage."));
        return;
      }
      onChanged();
    } finally {
      setArchiving(false);
    }
  }

  return (
    // Collisions 1024-1440 corrigées (audit final) : la mise côte à côte et
    // la grille 4 colonnes n'arrivent qu'à partir de xl (la sidebar de 240 px
    // rend lg: trop étroit) ; chaque cellule est min-w-0 et l'identifiant
    // Stripe casse en break-all au lieu de se peindre sur les boutons.
    <div className="flex flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-soft transition-colors hover:border-border-strong xl:flex-row xl:items-center xl:justify-between">
      <div className="grid min-w-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Nom</span>
          <span className="break-words font-heading text-lg font-bold text-foreground">{template.name}</span>
          {template.description && <span className="block break-words text-xs text-muted-foreground">{template.description}</span>}
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Prix</span>
          <span className="block text-sm text-foreground">
            {formatAmountCents(template.amountCents, template.currency)}
            {billingIntervalLabels[template.billingInterval]}
          </span>
          {template.durationMonths && <span className="block text-xs text-muted-foreground">Durée : {template.durationMonths} mois</span>}
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut</span>
          <span className="mt-1 block">
            <StatusBadge label={template.isActive ? "Actif" : "Archivé"} tone={template.isActive ? "green" : "muted"} />
          </span>
        </div>
        <div className="min-w-0">
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Stripe</span>
          <span className="block break-all text-xs text-muted-foreground" title={template.stripePriceId ?? undefined}>
            {template.stripePriceId ? template.stripePriceId : "Non créé (Stripe non configuré à la création)"}
          </span>
        </div>
      </div>
      <div className="flex flex-none flex-col items-start gap-2 xl:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <EditTemplateModal template={template} onUpdated={onChanged} />
          {template.isActive ? (
            <button
              type="button"
              onClick={() => toggleActive(false)}
              disabled={archiving}
              title="Archive ce modèle dans l'application et désactive son tarif Stripe. Les abonnements existants continuent normalement."
              className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Archive size={13} aria-hidden="true" />
              {archiving ? "Archivage…" : "Archiver"}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => toggleActive(true)}
              disabled={archiving}
              title="Réactive le tarif Stripe et rend de nouveau ce modèle disponible."
              className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw size={13} aria-hidden="true" />
              {archiving ? "Réactivation…" : "Réactiver"}
            </button>
          )}
          <DeleteTemplateModal template={template} onChanged={onChanged} />
        </div>
        {toggleError && (
          <p className="text-xs text-destructive" role="alert">
            {toggleError}
          </p>
        )}
      </div>
    </div>
  );
}

export default function AdminSubscriptionTemplatesPage() {
  const templates = useSupabaseSubscriptionTemplates(false);

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/admin/paiements"
            className="mb-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowLeft size={14} aria-hidden="true" />
            Retour aux paiements
          </Link>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Modèles d&apos;abonnements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Formules proposées aux élèves — chaque modèle crée automatiquement son Product/Price Stripe.
          </p>
        </div>
        <CreateTemplateModal onCreated={templates.refetch} />
      </div>

      {templates.loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : templates.templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun modèle d&apos;abonnement pour le moment.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {templates.templates.map((template) => (
            <TemplateRow key={template.id} template={template} onChanged={templates.refetch} />
          ))}
        </div>
      )}
    </div>
  );
}
