"use client";

import { useState } from "react";
import { CheckCircle, X } from "lucide-react";

import { Field } from "@/components/student/FormFields";

interface UpdateWeightModalProps {
  currentWeightKg: number;
  targetWeightKg: number;
  onUpdateWeight: (weightKg: number) => void;
  onUpdateTarget: (targetKg: number) => void;
}

export function UpdateWeightModal({
  currentWeightKg,
  targetWeightKg,
  onUpdateWeight,
  onUpdateTarget,
}: UpdateWeightModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [weight, setWeight] = useState("");
  const [target, setTarget] = useState("");

  function resetForm() {
    setWeight("");
    setTarget("");
  }

  function close() {
    setOpen(false);
    setSubmitted(false);
    resetForm();
  }

  const canSubmit = weight.trim() !== "" || target.trim() !== "";

  function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    if (weight.trim() !== "") {
      onUpdateWeight(Number(weight));
    }
    if (target.trim() !== "") {
      onUpdateTarget(Number(target));
    }
    setSubmitted(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
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
                  Renseigne ton poids du jour et/ou un nouvel objectif.
                  Cette action est une démonstration : les données sont
                  conservées en local (localStorage).
                </p>
                <Field
                  label="Nouveau poids (kg)"
                  type="number"
                  step="0.1"
                  value={weight}
                  onChange={setWeight}
                  placeholder={`Actuel : ${currentWeightKg}`}
                />
                <Field
                  label="Nouvel objectif de poids (kg)"
                  type="number"
                  step="0.1"
                  value={target}
                  onChange={setTarget}
                  placeholder={`Actuel : ${targetWeightKg}`}
                />
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="mt-1 w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                >
                  Enregistrer
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
