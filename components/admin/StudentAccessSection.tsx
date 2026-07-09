"use client";

import { useId, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { CreateCheckoutLinkModal } from "@/components/shared/CreateCheckoutLinkModal";
import { useSupabaseStudentAccess, type SupabaseStudentAccessState } from "@/hooks/useSupabaseStudentAccess";
import { PLAN_DEFINITIONS, getPlanLabel, type PlanKey } from "@/lib/stripe/plans";
import { accessModeLabels, accessReasonLabels } from "@/lib/supabase/student-access";
import type { BillingAccessMode, StudentAccessStatus } from "@/types";

const accessModeOptions: { value: BillingAccessMode; label: string }[] = [
  { value: "subscription_required", label: accessModeLabels.subscription_required },
  { value: "manual_allowed", label: accessModeLabels.manual_allowed },
  { value: "manual_blocked", label: accessModeLabels.manual_blocked },
];

/**
 * Bloc "Accès au site" de la fiche élève admin (chantier
 * "supabase-stripe-access-control") : statut/raison, mode d'accès,
 * formule attribuée, création de lien de paiement pour cette formule.
 */
export function StudentAccessSection({ studentId }: { studentId: string }) {
  const access = useSupabaseStudentAccess(studentId);

  return (
    <AdminSection title="Accès au site">
      {access.loading || !access.status ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <StudentAccessForm
          studentId={studentId}
          status={access.status}
          assignedPlan={access.assignedPlan}
          accessNote={access.accessNote}
          save={access.save}
        />
      )}
    </AdminSection>
  );
}

interface StudentAccessFormProps {
  studentId: string;
  status: StudentAccessStatus;
  assignedPlan: string | null;
  accessNote: string;
  save: SupabaseStudentAccessState["save"];
}

/**
 * Séparé de StudentAccessSection pour ne monter qu'une fois les données
 * réelles chargées : les `useState` d'édition s'initialisent directement
 * avec les valeurs reçues, sans effet de synchronisation après coup
 * (règle react-hooks/set-state-in-effect).
 */
function StudentAccessForm({ studentId, status, assignedPlan, accessNote, save }: StudentAccessFormProps) {
  const [mode, setMode] = useState<BillingAccessMode>(status.accessMode);
  const [plan, setPlan] = useState<PlanKey | "">((assignedPlan as PlanKey | null) ?? "");
  const [note, setNote] = useState(accessNote);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const modeSelectId = useId();
  const planSelectId = useId();
  const noteId = useId();

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    const ok = await save({
      billingAccessMode: mode,
      assignedStripePlan: plan || null,
      accessNote: note,
    });
    setSaving(false);
    setSaved(ok);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge label={status.allowed ? "Accès autorisé" : "Accès bloqué"} tone={status.allowed ? "green" : "red"} />
        <span className="text-sm text-muted-foreground">{accessReasonLabels[status.reason]}</span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={modeSelectId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Mode d&apos;accès
          </label>
          <select
            id={modeSelectId}
            value={mode}
            onChange={(event) => setMode(event.target.value as BillingAccessMode)}
            className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          >
            {accessModeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={planSelectId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Formule attribuée
          </label>
          <select
            id={planSelectId}
            value={plan}
            onChange={(event) => setPlan(event.target.value as PlanKey)}
            className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
          >
            <option value="">Aucune</option>
            {PLAN_DEFINITIONS.map((definition) => (
              <option key={definition.key} value={definition.key}>
                {definition.label}
              </option>
            ))}
          </select>
        </div>
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
          onClick={handleSave}
          disabled={saving}
          className="border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
        {saved && <span className="text-xs text-green-400">Enregistré.</span>}
        <CreateCheckoutLinkModal
          triggerLabel="Créer lien de paiement pour cette formule"
          mode="admin"
          defaultPlanKey={plan || assignedPlan}
          onCreateCheckout={async (planKey) => {
            const response = await fetch("/api/stripe/create-checkout-session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ studentId, planKey }),
            });
            const data = await response.json();
            return response.ok
              ? { url: data.url as string, error: null }
              : { url: null, error: data.error ?? "Échec de la création du lien." };
          }}
        />
      </div>
      {plan && <p className="text-xs text-muted-foreground">Formule attribuée actuelle : {getPlanLabel(plan)}.</p>}
    </div>
  );
}
