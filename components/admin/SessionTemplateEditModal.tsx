"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import type { SessionTemplate, SessionType } from "@/types";

const sessionTypeOptions: { value: SessionType; label: string }[] = [
  { value: "strength", label: "Musculation" },
  { value: "cardio", label: "Cardio" },
  { value: "mixed", label: "Mixte (muscu + cardio)" },
];

/**
 * Édition des métadonnées d'un modèle de la banque de séances (nom,
 * description, type, groupe musculaire, durée) — pas de son contenu
 * (exercices/blocs cardio), qui reste construit uniquement depuis le
 * builder via "Enregistrer comme modèle" (voir ProgramBuilder.tsx). Même
 * principe que ExerciseLibraryItemModal mais sans édition de contenu, le
 * modèle de séance étant un snapshot complexe (liste d'exercices + blocs
 * cardio) plutôt qu'une poignée de champs simples.
 */
export function SessionTemplateEditModal({
  template,
  onSave,
}: {
  template: SessionTemplate;
  onSave: (partial: {
    name: string;
    description: string;
    sessionType: SessionType;
    muscleGroup: string;
    durationMinutes: number | null;
  }) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [sessionType, setSessionType] = useState<SessionType>(template.sessionType);
  const [muscleGroup, setMuscleGroup] = useState(template.muscleGroup);
  const [durationMinutes, setDurationMinutes] = useState(template.durationMinutes ? String(template.durationMinutes) : "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) return;
    setSaving(true);
    await onSave({
      name: name.trim(),
      description,
      sessionType,
      muscleGroup,
      durationMinutes: durationMinutes ? Number(durationMinutes) || null : null,
    });
    setSaving(false);
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <Pencil size={12} />
        Modifier
      </button>
      {open && (
        <Modal title="Modifier le modèle de séance" onClose={() => setOpen(false)}>
          <div className="flex flex-col gap-4">
            <Field label="Nom du modèle" value={name} onChange={setName} required />
            <TextareaField label="Description" value={description} onChange={setDescription} rows={2} />
            <SelectField label="Type de séance" value={sessionType} onChange={(v) => setSessionType(v as SessionType)} options={sessionTypeOptions} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Groupe musculaire" value={muscleGroup} onChange={setMuscleGroup} />
              <Field label="Durée (min)" type="number" value={durationMinutes} onChange={setDurationMinutes} />
            </div>
            <p className="text-xs text-muted-foreground">
              Le contenu (exercices, blocs cardio) ne se modifie pas ici : reconstruis le modèle depuis le builder
              (« Enregistrer comme modèle ») si son contenu doit changer.
            </p>
            <PrimaryButton onClick={handleSubmit} disabled={saving || !name.trim()}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}
