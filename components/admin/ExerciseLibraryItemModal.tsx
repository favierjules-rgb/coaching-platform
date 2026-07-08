"use client";

import { useState } from "react";
import { CheckCircle, Pencil, Plus } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { exerciseCategoryLabels, exerciseEquipmentLabels, exerciseLevelLabels } from "@/lib/admin";
import { muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type {
  ExerciseCategory,
  ExerciseEquipment,
  ExerciseLevel,
  ExerciseLibraryItem,
  ExerciseLibraryStatus,
  ExerciseType,
  MuscleGroup,
} from "@/types";

const categoryOptions = Object.entries(exerciseCategoryLabels).map(([value, label]) => ({ value, label }));
const equipmentOptions = Object.entries(exerciseEquipmentLabels).map(([value, label]) => ({ value, label }));
const levelOptions = Object.entries(exerciseLevelLabels).map(([value, label]) => ({ value, label }));
const muscleGroupOptions = muscleGroupOrder.map((group) => ({ value: group, label: muscleGroupLabels[group] }));
const statusOptions: { value: ExerciseLibraryStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "archived", label: "Archivée" },
];

function formFromItem(item: Partial<ExerciseLibraryItem>) {
  return {
    name: item.name ?? "",
    description: item.description ?? "",
    muscleGroup: item.muscleGroup ?? "autre",
    secondaryMuscles: item.secondaryMuscles ?? [],
    category: item.category ?? "Technique",
    exerciseType: item.exerciseType ?? "Technique",
    equipment: item.equipment ?? "Aucun",
    level: item.level ?? "débutant",
    videoUrl: item.videoUrl ?? "",
    alternativeVideoUrl: item.alternativeVideoUrl ?? "",
    technicalNote: item.technicalNote ?? "",
    commonMistakes: item.commonMistakes ?? "",
    coachInstructions: item.coachInstructions ?? "",
    defaultTempo: item.defaultTempo ?? "",
    defaultRestSeconds: item.defaultRestSeconds != null ? String(item.defaultRestSeconds) : "",
    tags: item.tags?.join(", ") ?? "",
    status: item.status ?? "active",
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

  function toggleSecondaryMuscle(group: MuscleGroup) {
    setForm((prev) => ({
      ...prev,
      secondaryMuscles: prev.secondaryMuscles.includes(group)
        ? prev.secondaryMuscles.filter((g) => g !== group)
        : [...prev.secondaryMuscles, group],
    }));
  }

  function close() {
    setOpen(false);
    setSaved(false);
  }

  function handleSave() {
    if (!form.name.trim()) return;
    onSave({
      name: form.name.trim(),
      description: form.description.trim(),
      muscleGroup: form.muscleGroup as MuscleGroup,
      secondaryMuscles: form.secondaryMuscles,
      category: form.category as ExerciseCategory,
      exerciseType: form.exerciseType as ExerciseType,
      equipment: form.equipment as ExerciseEquipment,
      level: form.level as ExerciseLevel,
      videoUrl: form.videoUrl.trim(),
      alternativeVideoUrl: form.alternativeVideoUrl.trim(),
      technicalNote: form.technicalNote.trim(),
      commonMistakes: form.commonMistakes.trim(),
      coachInstructions: form.coachInstructions.trim(),
      defaultTempo: form.defaultTempo.trim(),
      defaultRestSeconds: form.defaultRestSeconds.trim() ? Number(form.defaultRestSeconds) || null : null,
      tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      status: form.status as ExerciseLibraryStatus,
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
        <Modal title={item ? "Modifier l'exercice" : "Créer un exercice"} onClose={close} maxWidth="max-w-2xl">
          {saved ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Exercice enregistré dans la banque.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <Field label="Nom de l'exercice" value={form.name} onChange={(v) => setField("name", v)} />
              <TextareaField label="Description" value={form.description} onChange={(v) => setField("description", v)} rows={2} />
              <SelectField
                label="Groupe musculaire principal"
                value={form.muscleGroup}
                onChange={(v) => setField("muscleGroup", v as MuscleGroup)}
                options={muscleGroupOptions}
              />
              <div>
                <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Muscles secondaires
                </span>
                <div className="flex flex-wrap gap-2">
                  {muscleGroupOrder.map((group) => (
                    <button
                      key={group}
                      type="button"
                      onClick={() => toggleSecondaryMuscle(group)}
                      className={`border px-2.5 py-1 text-[11px] uppercase tracking-wide transition-colors ${
                        form.secondaryMuscles.includes(group)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary hover:text-primary"
                      }`}
                    >
                      {muscleGroupLabels[group]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SelectField label="Catégorie" value={form.category} onChange={(v) => setField("category", v as ExerciseCategory)} options={categoryOptions} />
                <SelectField label="Type" value={form.exerciseType} onChange={(v) => setField("exerciseType", v as ExerciseType)} options={categoryOptions} />
                <SelectField label="Matériel" value={form.equipment} onChange={(v) => setField("equipment", v as ExerciseEquipment)} options={equipmentOptions} />
                <SelectField label="Niveau" value={form.level} onChange={(v) => setField("level", v as ExerciseLevel)} options={levelOptions} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Lien vidéo démo" value={form.videoUrl} onChange={(v) => setField("videoUrl", v)} />
                <Field label="Lien vidéo alternative" value={form.alternativeVideoUrl} onChange={(v) => setField("alternativeVideoUrl", v)} />
              </div>
              <TextareaField label="Consignes techniques" value={form.technicalNote} onChange={(v) => setField("technicalNote", v)} rows={2} />
              <TextareaField label="Erreurs fréquentes" value={form.commonMistakes} onChange={(v) => setField("commonMistakes", v)} rows={2} />
              <TextareaField label="Note interne coach" value={form.coachInstructions} onChange={(v) => setField("coachInstructions", v)} rows={2} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Tempo recommandé (optionnel)" value={form.defaultTempo} onChange={(v) => setField("defaultTempo", v)} placeholder="2-0-1-0" />
                <Field label="Repos recommandé en s (optionnel)" type="number" value={form.defaultRestSeconds} onChange={(v) => setField("defaultRestSeconds", v)} />
                <SelectField label="Statut" value={form.status} onChange={(v) => setField("status", v as ExerciseLibraryStatus)} options={statusOptions} />
              </div>
              <Field label="Tags (séparés par des virgules)" value={form.tags} onChange={(v) => setField("tags", v)} />
              <PrimaryButton onClick={handleSave}>Enregistrer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
