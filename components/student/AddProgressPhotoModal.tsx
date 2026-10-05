"use client";

import { useId, useRef, useState } from "react";
import { CheckCircle, ImagePlus, X } from "lucide-react";

import { Field, SelectField } from "@/components/student/FormFields";
import { validateProgressPhotoFile } from "@/lib/supabase/storage-progress-photos";
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

/** Les métadonnées que le formulaire transporte, quel que soit le mode. */
export interface AjoutPhotoMeta {
  type: ProgressPhotoType;
  date: string;
  weightKg: number | null;
  note: string;
}

interface AddProgressPhotoModalProps {
  studentId: string;
  defaultWeightKg: number;
  /** Mode DÉMONSTRATION : la photo est rendue à l'appelant, dataUrl comprise. */
  onAdd: (photo: ProgressPhoto) => void;
  /**
   * Mode STORAGE (P3A) : téléverse le fichier et rend un message d'erreur, ou
   * `null` en cas de succès. Fourni dès qu'un élève Supabase réel est
   * identifié — par `ProfilPageContent` et par la fiche coach.
   *
   * ⚠️ SA PRÉSENCE DÉCIDE DU MODE, et `onAdd` n'est alors jamais appelé.
   */
  onUpload?: (file: File, meta: AjoutPhotoMeta) => Promise<string | null>;
}

/**
 * AJOUT D'UNE PHOTO DE PROGRESSION — DEUX MODES, JAMAIS DE MÉLANGE (P3A).
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT CORRIGÉ
 * ════════════════════════════════════════════════════════════════════════
 * Ce formulaire encodait l'image en dataUrl (`FileReader.readAsDataURL`) et
 * la faisait écrire telle quelle dans `progress_photos.image_url`. Mesuré en
 * production le 05/10/2026 : 8 lignes sur 10 sont des dataUrl, 24 Mo pour un
 * seul élève, la dernière écrite le 12/09/2026. Ce n'était pas un résidu
 * historique : c'était le chemin le plus récemment utilisé, et le seul des
 * deux à n'avoir aucune validation de format ni de taille.
 *
 * ⚠️ MODE STORAGE (`onUpload` fourni) — le fichier est VALIDÉ puis
 * TÉLÉVERSÉ. `validateProgressPhotoFile` est celle qu'utilise déjà la
 * galerie `/progression` : jpeg/png/webp, 10 Mo. La prévisualisation passe
 * par `URL.createObjectURL`, comme là-bas. **Aucune dataUrl n'est produite.**
 *
 * ⚠️ MODE DÉMONSTRATION (`onUpload` absent) — inchangé, et il DOIT le rester.
 * La dataUrl n'y est pas un pis-aller : c'est la seule forme qui survive à un
 * rechargement depuis `localStorage`, où une URL `blob:` serait morte. Ce
 * mode n'atteint jamais Supabase — `ProfilPageContent` et la fiche coach
 * choisissent alors `mockProfile.addPhoto` / `updateStudent`.
 *
 * ⚠️ LA GARDE DE FOND N'EST PAS ICI. `addProgressPhotoSupabase`
 * (lib/supabase/students.ts) REFUSE désormais un `image_url` commençant par
 * `data:`. Même si un appelant futur oubliait `onUpload`, aucune base64 ne
 * pourrait plus atteindre la base. Ce composant choisit le bon chemin ; la
 * couche d'accès, elle, l'impose.
 */
export function AddProgressPhotoModal({
  studentId,
  defaultWeightKg,
  onAdd,
  onUpload,
}: AddProgressPhotoModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [type, setType] = useState<ProgressPhotoType>("mensuelle");
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState(String(defaultWeightKg));
  const [note, setNote] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  /** Le mode est décidé par la présence du téléverseur, nulle part ailleurs. */
  const modeStorage = typeof onUpload === "function";

  function resetForm() {
    setPreviewUrl(null);
    setFile(null);
    setFormError(null);
    setSubmitting(false);
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

  /**
   * Prévisualisation de la DÉMONSTRATION, et d'elle seule.
   *
   * ⚠️ `readAsDataURL` NE VIT PLUS QUE DANS CETTE FONCTION, et elle n'est
   * appelée que si `onUpload` est absent. La dataUrl est ici le FORMAT DE
   * STOCKAGE du mode démonstration (localStorage), pas un aperçu : une URL
   * `blob:` ne survivrait pas au rechargement. Sous Supabase, cette fonction
   * n'est jamais atteinte.
   */
  function lireApercuDemonstration(selected: File) {
    const reader = new FileReader();
    reader.onload = () => {
      setPreviewUrl(typeof reader.result === "string" ? reader.result : null);
    };
    reader.readAsDataURL(selected);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFormError(null);
    if (!selected) {
      setPreviewUrl(null);
      setFile(null);
      return;
    }

    if (modeStorage) {
      // ⚠️ VALIDATION AVANT TOUT — jpeg/png/webp, 10 Mo. La même fonction que
      // la galerie /progression : une seconde règle de format finirait par
      // diverger de celle du bucket.
      const validationError = validateProgressPhotoFile(selected);
      if (validationError) {
        setPreviewUrl(null);
        setFile(null);
        setFormError(validationError);
        return;
      }
      setFile(selected);
      setPreviewUrl(URL.createObjectURL(selected));
      return;
    }

    setFile(selected);
    lireApercuDemonstration(selected);
  }

  async function handleSubmit() {
    const weightKg = weight.trim() === "" ? null : Number(weight);

    if (modeStorage) {
      if (!file || !onUpload) return;
      setSubmitting(true);
      setFormError(null);
      const error = await onUpload(file, { type, date, weightKg, note });
      setSubmitting(false);
      if (error) {
        setFormError(error);
        return;
      }
      setSubmitted(true);
      return;
    }

    if (!previewUrl) {
      return;
    }
    const photo: ProgressPhoto = {
      id: `photo-${Date.now()}`,
      studentId,
      type,
      date,
      weightKg,
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
        className="pressable inline-flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
          <div className="animate-fade-in flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
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

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {submitted ? (
                <div className="animate-fade-in flex items-center gap-3 rounded-control border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
                  <CheckCircle size={18} className="flex-shrink-0" />
                  Photo ajoutée à ta galerie de progression.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {modeStorage
                      ? "Choisis une image depuis ton ordinateur ou ton téléphone. Formats acceptés : JPEG, PNG ou WebP, 10 Mo maximum."
                      : "Choisis une image depuis ton ordinateur ou ton téléphone. Cette action est une démonstration : la photo reste affichée localement, aucun upload n'est effectué."}
                  </p>

                  {formError && (
                    <p className="text-sm text-destructive" role="alert">
                      {formError}
                    </p>
                  )}

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
                      accept={modeStorage ? "image/jpeg,image/png,image/webp" : "image/*"}
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
                    disabled={submitting || (modeStorage ? !file : !previewUrl)}
                    className="pressable mt-1 min-h-[44px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                  >
                    {submitting ? "Envoi…" : "Enregistrer la photo"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
