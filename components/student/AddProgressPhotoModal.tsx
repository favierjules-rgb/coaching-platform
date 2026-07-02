"use client";

import { useId, useRef, useState } from "react";
import { CheckCircle, ImagePlus, X } from "lucide-react";

import { Field, SelectField } from "@/components/student/FormFields";
import type { ProgressPhoto, ProgressPhotoType } from "@/types";

const photoTypeOptions: { value: ProgressPhotoType; label: string }[] = [
  { value: "mensuelle", label: "Progression mensuelle" },
  { value: "avant", label: "Avant" },
  { value: "actuelle", label: "Actuelle" },
  { value: "objectif", label: "Objectif / Après" },
];

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface AddProgressPhotoModalProps {
  studentId: string;
  defaultWeightKg: number;
  onAdd: (photo: ProgressPhoto) => void;
}

/**
 * Ouvre réellement la bibliothèque de fichiers de l'appareil (input file
 * natif) et prévisualise l'image choisie via URL.createObjectURL. Aucun
 * upload n'est effectué : imageUrl reste une URL locale tant que Supabase
 * Storage n'est pas connecté (storagePath préparé pour ça, cf. types).
 */
export function AddProgressPhotoModal({
  studentId,
  defaultWeightKg,
  onAdd,
}: AddProgressPhotoModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [type, setType] = useState<ProgressPhotoType>("mensuelle");
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState(String(defaultWeightKg));
  const [note, setNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  function resetForm() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setType("mensuelle");
    setDate(today());
    setWeight(String(defaultWeightKg));
    setNote("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function close() {
    setOpen(false);
    setSubmitted(false);
    resetForm();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(selected ? URL.createObjectURL(selected) : null);
  }

  function handleSubmit() {
    if (!previewUrl) {
      return;
    }
    const photo: ProgressPhoto = {
      id: `photo-${Date.now()}`,
      studentId,
      type,
      date,
      weightKg: weight.trim() === "" ? null : Number(weight),
      note,
      imageUrl: previewUrl,
      storagePath: null,
      pending: false,
    };
    onAdd(photo);
    setSubmitted(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Ajouter une photo
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ajouter une photo"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                Ajouter une photo
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
                Photo ajoutée à ta galerie de progression.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Choisis une image depuis ton ordinateur ou ton téléphone.
                  Cette action est une démonstration : la photo reste
                  affichée localement, aucun upload n&apos;est encore
                  effectué.
                </p>

                <div>
                  <label
                    htmlFor={fileInputId}
                    className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
                  >
                    Image
                  </label>
                  <input
                    ref={fileInputRef}
                    id={fileInputId}
                    type="file"
                    accept="image/*"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-muted-foreground file:mr-4 file:border file:border-primary file:bg-transparent file:px-4 file:py-2 file:text-xs file:uppercase file:tracking-widest file:text-primary hover:file:bg-primary hover:file:text-primary-foreground"
                  />
                </div>

                {previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- image locale (blob:) non compatible avec next/image
                  <img
                    src={previewUrl}
                    alt="Prévisualisation de la photo sélectionnée"
                    className="aspect-[3/4] w-full max-w-[200px] border border-border object-cover"
                  />
                ) : (
                  <div className="flex aspect-[3/4] w-full max-w-[200px] flex-col items-center justify-center gap-2 border border-dashed border-border text-muted-foreground">
                    <ImagePlus size={22} />
                    <span className="text-[11px] uppercase tracking-widest">
                      Aucune image
                    </span>
                  </div>
                )}

                <SelectField
                  label="Type de photo"
                  value={type}
                  onChange={(value) => setType(value as ProgressPhotoType)}
                  options={photoTypeOptions}
                />
                <Field label="Date" type="date" value={date} onChange={setDate} />
                <Field
                  label="Poids associé (kg)"
                  type="number"
                  step="0.1"
                  value={weight}
                  onChange={setWeight}
                />
                <Field
                  label="Note (optionnel)"
                  value={note}
                  onChange={setNote}
                  placeholder="Ex : bonne évolution ce mois-ci"
                />

                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!previewUrl}
                  className="mt-1 w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                >
                  Enregistrer la photo
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
