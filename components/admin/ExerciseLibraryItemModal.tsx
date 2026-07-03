"use client";

import { useState } from "react";
import { CheckCircle, Pencil, Plus } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { exerciseCategoryLabels, exerciseEquipmentLabels, exerciseLevelLabels } from "@/lib/admin";
import type { ExerciseCategory, ExerciseEquipment, ExerciseLevel, ExerciseLibraryItem } from "@/types";

const categoryOptions = Object.entries(exerciseCategoryLabels).map(([value, label]) => ({ value, label }));
const equipmentOptions = Object.entries(exerciseEquipmentLabels).map(([value, label]) => ({ value, label }));
const levelOptions = Object.entries(exerciseLevelLabels).map(([value, label]) => ({ value, label }));

function formFromItem(item: Partial<ExerciseLibraryItem>) {
  return {
    name: item.name ?? "",
    muscleGroup: item.muscleGroup ?? "",
    category: item.category ?? "autre",
    equipment: item.equipment ?? "autre",
    level: item.level ?? "débutant",
    videoUrl: item.videoUrl ?? "",
    technicalNote: item.technicalNote ?? "",
    coachInstructions: item.coachInstructions ?? "",
    tags: item.tags?.join(", ") ?? "",
  };
}

interface ExerciseLibraryItemModalProps {
  item?: ExerciseLibraryItem;
  onSave: (data: Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">) => void;
}

export function ExerciseLibraryItemModal({ item, onSave }: ExerciseLibraryItemModalProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(() => formFromItem(item ?? {}));

  function setField<K extends keyof ReturnType<typeof formFromItem>>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setSaved(false);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    onSave({
      name: form.name.trim(),
      muscleGroup: form.muscleGroup.trim(),
      category: form.category as ExerciseCategory,
      equipment: form.equipment as ExerciseEquipment,
      level: form.level as ExerciseLevel,
      videoUrl: form.videoUrl.trim(),
      technicalNote: form.technicalNote.trim(),
      coachInstructions: form.coachInstructions.trim(),
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
    });
    setSaved(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(formFromItem(item ?? {}));
          setOpen(true);
        }}
        className={
          item
            ? "flex items-center gap-1.5 border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            : "flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
        }
      >
        {item ? <Pencil size={12} /> : <Plus size={14} />}
        {item ? "Modifier" : "Créer un exercice"}
      </button>

      {open && (
        <Modal title={item ? "Modifier l'exercice" : "Créer un exercice"} onClose={close} maxWidth="max-w-lg">
          {saved ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Exercice enregistré dans la banque.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Nom de l'exercice" value={form.name} onChange={(v) => setField("name", v)} />
              <Field label="Groupe musculaire" value={form.muscleGroup} onChange={(v) => setField("muscleGroup", v)} />
              <div className="grid grid-cols-3 gap-4">
                <SelectField label="Catégorie" value={form.category} onChange={(v) => setField("category", v as ExerciseCategory)} options={categoryOptions} />
                <SelectField label="Matériel" value={form.equipment} onChange={(v) => setField("equipment", v as ExerciseEquipment)} options={equipmentOptions} />
                <SelectField label="Niveau" value={form.level} onChange={(v) => setField("level", v as ExerciseLevel)} options={levelOptions} />
              </div>
              <Field label="Lien vidéo" value={form.videoUrl} onChange={(v) => setField("videoUrl", v)} />
              <TextareaField label="Note technique" value={form.technicalNote} onChange={(v) => setField("technicalNote", v)} rows={2} />
              <TextareaField label="Consignes coach" value={form.coachInstructions} onChange={(v) => setField("coachInstructions", v)} rows={2} />
              <Field label="Tags (séparés par des virgules)" value={form.tags} onChange={(v) => setField("tags", v)} />
              <PrimaryButton onClick={handleSave}>Enregistrer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
