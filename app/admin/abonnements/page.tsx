"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Archive, CheckCircle, Pencil, Plus } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
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
        className="flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Plus size={14} aria-hidden="true" />
        Créer un modèle
      </button>

      {open && (
        <Modal title="Créer un modèle d'abonnement" onClose={() => setOpen(false)} maxWidth="max-w-lg">
          {success ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
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
              {error && <p className="text-xs text-red-400">{error}</p>}
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
  const [isActive, setIsActive] = useState(template.isActive);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const priceWillChange = Math.round(Number(amountEuros) * 100) !== template.amountCents;

  function openModal() {
    setName(template.name);
    setDescription(template.description);
    setAmountEuros(String(template.amountCents / 100));
    setDurationMonths(template.durationMonths ? String(template.durationMonths) : "");
    setIsActive(template.isActive);
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
          isActive,
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
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
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
                <p className="border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                  Le prix Stripe étant immuable, un changement crée un nouveau Price et désactive l&apos;ancien (l&apos;historique des
                  abonnements existants n&apos;est pas affecté).
                </p>
              )}
              <CheckboxField label="Modèle actif (proposé aux élèves)" checked={isActive} onChange={setIsActive} />
              {error && <p className="text-xs text-red-400">{error}</p>}
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

function TemplateRow({ template, onChanged }: { template: SubscriptionTemplate; onChanged: () => void }) {
  const [archiving, setArchiving] = useState(false);

  async function handleArchive() {
    setArchiving(true);
    try {
      await fetch(`/api/admin/subscription-templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: false }),
      });
      onChanged();
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6 lg:flex-row lg:items-center lg:justify-between">
      <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Nom</span>
          <span className="font-heading text-lg font-bold text-foreground">{template.name}</span>
          {template.description && <span className="block text-xs text-muted-foreground">{template.description}</span>}
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Prix</span>
          <span className="block text-sm text-foreground">
            {formatAmountCents(template.amountCents, template.currency)}
            {billingIntervalLabels[template.billingInterval]}
          </span>
          {template.durationMonths && <span className="block text-xs text-muted-foreground">Durée : {template.durationMonths} mois</span>}
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Statut</span>
          <span className="mt-1 block">
            <StatusBadge label={template.isActive ? "Actif" : "Archivé"} tone={template.isActive ? "green" : "muted"} />
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Stripe</span>
          <span className="block text-xs text-muted-foreground">
            {template.stripePriceId ? template.stripePriceId : "Non créé (Stripe non configuré à la création)"}
          </span>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
        <EditTemplateModal template={template} onUpdated={onChanged} />
        {template.isActive && (
          <button
            type="button"
            onClick={handleArchive}
            disabled={archiving}
            className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Archive size={13} />
            {archiving ? "Archivage…" : "Archiver"}
          </button>
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
            className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
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
