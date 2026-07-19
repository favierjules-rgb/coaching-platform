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
        className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Mettre à jour mon poids
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mettre à jour mon poids"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                Mettre à jour mon poids
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Fermer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {submitted ? (
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
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
                  <div className="flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
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
                  className="mt-1 w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
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
