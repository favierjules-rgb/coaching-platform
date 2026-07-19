"use client";

import { useState } from "react";
import { CheckCircle, Plus, X } from "lucide-react";

import { Field, SelectField } from "@/components/student/FormFields";
import { bodyMeasurementLabels } from "@/lib/profile";
import type { BodyMeasurement, BodyMeasurementType } from "@/types";

const measurementOrder: BodyMeasurementType[] = [
  "poids",
  "cou",
  "epaules",
  "poitrine",
  "taille",
  "nombril",
  "hanches",
  "bras-droit",
  "bras-gauche",
  "avant-bras-droit",
  "avant-bras-gauche",
  "cuisse-droite",
  "cuisse-gauche",
  "mollet-droit",
  "mollet-gauche",
];

const customUnitOptions = [
  { value: "cm", label: "cm" },
  { value: "kg", label: "kg" },
  { value: "autre", label: "Autre" },
];

export interface CustomMeasurementInput {
  name: string;
  value: number;
  unit: string;
  note: string;
}

interface UpdateMeasurementsModalProps {
  measurements: BodyMeasurement[];
  onSave: (
    values: Partial<Record<BodyMeasurementType, number>>,
    date: string,
    note: string,
    custom: CustomMeasurementInput | null,
  ) => void;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function UpdateMeasurementsModal({
  measurements,
  onSave,
}: UpdateMeasurementsModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [showCustom, setShowCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customValue, setCustomValue] = useState("");
  const [customUnit, setCustomUnit] = useState("cm");
  const [customNote, setCustomNote] = useState("");

  const measurementByType = new Map((Array.isArray(measurements) ? measurements : []).map((m) => [m.type, m]));

  function resetForm() {
    setValues({});
    setDate(today());
    setNote("");
    setShowCustom(false);
    setCustomName("");
    setCustomValue("");
    setCustomUnit("cm");
    setCustomNote("");
  }

  function close() {
    setOpen(false);
    setSubmitted(false);
    resetForm();
  }

  const hasStandardInput = Object.values(values).some((v) => v.trim() !== "");
  const hasCustomInput = customName.trim() !== "" && customValue.trim() !== "";
  const canSubmit = hasStandardInput || hasCustomInput;

  function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    const parsed: Partial<Record<BodyMeasurementType, number>> = {};
    for (const type of measurementOrder) {
      const raw = values[type];
      if (raw && raw.trim() !== "") {
        parsed[type] = Number(raw);
      }
    }
    const custom = hasCustomInput
      ? {
          name: customName.trim(),
          value: Number(customValue),
          unit: customUnit,
          note: customNote,
        }
      : null;

    onSave(parsed, date, note, custom);
    setSubmitted(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Mettre à jour mes mensurations
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Mettre à jour mes mensurations"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                Mettre à jour mes mensurations
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
                Mensurations enregistrées. Ton coach pourra les consulter.
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Renseigne uniquement les mesures que tu as prises
                  aujourd&apos;hui. Cette action est une démonstration :
                  aucune donnée n&apos;est encore enregistrée.
                </p>

                <Field label="Date de la mesure" type="date" value={date} onChange={setDate} />

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {measurementOrder.map((type) => {
                    const current = measurementByType.get(type);
                    const unit = current?.unit ?? (type === "poids" ? "kg" : "cm");
                    return (
                      <Field
                        key={type}
                        label={`${bodyMeasurementLabels[type]} (${unit})`}
                        type="number"
                        step="0.1"
                        value={values[type] ?? ""}
                        onChange={(v) => setValues((prev) => ({ ...prev, [type]: v }))}
                        placeholder={
                          current ? `Actuel : ${current.currentValue}` : undefined
                        }
                      />
                    );
                  })}
                </div>

                <Field
                  label="Note (optionnel)"
                  value={note}
                  onChange={setNote}
                  placeholder="Ex : mesures prises le matin à jeun"
                />

                <div className="border-t border-border pt-4">
                  {!showCustom ? (
                    <button
                      type="button"
                      onClick={() => setShowCustom(true)}
                      className="flex items-center gap-2 text-xs uppercase tracking-widest text-primary transition-colors hover:text-red-400"
                    >
                      <Plus size={14} />
                      Ajouter une mesure personnalisée
                    </button>
                  ) : (
                    <div className="flex flex-col gap-4">
                      <span className="text-xs uppercase tracking-wide text-muted-foreground">
                        Mesure personnalisée
                      </span>
                      <Field
                        label="Nom de la mesure"
                        value={customName}
                        onChange={setCustomName}
                        placeholder="Ex : Tour de cheville"
                      />
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field
                          label="Valeur"
                          type="number"
                          step="0.1"
                          value={customValue}
                          onChange={setCustomValue}
                        />
                        <SelectField
                          label="Unité"
                          value={customUnit}
                          onChange={setCustomUnit}
                          options={customUnitOptions}
                        />
                      </div>
                      <Field
                        label="Note (optionnel)"
                        value={customNote}
                        onChange={setCustomNote}
                      />
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="mt-1 w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                >
                  Enregistrer les mensurations
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
