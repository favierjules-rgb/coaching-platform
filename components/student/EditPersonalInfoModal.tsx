"use client";

import { useState } from "react";
import { CheckCircle, X } from "lucide-react";

import { Field } from "@/components/student/FormFields";
import type { StudentProfile } from "@/types";

interface EditPersonalInfoModalProps {
  profile: StudentProfile;
  onSave: (partial: Partial<StudentProfile>) => void;
}

const emptyForm = {
  firstName: "",
  lastName: "",
  age: "",
  heightCm: "",
  goal: "",
  level: "",
  trainingFrequencyPerWeek: "",
  trainingLocation: "",
};

export function EditPersonalInfoModal({ profile, onSave }: EditPersonalInfoModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState(emptyForm);

  function setField(key: keyof typeof emptyForm, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setSubmitted(false);
    setForm(emptyForm);
  }

  const canSubmit = Object.values(form).some((value) => value.trim() !== "");

  function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    const partial: Partial<StudentProfile> = {};
    if (form.firstName.trim()) partial.firstName = form.firstName.trim();
    if (form.lastName.trim()) partial.lastName = form.lastName.trim();
    if (form.age.trim()) partial.age = Number(form.age);
    if (form.heightCm.trim()) partial.heightCm = Number(form.heightCm);
    if (form.goal.trim()) partial.goal = form.goal.trim();
    if (form.level.trim()) partial.level = form.level.trim();
    if (form.trainingFrequencyPerWeek.trim())
      partial.trainingFrequencyPerWeek = Number(form.trainingFrequencyPerWeek);
    if (form.trainingLocation.trim())
      partial.trainingLocation = form.trainingLocation.trim();

    onSave(partial);
    setSubmitted(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
      >
        Modifier mes informations
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Modifier mes informations"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                Modifier mes informations
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
                Informations mises à jour sur toute la page profil.
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Ne renseigne que les champs à modifier. Cette action est
                  une démonstration : les données sont conservées en local
                  (localStorage).
                </p>
                <Field
                  label="Prénom"
                  value={form.firstName}
                  onChange={(v) => setField("firstName", v)}
                  placeholder={profile.firstName}
                />
                <Field
                  label="Nom"
                  value={form.lastName}
                  onChange={(v) => setField("lastName", v)}
                  placeholder={profile.lastName}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Âge"
                    type="number"
                    value={form.age}
                    onChange={(v) => setField("age", v)}
                    placeholder={`${profile.age}`}
                  />
                  <Field
                    label="Taille (cm)"
                    type="number"
                    value={form.heightCm}
                    onChange={(v) => setField("heightCm", v)}
                    placeholder={`${profile.heightCm}`}
                  />
                </div>
                <Field
                  label="Objectif principal"
                  value={form.goal}
                  onChange={(v) => setField("goal", v)}
                  placeholder={profile.goal}
                />
                <Field
                  label="Niveau sportif"
                  value={form.level}
                  onChange={(v) => setField("level", v)}
                  placeholder={profile.level}
                />
                <div className="grid grid-cols-2 gap-4">
                  <Field
                    label="Fréquence (x/semaine)"
                    type="number"
                    value={form.trainingFrequencyPerWeek}
                    onChange={(v) => setField("trainingFrequencyPerWeek", v)}
                    placeholder={`${profile.trainingFrequencyPerWeek}`}
                  />
                  <Field
                    label="Lieu d'entraînement"
                    value={form.trainingLocation}
                    onChange={(v) => setField("trainingLocation", v)}
                    placeholder={profile.trainingLocation}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  className="mt-1 w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                >
                  Enregistrer les modifications
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
