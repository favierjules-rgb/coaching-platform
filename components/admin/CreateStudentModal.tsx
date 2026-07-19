"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle, UserPlus } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";

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

/**
 * Création réelle d'un élève (chantier "invitation email à la création
 * d'un élève") : POST /api/admin/students -> crée un vrai compte Supabase
 * (auth invite + profiles + students + student_profiles pré-remplie) et
 * envoie automatiquement l'email d'invitation "Ton espace est prêt" avec un
 * lien de définition de mot de passe. Remplace l'ancien flux 100% mock
 * (localStorage, "invitation fictive") — plus besoin d'un second bouton
 * manuel "Envoyer invitation", l'envoi est désormais automatique et réel.
 */
export function CreateStudentModal({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "submitting" | "created" | "error">("form");
  const [errorMessage, setErrorMessage] = useState("");
  const [form, setForm] = useState(emptyForm);

  function setField<K extends keyof ReturnType<typeof emptyForm>>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setStep("form");
    setErrorMessage("");
    setForm(emptyForm());
  }

  const canSubmit = form.firstName.trim() !== "" && form.lastName.trim() !== "" && form.email.trim() !== "";

  async function handleCreate() {
    if (!canSubmit) return;
    setStep("submitting");
    setErrorMessage("");
    try {
      const response = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim(),
          phone: form.phone.trim(),
          age: Number(form.age) || 0,
          heightCm: Number(form.heightCm) || 0,
          currentWeightKg: Number(form.currentWeightKg) || 0,
          goal: form.goal.trim(),
          level: form.level,
          trainingFrequencyPerWeek: Number(form.trainingFrequencyPerWeek) || 0,
          trainingLocation: form.trainingLocation,
          foodPreferences: form.foodPreferences.trim(),
          intolerances: form.intolerances
            ? form.intolerances.split(",").map((s) => s.trim()).filter(Boolean)
            : [],
          injuries: form.injuries.trim(),
          coachNotes: form.coachNotes.trim(),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setErrorMessage(data.error || "Échec de la création de l'élève.");
        setStep("error");
        return;
      }
      setStep("created");
      onCreated();
    } catch {
      setErrorMessage("Échec de la création de l'élève (erreur réseau).");
      setStep("error");
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
      >
        <UserPlus size={14} />
        Créer un élève
      </button>

      {open && (
        <Modal title="Créer un élève" onClose={close} maxWidth="max-w-lg">
          {(step === "form" || step === "submitting" || step === "error") && (
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

              {step === "error" && (
                <p className="flex items-center gap-2 text-sm text-red-400">
                  <AlertTriangle size={16} className="flex-shrink-0" />
                  {errorMessage}
                </p>
              )}

              <PrimaryButton onClick={handleCreate} disabled={!canSubmit || step === "submitting"}>
                {step === "submitting" ? "Création en cours…" : "Créer l'élève et envoyer l'invitation"}
              </PrimaryButton>
            </div>
          )}

          {step === "created" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                <CheckCircle size={18} className="flex-shrink-0" />
                Élève créé — l&apos;invitation par email (définition du mot de passe) vient d&apos;être envoyée à{" "}
                {form.email.trim()}.
              </div>
              <p className="text-sm text-muted-foreground">
                Une fois connecté, l&apos;élève devra obligatoirement compléter le questionnaire avant d&apos;accéder
                au reste de son espace.
              </p>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
