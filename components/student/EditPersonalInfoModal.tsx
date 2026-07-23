"use client";

import { useState } from "react";
import { CheckCircle, X } from "lucide-react";

import { Field } from "@/components/student/FormFields";
import type { StudentProfile } from "@/types";

interface EditPersonalInfoModalProps {
  profile: StudentProfile;
  onSave: (partial: Partial<StudentProfile>) => void;
}

function formFromProfile(profile: StudentProfile) {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    age: String(profile.age),
    heightCm: String(profile.heightCm),
    goal: profile.goal,
    level: profile.level,
    trainingFrequencyPerWeek: String(profile.trainingFrequencyPerWeek),
    trainingLocation: profile.trainingLocation,
  };
}

export function EditPersonalInfoModal({ profile, onSave }: EditPersonalInfoModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState(() => formFromProfile(profile));

  function setField(key: keyof ReturnType<typeof formFromProfile>, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setSubmitted(false);
  }

  const canSubmit = Object.values(form).some((value) => value.trim() !== "");

  function handleSubmit() {
    if (!canSubmit) {
      return;
    }
    const partial: Partial<StudentProfile> = {};
    if (form.firstName.trim()) partial.firstName = form.firstName.trim();
    if (form.lastName.trim()) partial.lastName = form.lastName.trim();
    if (form.age.trim() && !Number.isNaN(Number(form.age))) partial.age = Number(form.age);
    if (form.heightCm.trim() && !Number.isNaN(Number(form.heightCm)))
      partial.heightCm = Number(form.heightCm);
    if (form.goal.trim()) partial.goal = form.goal.trim();
    if (form.level.trim()) partial.level = form.level.trim();
    if (
      form.trainingFrequencyPerWeek.trim() &&
      !Number.isNaN(Number(form.trainingFrequencyPerWeek))
    )
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
        onClick={() => {
          // Pré-remplit avec les valeurs actuelles à chaque ouverture : un
          // placeholder vide se lit facilement comme "déjà rempli" et
          // amène à valider sans rien changer.
          setForm(formFromProfile(profile));
          setOpen(true);
        }}
        className="pressable inline-flex min-h-[44px] items-center rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
          <div className="animate-fade-in flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                Modifier mes informations
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Fermer"
                className="flex h-11 w-11 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {submitted ? (
                <div className="animate-fade-in flex items-center gap-3 rounded-control border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
                  <CheckCircle size={18} className="flex-shrink-0" />
                  Informations mises à jour sur toute la page profil.
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Ces champs sont pré-remplis avec tes valeurs actuelles :
                    modifie uniquement ce que tu veux changer. Cette action
                    est une démonstration : les données sont conservées en
                    local (localStorage).
                  </p>
                  <Field
                    label="Prénom"
                    value={form.firstName}
                    onChange={(v) => setField("firstName", v)}
                  />
                  <Field
                    label="Nom"
                    value={form.lastName}
                    onChange={(v) => setField("lastName", v)}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label="Âge"
                      type="number"
                      value={form.age}
                      onChange={(v) => setField("age", v)}
                    />
                    <Field
                      label="Taille (cm)"
                      type="number"
                      value={form.heightCm}
                      onChange={(v) => setField("heightCm", v)}
                    />
                  </div>
                  <Field
                    label="Objectif principal"
                    value={form.goal}
                    onChange={(v) => setField("goal", v)}
                  />
                  <Field
                    label="Niveau sportif"
                    value={form.level}
                    onChange={(v) => setField("level", v)}
                  />
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label="Fréquence (x/semaine)"
                      type="number"
                      value={form.trainingFrequencyPerWeek}
                      onChange={(v) => setField("trainingFrequencyPerWeek", v)}
                    />
                    <Field
                      label="Lieu d'entraînement"
                      value={form.trainingLocation}
                      onChange={(v) => setField("trainingLocation", v)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={!canSubmit}
                    className="pressable mt-1 min-h-[44px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                  >
                    Enregistrer les modifications
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
