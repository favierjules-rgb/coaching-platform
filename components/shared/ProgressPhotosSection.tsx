"use client";

import { useId, useRef, useState } from "react";
import { Archive, Camera, ImageOff, Star, StarOff, Trash2, X } from "lucide-react";

import { Field, SelectField } from "@/components/student/FormFields";
import type { ProgressPhotosGalleryState } from "@/hooks/useProgressPhotosGallery";
import { formatDate } from "@/lib/admin";
import { validateProgressPhotoFile } from "@/lib/supabase/storage-progress-photos";
import type { ProgressPhoto, ProgressPhotoAngle } from "@/types";

const angleOptions: { value: ProgressPhotoAngle; label: string }[] = [
  { value: "face", label: "Face" },
  { value: "profil", label: "Profil" },
  { value: "dos", label: "Dos" },
  { value: "autre", label: "Autre" },
];

const angleLabels: Record<ProgressPhotoAngle, string> = {
  face: "Face",
  profil: "Profil",
  dos: "Dos",
  autre: "Autre",
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ProgressPhotosSectionProps {
  gallery: ProgressPhotosGalleryState;
  defaultWeightKg?: number | null;
}

/**
 * Galerie + upload + sélection avant/après pour les photos de progression
 * (chantier "supabase-progress-photos-before-after-export"), partagée entre
 * /progression (élève) et /admin/eleves/[studentId]/progression (coach) —
 * toute la logique d'écriture vient de `gallery` (useProgressPhotosGallery),
 * ce composant reste présentation + formulaire.
 */
export function ProgressPhotosSection({ gallery, defaultWeightKg = null }: ProgressPhotosSectionProps) {
  const { loading, photos, uploadPhoto, archivePhoto, deletePhoto, selectBefore, selectAfter } = gallery;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [angle, setAngle] = useState<ProgressPhotoAngle>("face");
  const [date, setDate] = useState(today);
  const [weight, setWeight] = useState(defaultWeightKg !== null ? String(defaultWeightKg) : "");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const [viewingPhoto, setViewingPhoto] = useState<ProgressPhoto | null>(null);

  const activePhotos = photos.filter((p) => (p.status ?? "active") === "active");
  const archivedPhotos = photos.filter((p) => p.status === "archived");
  const sorted = activePhotos.slice().sort((a, b) => b.date.localeCompare(a.date));

  function resetForm() {
    setFile(null);
    setPreviewUrl(null);
    setAngle("face");
    setDate(today());
    setWeight(defaultWeightKg !== null ? String(defaultWeightKg) : "");
    setNote("");
    setFormError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function closeUpload() {
    setUploadOpen(false);
    resetForm();
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFormError(null);
    if (!selected) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }
    const validationError = validateProgressPhotoFile(selected);
    if (validationError) {
      setFile(null);
      setPreviewUrl(null);
      setFormError(validationError);
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function handleSubmit() {
    if (!file) return;
    setSubmitting(true);
    setFormError(null);
    const error = await uploadPhoto(file, {
      photoType: angle,
      date,
      weightKg: weight.trim() === "" ? null : Number(weight),
      note,
    });
    setSubmitting(false);
    if (error) {
      setFormError(error);
      return;
    }
    closeUpload();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {activePhotos.length} photo{activePhotos.length > 1 ? "s" : ""}
          {archivedPhotos.length > 0 ? ` · ${archivedPhotos.length} archivée${archivedPhotos.length > 1 ? "s" : ""}` : ""}
        </p>
        <button
          type="button"
          onClick={() => setUploadOpen(true)}
          className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          Ajouter une photo
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-border py-10 text-center">
          <ImageOff size={22} className="text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">Aucune photo de progression pour le moment.</p>
          <button
            type="button"
            onClick={() => setUploadOpen(true)}
            className="border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Ajouter une photo
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {sorted.map((photo) => (
            <PhotoCard
              key={photo.id}
              photo={photo}
              onView={() => setViewingPhoto(photo)}
              onSelectBefore={() => selectBefore(photo.id)}
              onSelectAfter={() => selectAfter(photo.id)}
              onArchive={() => archivePhoto(photo.id)}
              onDelete={() => {
                if (window.confirm("Supprimer définitivement cette photo ?")) {
                  deletePhoto(photo.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {uploadOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Ajouter une photo de progression"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">Ajouter une photo</h3>
              <button
                type="button"
                onClick={closeUpload}
                aria-label="Fermer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div>
                <label htmlFor={fileInputId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Image (JPEG, PNG ou WebP, 10 Mo max)
                </label>
                <input
                  ref={fileInputRef}
                  id={fileInputId}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-muted-foreground file:mr-4 file:border file:border-primary file:bg-transparent file:px-4 file:py-2 file:text-xs file:uppercase file:tracking-widest file:text-primary hover:file:bg-primary hover:file:text-primary-foreground"
                />
              </div>

              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- prévisualisation locale (blob:) avant upload
                <img
                  src={previewUrl}
                  alt="Prévisualisation de la photo sélectionnée"
                  className="aspect-[3/4] w-full max-w-[200px] border border-border object-cover"
                />
              ) : (
                <div className="flex aspect-[3/4] w-full max-w-[200px] flex-col items-center justify-center gap-2 border border-dashed border-border text-muted-foreground">
                  <Camera size={22} aria-hidden="true" />
                  <span className="text-[11px] uppercase tracking-widest">Aucune image</span>
                </div>
              )}

              <SelectField
                label="Angle de la photo"
                value={angle}
                onChange={(value) => setAngle(value as ProgressPhotoAngle)}
                options={angleOptions}
              />
              <Field label="Date" type="date" value={date} onChange={setDate} />
              <Field label="Poids associé (kg, optionnel)" type="number" step="0.1" value={weight} onChange={setWeight} />
              <Field label="Note (optionnel)" value={note} onChange={setNote} placeholder="Ex : bonne évolution ce mois-ci" />

              {formError && <p className="text-xs text-red-400">{formError}</p>}

              <button
                type="button"
                onClick={handleSubmit}
                disabled={!file || submitting}
                className="mt-1 w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
              >
                {submitting ? "Envoi en cours…" : "Enregistrer la photo"}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingPhoto && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo en grand format"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setViewingPhoto(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto border border-border bg-card p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-4">
              <div className="text-sm text-muted-foreground">
                <p className="text-foreground">{formatDate(viewingPhoto.date)}</p>
                <p>{angleLabels[viewingPhoto.photoType ?? "autre"]}</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingPhoto(null)}
                aria-label="Fermer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>
            {viewingPhoto.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase Storage
              <img
                src={viewingPhoto.imageUrl}
                alt={`Photo de progression du ${formatDate(viewingPhoto.date)}`}
                className="w-full object-contain"
              />
            ) : (
              <p className="text-sm text-muted-foreground">Image indisponible.</p>
            )}
            {viewingPhoto.note && <p className="mt-3 text-sm text-muted-foreground">{viewingPhoto.note}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function PhotoCard({
  photo,
  onView,
  onSelectBefore,
  onSelectAfter,
  onArchive,
  onDelete,
}: {
  photo: ProgressPhoto;
  onView: () => void;
  onSelectBefore: () => void;
  onSelectAfter: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative flex flex-col border border-border">
      <div className="absolute left-2 top-2 z-10 flex flex-wrap gap-1">
        {photo.isBeforeCandidate && (
          <span className="border border-primary bg-black/80 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-primary">
            Avant
          </span>
        )}
        {photo.isAfterCandidate && (
          <span className="border border-primary bg-black/80 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-primary">
            Après
          </span>
        )}
      </div>
      {photo.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase Storage
        <img
          src={photo.imageUrl}
          alt={`Photo de progression du ${formatDate(photo.date)} (${angleLabels[photo.photoType ?? "autre"]})`}
          className="aspect-[3/4] w-full border-b border-border object-cover"
        />
      ) : (
        <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 border-b border-border bg-gradient-to-br from-zinc-900 to-black text-muted-foreground">
          <Camera size={22} aria-hidden="true" />
        </div>
      )}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatDate(photo.date)}</span>
          {typeof photo.weightKg === "number" && Number.isFinite(photo.weightKg) && (
            <span className="text-foreground">{photo.weightKg} kg</span>
          )}
        </div>
        {photo.note && <p className="text-xs leading-relaxed text-muted-foreground">{photo.note}</p>}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={onView}
            className="border border-border px-2 py-1 text-[10px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            Voir
          </button>
          <button
            type="button"
            onClick={onSelectBefore}
            aria-pressed={photo.isBeforeCandidate ?? false}
            className={`flex items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-widest transition-colors ${
              photo.isBeforeCandidate
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {photo.isBeforeCandidate ? <Star size={11} aria-hidden="true" /> : <StarOff size={11} aria-hidden="true" />}
            Avant
          </button>
          <button
            type="button"
            onClick={onSelectAfter}
            aria-pressed={photo.isAfterCandidate ?? false}
            className={`flex items-center gap-1 border px-2 py-1 text-[10px] uppercase tracking-widest transition-colors ${
              photo.isAfterCandidate
                ? "border-primary text-primary"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            {photo.isAfterCandidate ? <Star size={11} aria-hidden="true" /> : <StarOff size={11} aria-hidden="true" />}
            Après
          </button>
          <button
            type="button"
            onClick={onArchive}
            aria-label="Archiver cette photo"
            className="border border-border p-1.5 text-muted-foreground transition-colors hover:border-amber-500/50 hover:text-amber-400"
          >
            <Archive size={12} />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Supprimer cette photo"
            className="border border-border p-1.5 text-muted-foreground transition-colors hover:border-red-500/50 hover:text-red-400"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
