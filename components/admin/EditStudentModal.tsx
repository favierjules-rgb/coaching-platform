"use client";

import { useState } from "react";
import { AlertTriangle, Pencil } from "lucide-react";

import { Field, SelectField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import type { AdminStudent } from "@/types";

const levelOptions = [
  { value: "Débutant", label: "Débutant" },
  { value: "Intermédiaire", label: "Intermédiaire" },
  { value: "Avancé", label: "Avancé" },
];

const locationOptions = [
  { value: "Salle de sport", label: "Salle de sport" },
  { value: "Domicile", label: "Domicile" },
  { value: "Mixte", label: "Mixte" },
];

function formFromStudent(student: AdminStudent) {
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    email: student.email,
    phone: student.phone,
    age: String(student.age),
    heightCm: String(student.heightCm),
    currentWeightKg: String(student.currentWeightKg),
    targetWeightKg: String(student.targetWeightKg),
    goal: student.goal,
    level: student.level,
    trainingFrequencyPerWeek: String(student.trainingFrequencyPerWeek),
    trainingLocation: student.trainingLocation,
  };
}

export function EditStudentModal({
  student,
  onSave,
}: {
  student: AdminStudent;
  onSave: (partial: Partial<AdminStudent>) => Promise<boolean> | void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [form, setForm] = useState(() => formFromStudent(student));

  function setField(key: keyof ReturnType<typeof formFromStudent>, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setError(false);
  }

  async function handleSubmit() {
    if (saving) return;
    setSaving(true);
    setError(false);
    const result = await onSave({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      age: Number(form.age) || student.age,
      heightCm: Number(form.heightCm) || student.heightCm,
      currentWeightKg: Number(form.currentWeightKg) || student.currentWeightKg,
      targetWeightKg: Number(form.targetWeightKg) || student.targetWeightKg,
      goal: form.goal.trim(),
      level: form.level,
      trainingFrequencyPerWeek: Number(form.trainingFrequencyPerWeek) || student.trainingFrequencyPerWeek,
      trainingLocation: form.trainingLocation,
    });
    setSaving(false);
    if (result === false) {
      setError(true);
      return;
    }
    // Ferme uniquement en cas de succès confirmé (students + student_profiles) —
    // en cas d'échec la modale reste ouverte avec le message d'erreur pour
    // que l'utilisateur puisse réessayer sans ressaisir le formulaire.
    close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(formFromStudent(student));
          setOpen(true);
        }}
        className="flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <Pencil size={13} />
        Modifier le profil
      </button>

      {open && (
        <Modal title="Modifier le profil" onClose={close} maxWidth="max-w-lg">
          <div className="flex flex-col gap-4">
            {error && (
              <div className="flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                <AlertTriangle size={18} className="flex-shrink-0" />
                Échec de l&apos;enregistrement. Réessaie.
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="Prénom" value={form.firstName} onChange={(v) => setField("firstName", v)} />
              <Field label="Nom" value={form.lastName} onChange={(v) => setField("lastName", v)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" value={form.email} onChange={(v) => setField("email", v)} />
              <Field label="Téléphone" value={form.phone} onChange={(v) => setField("phone", v)} />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Âge" type="number" value={form.age} onChange={(v) => setField("age", v)} />
              <Field label="Taille (cm)" type="number" value={form.heightCm} onChange={(v) => setField("heightCm", v)} />
              <Field
                label="Poids actuel (kg)"
                type="number"
                value={form.currentWeightKg}
                onChange={(v) => setField("currentWeightKg", v)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Objectif de poids (kg)"
                type="number"
                value={form.targetWeightKg}
                onChange={(v) => setField("targetWeightKg", v)}
              />
              <SelectField label="Niveau sportif" value={form.level} onChange={(v) => setField("level", v)} options={levelOptions} />
            </div>
            <Field label="Objectif principal" value={form.goal} onChange={(v) => setField("goal", v)} />
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Fréquence (x/semaine)"
                type="number"
                value={form.trainingFrequencyPerWeek}
                onChange={(v) => setField("trainingFrequencyPerWeek", v)}
              />
              <SelectField
                label="Lieu d'entraînement"
                value={form.trainingLocation}
                onChange={(v) => setField("trainingLocation", v)}
                options={locationOptions}
              />
            </div>
            <PrimaryButton onClick={handleSubmit} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer les modifications"}
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </>
  );
}
