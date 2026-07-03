"use client";

import { useState } from "react";
import { CheckCircle, Send, UserPlus } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
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

function emptyForm() {
  return {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    age: "",
    heightCm: "",
    currentWeightKg: "",
    goal: "",
    level: "Débutant",
    trainingFrequencyPerWeek: "3",
    trainingLocation: "Salle de sport",
    foodPreferences: "",
    intolerances: "",
    injuries: "",
    coachNotes: "",
  };
}

export function CreateStudentModal({
  onCreate,
}: {
  onCreate: (student: Omit<AdminStudent, "id" | "createdAt" | "updatedAt">) => string;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "created" | "invited">("form");
  const [form, setForm] = useState(emptyForm);

  function setField<K extends keyof ReturnType<typeof emptyForm>>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setStep("form");
    setForm(emptyForm());
  }

  const canSubmit = form.firstName.trim() !== "" && form.lastName.trim() !== "" && form.email.trim() !== "";

  function handleCreate() {
    if (!canSubmit) return;
    const weight = Number(form.currentWeightKg) || 0;
    onCreate({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      age: Number(form.age) || 0,
      heightCm: Number(form.heightCm) || 0,
      currentWeightKg: weight,
      startWeightKg: weight,
      targetWeightKg: weight,
      goal: form.goal.trim() || "Non défini",
      level: form.level,
      trainingFrequencyPerWeek: Number(form.trainingFrequencyPerWeek) || 0,
      trainingLocation: form.trainingLocation,
      status: "actif",
      startDate: new Date().toISOString().slice(0, 10),
      lastLoginAt: null,
      foodPreferences: {
        liked: [],
        disliked: [],
        intolerances: form.intolerances
          ? form.intolerances.split(",").map((s) => s.trim()).filter(Boolean)
          : [],
        diet: form.foodPreferences.trim() || "Omnivore",
      },
      sportPreferences: { sports: [], equipment: [], preferredExercises: [], exercisesToAvoid: [] },
      injuries: form.injuries.trim() || "Aucune blessure connue.",
      weightHistory: [{ month: new Date().toLocaleDateString("fr-FR", { month: "short" }), kg: weight }],
      measurements: [],
      customMeasurements: [],
      measurementHistory: [],
      progressPhotos: [],
      paymentProfile: {
        studentId: "",
        offerName: "",
        monthlyPriceEuros: 0,
        durationMonths: 0,
        totalPriceEuros: 0,
        paidAmountEuros: 0,
        status: "en attente",
        method: "autre",
        nextPaymentDate: null,
        installmentsTotal: 0,
        installmentsPaid: 0,
        entries: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      assignedProgramIds: [],
      assignedNutritionPlanIds: [],
      assignedDocumentIds: [],
      coachNotes: form.coachNotes.trim()
        ? [{ id: `note-${Date.now()}`, studentId: "", text: form.coachNotes.trim(), createdAt: new Date().toISOString() }]
        : [],
    });
    setStep("created");
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
      >
        <UserPlus size={14} />
        Créer un élève
      </button>

      {open && (
        <Modal title="Créer un élève" onClose={close} maxWidth="max-w-lg">
          {step === "form" && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom" value={form.firstName} onChange={(v) => setField("firstName", v)} required />
                <Field label="Nom" value={form.lastName} onChange={(v) => setField("lastName", v)} required />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Email" type="email" value={form.email} onChange={(v) => setField("email", v)} required />
                <Field label="Téléphone" value={form.phone} onChange={(v) => setField("phone", v)} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Âge" type="number" value={form.age} onChange={(v) => setField("age", v)} />
                <Field label="Taille (cm)" type="number" value={form.heightCm} onChange={(v) => setField("heightCm", v)} />
                <Field
                  label="Poids (kg)"
                  type="number"
                  value={form.currentWeightKg}
                  onChange={(v) => setField("currentWeightKg", v)}
                />
              </div>
              <Field label="Objectif principal" value={form.goal} onChange={(v) => setField("goal", v)} />
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Niveau sportif" value={form.level} onChange={(v) => setField("level", v)} options={levelOptions} />
                <Field
                  label="Fréquence souhaitée (x/semaine)"
                  type="number"
                  value={form.trainingFrequencyPerWeek}
                  onChange={(v) => setField("trainingFrequencyPerWeek", v)}
                />
              </div>
              <SelectField
                label="Lieu d'entraînement"
                value={form.trainingLocation}
                onChange={(v) => setField("trainingLocation", v)}
                options={locationOptions}
              />
              <Field
                label="Préférences alimentaires (régime)"
                value={form.foodPreferences}
                onChange={(v) => setField("foodPreferences", v)}
                placeholder="Ex : Omnivore"
              />
              <Field
                label="Intolérances (séparées par des virgules)"
                value={form.intolerances}
                onChange={(v) => setField("intolerances", v)}
                placeholder="Ex : Lactose, Gluten"
              />
              <TextareaField label="Blessures / contraintes" value={form.injuries} onChange={(v) => setField("injuries", v)} rows={2} />
              <TextareaField label="Notes coach" value={form.coachNotes} onChange={(v) => setField("coachNotes", v)} rows={2} />
              <PrimaryButton onClick={handleCreate} disabled={!canSubmit}>
                Créer l&apos;élève
              </PrimaryButton>
            </div>
          )}

          {step === "created" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                <CheckCircle size={18} className="flex-shrink-0" />
                Élève créé avec succès.
              </div>
              <p className="text-sm text-muted-foreground">
                Tu peux maintenant lui envoyer une invitation (fictive pour le moment) ou fermer cette fenêtre.
              </p>
              <div className="flex gap-3">
                <PrimaryButton onClick={() => setStep("invited")}>
                  <span className="flex items-center justify-center gap-2">
                    <Send size={14} />
                    Envoyer invitation
                  </span>
                </PrimaryButton>
                <OutlineButton onClick={close}>Fermer</OutlineButton>
              </div>
            </div>
          )}

          {step === "invited" && (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Invitation envoyée (fictive). L&apos;élève recevra un accès une fois Supabase connecté.
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
