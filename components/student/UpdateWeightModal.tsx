"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, X } from "lucide-react";

import { Field } from "@/components/student/FormFields";

interface UpdateWeightModalProps {
  currentWeightKg: number;
  targetWeightKg: number;
  onUpdateWeight: (weightKg: number) => Promise<boolean> | void;
  onUpdateTarget: (targetKg: number) => Promise<boolean> | void;
}

export function UpdateWeightModal({
  currentWeightKg,
  targetWeightKg,
  onUpdateWeight,
  onUpdateTarget,
}: UpdateWeightModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [weight, setWeight] = useState(String(currentWeightKg));
  const [target, setTarget] = useState(String(targetWeightKg));

  function close() {
    setOpen(false);
    setSubmitted(false);
    setError(false);
  }

  const canSubmit = weight.trim() !== "" || target.trim() !== "";

  async function handleSubmit() {
    if (!canSubmit || saving) {
      return;
    }
    setSaving(true);
    setError(false);
    let success = true;
    if (weight.trim() !== "" && !Number.isNaN(Number(weight))) {
      const result = await onUpdateWeight(Number(weight));
      if (result === false) success = false;
    }
    if (target.trim() !== "" && !Number.isNaN(Number(target))) {
      const result = await onUpdateTarget(Number(target));
      if (result === false) success = false;
    }
    setSaving(false);
    if (success) {
      setSubmitted(true);
    } else {
      setError(true);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          // Pré-remplit avec les valeurs actuelles à chaque ouverture (et
          // non juste au montage) : un placeholder vide se lit facilement
          // comme "déjà rempli" et amène à valider sans rien changer.
          setWeight(String(currentWeightKg));
          setTarget(String(targetWeightKg));
          setOpen(true);
        }}
        className="pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Mettre à jour mon poids
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mettre à jour mon poids"
          className="modal-overlay-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="modal-content-scale-in w-full max-w-md rounded-card border border-border bg-card p-6 shadow-soft">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                Mettre à jour mon poids
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Fermer"
                className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={18} />
              </button>
            </div>

            {submitted ? (
              <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
                <CheckCircle size={18} className="flex-shrink-0" />
                Enregistré. La carte évolution du poids est à jour.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Ces champs sont pré-remplis avec tes valeurs actuelles :
                  modifie uniquement ce que tu veux changer.
                </p>
                {error && (
                  <div className="flex items-center gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    <AlertTriangle size={18} className="flex-shrink-0" />
                    Échec de l&apos;enregistrement. Réessaie.
                  </div>
                )}
                <Field
                  label="Poids actuel (kg)"
                  type="number"
                  step="0.1"
                  value={weight}
                  onChange={setWeight}
                />
                <Field
                  label="Objectif de poids (kg)"
                  type="number"
                  step="0.1"
                  value={target}
                  onChange={setTarget}
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit || saving}
                  className="pressable mt-1 min-h-[44px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
