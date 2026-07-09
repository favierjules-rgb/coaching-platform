"use client";

import { useId, useState } from "react";
import { CreditCard, ExternalLink, X } from "lucide-react";

import { PLAN_DEFINITIONS, type PlanKey } from "@/lib/stripe/plans";

interface CreateCheckoutLinkModalProps {
  triggerLabel: string;
  /** "student" : redirige automatiquement vers Stripe Checkout après création. "admin" : affiche un bouton "Ouvrir le lien" pour ne pas quitter la page admin. */
  mode: "student" | "admin";
  onCreateCheckout: (planKey: string) => Promise<{ url: string | null; error: string | null }>;
  /** Formule pré-sélectionnée à l'ouverture (ex : formule attribuée à l'élève) — reste modifiable dans le sélecteur. */
  defaultPlanKey?: string | null;
}

/** Sélection de formule + création de session Stripe Checkout, partagée élève ("Activer mon abonnement") et admin ("Créer lien de paiement"). */
export function CreateCheckoutLinkModal({ triggerLabel, mode, onCreateCheckout, defaultPlanKey }: CreateCheckoutLinkModalProps) {
  const [open, setOpen] = useState(false);
  const [planKey, setPlanKey] = useState<PlanKey | "">((defaultPlanKey as PlanKey | null) ?? PLAN_DEFINITIONS[0]?.key ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const selectId = useId();

  function openModal() {
    setPlanKey((defaultPlanKey as PlanKey | null) ?? PLAN_DEFINITIONS[0]?.key ?? "");
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
    setCheckoutUrl(null);
    setLoading(false);
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    const result = await onCreateCheckout(planKey);
    setLoading(false);
    if (result.error || !result.url) {
      setError(result.error ?? "Échec de la création du lien de paiement.");
      return;
    }
    if (mode === "student") {
      window.location.href = result.url;
      return;
    }
    setCheckoutUrl(result.url);
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="flex items-center gap-1.5 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        <CreditCard size={14} aria-hidden="true" />
        {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={triggerLabel}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-sm border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">{triggerLabel}</h3>
              <button
                type="button"
                onClick={close}
                aria-label="Fermer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {checkoutUrl ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">Lien de paiement créé.</p>
                <a
                  href={checkoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 border border-primary bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
                >
                  <ExternalLink size={14} aria-hidden="true" />
                  Ouvrir le lien Stripe
                </a>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <div>
                  <label htmlFor={selectId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                    Formule
                  </label>
                  <select
                    id={selectId}
                    value={planKey}
                    onChange={(event) => setPlanKey(event.target.value as PlanKey)}
                    className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                  >
                    {PLAN_DEFINITIONS.map((plan) => (
                      <option key={plan.key} value={plan.key}>
                        {plan.label}
                      </option>
                    ))}
                  </select>
                </div>
                {error && <p className="text-xs text-red-400">{error}</p>}
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={loading}
                  className="w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? "Création…" : "Créer le lien de paiement"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
