"use client";

import { useState } from "react";
import { CheckCircle, CreditCard, Pencil, Plus } from "lucide-react";

import { AdminSection, InfoRow } from "@/components/admin/AdminSection";
import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatDate } from "@/lib/admin";
import {
  paymentMethodLabels,
  paymentStatusLabels,
  paymentStatusTone,
  remainingAmountEuros,
} from "@/lib/payments";
import type { PaymentMethod, PaymentStatus, StudentPaymentEntry, StudentPaymentProfile } from "@/types";

const methodOptions: { value: PaymentMethod; label: string }[] = [
  { value: "virement", label: "Virement" },
  { value: "carte", label: "Carte" },
  { value: "espèces", label: "Espèces" },
  { value: "chèque", label: "Chèque" },
  { value: "autre", label: "Autre" },
];

const statusOptions: { value: PaymentStatus; label: string }[] = [
  { value: "à jour", label: "À jour" },
  { value: "en attente", label: "En attente" },
  { value: "en retard", label: "En retard" },
  { value: "terminé", label: "Terminé" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function EditPaymentProfileModal({
  profile,
  onSave,
}: {
  profile: StudentPaymentProfile;
  onSave: (next: StudentPaymentProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [offerName, setOfferName] = useState(profile.offerName);
  const [monthlyPrice, setMonthlyPrice] = useState(String(profile.monthlyPriceEuros));
  const [duration, setDuration] = useState(String(profile.durationMonths));
  const [status, setStatus] = useState<PaymentStatus>(profile.status);
  const [method, setMethod] = useState<PaymentMethod>(profile.method);
  const [nextPaymentDate, setNextPaymentDate] = useState(profile.nextPaymentDate ?? "");
  const [installmentsTotal, setInstallmentsTotal] = useState(String(profile.installmentsTotal));
  const [installmentsPaid, setInstallmentsPaid] = useState(String(profile.installmentsPaid));

  function openModal() {
    setOfferName(profile.offerName);
    setMonthlyPrice(String(profile.monthlyPriceEuros));
    setDuration(String(profile.durationMonths));
    setStatus(profile.status);
    setMethod(profile.method);
    setNextPaymentDate(profile.nextPaymentDate ?? "");
    setInstallmentsTotal(String(profile.installmentsTotal));
    setInstallmentsPaid(String(profile.installmentsPaid));
    setSubmitted(false);
    setOpen(true);
  }

  function handleSubmit() {
    const monthlyPriceEuros = Number(monthlyPrice) || 0;
    const durationMonths = Number(duration) || 0;
    onSave({
      ...profile,
      offerName: offerName.trim(),
      monthlyPriceEuros,
      durationMonths,
      totalPriceEuros: Math.round(monthlyPriceEuros * durationMonths * 100) / 100,
      status,
      method,
      nextPaymentDate: nextPaymentDate.trim() || null,
      installmentsTotal: Number(installmentsTotal) || 0,
      installmentsPaid: Number(installmentsPaid) || 0,
      updatedAt: new Date().toISOString(),
    });
    setSubmitted(true);
  }

  return (
    <>
      <OutlineButton onClick={openModal}>
        <span className="flex items-center gap-1.5">
          <Pencil size={13} />
          Modifier paiement
        </span>
      </OutlineButton>

      {open && (
        <Modal title="Modifier le paiement" onClose={() => setOpen(false)} maxWidth="max-w-lg">
          {submitted ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Paiement mis à jour.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Offre / formule" value={offerName} onChange={setOfferName} placeholder="Ex : Coaching 3 mois" />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prix mensuel (€)" type="number" value={monthlyPrice} onChange={setMonthlyPrice} />
                <Field label="Durée (mois)" type="number" value={duration} onChange={setDuration} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Statut"
                  value={status}
                  onChange={(v) => setStatus(v as PaymentStatus)}
                  options={statusOptions}
                />
                <SelectField
                  label="Mode de paiement"
                  value={method}
                  onChange={(v) => setMethod(v as PaymentMethod)}
                  options={methodOptions}
                />
              </div>
              <Field label="Date du prochain paiement" type="date" value={nextPaymentDate} onChange={setNextPaymentDate} />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Nombre d'échéances"
                  type="number"
                  value={installmentsTotal}
                  onChange={setInstallmentsTotal}
                />
                <Field
                  label="Échéances payées"
                  type="number"
                  value={installmentsPaid}
                  onChange={setInstallmentsPaid}
                />
              </div>
              <PrimaryButton onClick={handleSubmit}>Enregistrer les modifications</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

function AddPaymentEntryModal({
  studentId,
  profile,
  onSave,
}: {
  studentId: string;
  profile: StudentPaymentProfile;
  onSave: (next: StudentPaymentProfile) => void;
}) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>(profile.method);
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<PaymentStatus>("terminé");

  function openModal() {
    setAmount("");
    setDate(today());
    setMethod(profile.method);
    setNote("");
    setStatus("terminé");
    setSubmitted(false);
    setOpen(true);
  }

  const canSubmit = amount.trim() !== "" && Number(amount) > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    const amountValue = Number(amount);
    const now = new Date().toISOString();
    const entry: StudentPaymentEntry = {
      paymentId: `pay-${Date.now()}`,
      studentId,
      amount: amountValue,
      date,
      method,
      note,
      status,
      createdAt: now,
      updatedAt: now,
    };
    onSave({
      ...profile,
      entries: [...profile.entries, entry],
      paidAmountEuros: Math.round((profile.paidAmountEuros + amountValue) * 100) / 100,
      installmentsPaid: Math.min(profile.installmentsTotal || profile.installmentsPaid + 1, profile.installmentsPaid + 1),
      updatedAt: now,
    });
    setSubmitted(true);
  }

  return (
    <>
      <OutlineButton onClick={openModal}>
        <span className="flex items-center gap-1.5">
          <Plus size={13} />
          Ajouter un paiement
        </span>
      </OutlineButton>

      {open && (
        <Modal title="Ajouter un paiement" onClose={() => setOpen(false)} maxWidth="max-w-md">
          {submitted ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Paiement enregistré.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Démonstration : aucun paiement réel n&apos;est traité, cette saisie reste mockée.
              </p>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Montant (€)" type="number" step="0.01" value={amount} onChange={setAmount} />
                <Field label="Date" type="date" value={date} onChange={setDate} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Mode de paiement"
                  value={method}
                  onChange={(v) => setMethod(v as PaymentMethod)}
                  options={methodOptions}
                />
                <SelectField
                  label="Statut"
                  value={status}
                  onChange={(v) => setStatus(v as PaymentStatus)}
                  options={statusOptions}
                />
              </div>
              <Field label="Note (optionnel)" value={note} onChange={setNote} />
              <PrimaryButton onClick={handleSubmit} disabled={!canSubmit}>
                Enregistrer le paiement
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/**
 * Contenu du bloc "Paiement manuel" — extrait de `PaymentSection` (sans le
 * wrapper `AdminSection`) pour être embarqué dans
 * `StudentSubscriptionSection` (chantier "supabase-subscription-templates",
 * sous-section C "Paiement manuel existant"), sans dupliquer la logique.
 */
export function PaymentSectionContent({
  studentId,
  profile,
  onUpdate,
}: {
  studentId: string;
  profile: StudentPaymentProfile;
  onUpdate: (next: StudentPaymentProfile) => void;
}) {
  const remaining = remainingAmountEuros(profile);
  const entries = Array.isArray(profile.entries) ? profile.entries : [];
  const sortedEntries = [...entries].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  function handleMarkAsPaid() {
    onUpdate({
      ...profile,
      paidAmountEuros: profile.totalPriceEuros,
      installmentsPaid: profile.installmentsTotal,
      status: "terminé",
      nextPaymentDate: null,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <EditPaymentProfileModal profile={profile} onSave={onUpdate} />
        <AddPaymentEntryModal studentId={studentId} profile={profile} onSave={onUpdate} />
        <button
          type="button"
          onClick={handleMarkAsPaid}
          disabled={profile.status === "terminé" && remaining === 0}
          className="flex items-center gap-1.5 border border-green-500/50 px-4 py-2 text-xs uppercase tracking-widest text-green-400 transition-colors hover:bg-green-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <CreditCard size={13} />
          Marquer comme payé
        </button>
      </div>

      {!profile.offerName && profile.totalPriceEuros === 0 && entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun paiement renseigné pour le moment.</p>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between gap-4">
            <span className="text-sm text-foreground">{profile.offerName || "Offre non renseignée"}</span>
            <StatusBadge
              label={paymentStatusLabels[profile.status] ?? "Statut inconnu"}
              tone={paymentStatusTone[profile.status] ?? "muted"}
            />
          </div>
          <InfoRow label="Prix mensuel" value={`${profile.monthlyPriceEuros} €`} />
          <InfoRow label="Durée du coaching" value={`${profile.durationMonths} mois`} />
          <InfoRow label="Prix total" value={`${profile.totalPriceEuros} €`} />
          <InfoRow label="Montant payé" value={`${profile.paidAmountEuros} €`} />
          <InfoRow label="Reste à payer" value={`${remaining} €`} />
          <InfoRow label="Mode de paiement" value={paymentMethodLabels[profile.method] ?? "Non renseigné"} />
          <InfoRow
            label="Prochain paiement"
            value={profile.nextPaymentDate ? formatDate(profile.nextPaymentDate) : "Aucune échéance prévue"}
          />
          <InfoRow
            label="Échéances"
            value={`${profile.installmentsPaid} / ${profile.installmentsTotal} payées`}
          />

          <div className="mt-6">
            <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
              Historique des paiements
            </span>
            {sortedEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun versement enregistré pour le moment.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {sortedEntries.map((entry) => (
                  <div
                    key={entry.paymentId}
                    className="flex flex-wrap items-center justify-between gap-2 border border-border px-4 py-3"
                  >
                    <div>
                      <span className="block text-sm text-foreground">{entry.amount} €</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(entry.date)} · {paymentMethodLabels[entry.method] ?? "Mode inconnu"}
                        {entry.note ? ` · ${entry.note}` : ""}
                      </span>
                    </div>
                    <StatusBadge
                      label={paymentStatusLabels[entry.status] ?? "Statut inconnu"}
                      tone={paymentStatusTone[entry.status] ?? "muted"}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function PaymentSection({
  studentId,
  profile,
  onUpdate,
}: {
  studentId: string;
  profile: StudentPaymentProfile;
  onUpdate: (next: StudentPaymentProfile) => void;
}) {
  return (
    <AdminSection title="Paiement">
      <PaymentSectionContent studentId={studentId} profile={profile} onUpdate={onUpdate} />
    </AdminSection>
  );
}
