"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, CheckCircle } from "lucide-react";

import { Field, SelectField, TextareaField, CheckboxField } from "@/components/admin/AdminFormFields";
import { Logo } from "@/components/ui/Logo";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { submitOnboarding } from "@/lib/supabase/onboarding";
import {
  canProceedFromStep,
  emptyOnboardingForm,
  equipmentOptions,
  levelOptions,
  locationOptions,
  mainGoalOptions,
  neatOptions,
  onboardingFormToSubmission,
  type OnboardingFormState,
} from "@/lib/onboarding-form";

const TOTAL_STEPS = 9;

const stepTitles = [
  "Informations personnelles",
  "Objectifs",
  "Niveau, activité et entraînement",
  "Préférences et contraintes sportives",
  "Santé et traitements",
  "Sommeil, récupération et hydratation",
  "Motivation et contexte personnel",
  "Préférences nutritionnelles",
  "Confirmation",
];

export function OnboardingWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<OnboardingFormState>(emptyOnboardingForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  function setField<K extends keyof OnboardingFormState>(key: K, value: OnboardingFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function toggleEquipment(option: string, checked: boolean) {
    setForm((prev) => ({
      ...prev,
      availableEquipment: checked
        ? [...prev.availableEquipment, option]
        : prev.availableEquipment.filter((item) => item !== option),
    }));
  }

  async function handleValidate() {
    if (saving) return;
    setSaving(true);
    setError(false);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSaving(false);
      setError(true);
      return;
    }
    const studentId = await getCurrentStudentId(supabase);
    if (!studentId) {
      setSaving(false);
      setError(true);
      return;
    }
    const success = await submitOnboarding(supabase, studentId, onboardingFormToSubmission(form));
    setSaving(false);
    if (!success) {
      setError(true);
      return;
    }
    fetch("/api/email/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId }),
    }).catch(() => {});
    router.refresh();
    router.push("/dashboard");
  }

  return (
    // Racine en `<main>` (Lot 6, Groupe C — landmarks) : page autonome sans
    // StudentShell (voir commentaire du composant page), donc sans ce tag
    // aucun repère "contenu principal" n'était exposé aux lecteurs d'écran.
    // Changement de balise uniquement, aucun style ni comportement modifié.
    <main className="flex min-h-screen flex-col items-center bg-background px-4 py-10">
      <div className="mb-6">
        <Logo />
      </div>

      <div className="w-full max-w-2xl border border-border bg-card p-6 sm:p-8">
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-widest text-muted-foreground">
            <span>
              Étape {step} / {TOTAL_STEPS}
            </span>
            <span>{stepTitles[step - 1]}</span>
          </div>
          <div className="h-1.5 w-full border border-border bg-background">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${(step / TOTAL_STEPS) * 100}%` }}
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertTriangle size={18} className="flex-shrink-0" />
            Échec de l&apos;enregistrement. Réessaie.
          </div>
        )}

        <div key={step} className="step-fade-slide-in flex flex-col gap-4">
          {step === 1 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Prénom" value={form.firstName} onChange={(v) => setField("firstName", v)} required />
                <Field label="Nom" value={form.lastName} onChange={(v) => setField("lastName", v)} required />
              </div>
              <Field
                label="Téléphone (optionnel)"
                value={form.phone}
                onChange={(v) => setField("phone", v)}
              />
              <div className="grid grid-cols-3 gap-4">
                <Field label="Âge" type="number" value={form.age} onChange={(v) => setField("age", v)} required />
                <Field
                  label="Taille (cm)"
                  type="number"
                  value={form.heightCm}
                  onChange={(v) => setField("heightCm", v)}
                  required
                />
                <Field
                  label="Poids actuel (kg)"
                  type="number"
                  step="0.1"
                  value={form.currentWeightKg}
                  onChange={(v) => setField("currentWeightKg", v)}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Poids de départ (optionnel)"
                  type="number"
                  step="0.1"
                  value={form.startWeightKg}
                  onChange={(v) => setField("startWeightKg", v)}
                />
                <Field
                  label="Objectif de poids (kg)"
                  type="number"
                  step="0.1"
                  value={form.targetWeightKg}
                  onChange={(v) => setField("targetWeightKg", v)}
                  required
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <SelectField
                label="Objectif principal"
                value={form.mainGoal}
                onChange={(v) => setField("mainGoal", v)}
                options={mainGoalOptions}
              />
              <Field
                label="Objectifs secondaires (optionnel, séparés par des virgules)"
                value={form.secondaryGoals}
                onChange={(v) => setField("secondaryGoals", v)}
                placeholder="ex : dormir mieux, gagner en énergie"
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Délai souhaité (optionnel)"
                  value={form.targetTimeframe}
                  onChange={(v) => setField("targetTimeframe", v)}
                  placeholder="ex : 6 mois"
                />
                <Field
                  label="Date cible (optionnel)"
                  type="date"
                  value={form.targetDate}
                  onChange={(v) => setField("targetDate", v)}
                />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <SelectField
                  label="Niveau sportif"
                  value={form.level}
                  onChange={(v) => setField("level", v)}
                  options={levelOptions}
                />
                <Field
                  label="Fréquence d'entraînement (x/semaine)"
                  type="number"
                  value={form.trainingFrequencyPerWeek}
                  onChange={(v) => setField("trainingFrequencyPerWeek", v)}
                  required
                />
              </div>
              <SelectField
                label="Lieu d'entraînement"
                value={form.trainingLocation}
                onChange={(v) => setField("trainingLocation", v)}
                options={locationOptions}
              />
              <SelectField
                label="Niveau d'activité quotidienne / NEAT (optionnel)"
                value={form.neatLevel}
                onChange={(v) => setField("neatLevel", v)}
                options={neatOptions}
              />
              <Field
                label="Sports pratiqués (optionnel, séparés par des virgules)"
                value={form.sportsPracticed}
                onChange={(v) => setField("sportsPracticed", v)}
              />
              <Field
                label="Autres activités physiques (optionnel, séparées par des virgules)"
                value={form.otherActivities}
                onChange={(v) => setField("otherActivities", v)}
              />
              <div>
                <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Matériel disponible (optionnel)
                </span>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {equipmentOptions.map((option) => (
                    <CheckboxField
                      key={option}
                      label={option}
                      checked={form.availableEquipment.includes(option)}
                      onChange={(checked) => toggleEquipment(option, checked)}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <p className="text-sm text-muted-foreground">Tout est optionnel dans cette étape.</p>
              <Field
                label="Exercices préférés à la salle (séparés par des virgules)"
                value={form.favoriteGymExercises}
                onChange={(v) => setField("favoriteGymExercises", v)}
              />
              <Field
                label="Exercices préférés en général (séparés par des virgules)"
                value={form.favoriteExercises}
                onChange={(v) => setField("favoriteExercises", v)}
              />
              <Field
                label="Exercices à éviter / mouvements inconfortables (séparés par des virgules)"
                value={form.avoidedExercises}
                onChange={(v) => setField("avoidedExercises", v)}
              />
              <TextareaField
                label="Douleurs / blessures"
                value={form.injuries}
                onChange={(v) => setField("injuries", v)}
              />
              <TextareaField
                label="Notes pour le coach"
                value={form.trainingNotes}
                onChange={(v) => setField("trainingNotes", v)}
              />
            </>
          )}

          {step === 5 && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Ces informations sont optionnelles. Elles servent uniquement à adapter ton
                accompagnement. Tu peux aussi en parler directement avec ton coach.
              </p>
              <TextareaField
                label="Traitements en cours / contraintes médicales connues"
                value={form.medicalTreatments}
                onChange={(v) => setField("medicalTreatments", v)}
              />
              <TextareaField
                label="Médicaments"
                value={form.medications}
                onChange={(v) => setField("medications", v)}
              />
              <TextareaField
                label="Informations importantes pour adapter l'entraînement"
                value={form.healthNotes}
                onChange={(v) => setField("healthNotes", v)}
              />
            </>
          )}

          {step === 6 && (
            <>
              <p className="text-sm text-muted-foreground">Tout est optionnel dans cette étape.</p>
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Durée moyenne du sommeil"
                  value={form.sleepDuration}
                  onChange={(v) => setField("sleepDuration", v)}
                  placeholder="ex : 7h"
                />
                <Field
                  label="Qualité du sommeil"
                  value={form.sleepQuality}
                  onChange={(v) => setField("sleepQuality", v)}
                  placeholder="ex : correcte"
                />
              </div>
              <TextareaField
                label="Niveau de fatigue général / récupération"
                value={form.recoveryNotes}
                onChange={(v) => setField("recoveryNotes", v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Hydratation"
                  value={form.hydrationLevel}
                  onChange={(v) => setField("hydrationLevel", v)}
                  placeholder="ex : correcte"
                />
                <Field
                  label="Quantité d'eau / jour (approximative)"
                  value={form.dailyWaterIntake}
                  onChange={(v) => setField("dailyWaterIntake", v)}
                  placeholder="ex : 1,5 L"
                />
              </div>
              <TextareaField
                label="Notes hygiène de vie"
                value={form.lifestyleNotes}
                onChange={(v) => setField("lifestyleNotes", v)}
              />
            </>
          )}

          {step === 7 && (
            <>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Tout est optionnel ici. Ces réponses ne sont jamais affichées sur le dashboard,
                uniquement dans le détail de ton profil.
              </p>
              <TextareaField
                label="D'où vient ta motivation ?"
                value={form.motivationSource}
                onChange={(v) => setField("motivationSource", v)}
              />
              <TextareaField
                label="Événements marquants récents pouvant impacter l'entraînement"
                value={form.recentLifeEvents}
                onChange={(v) => setField("recentLifeEvents", v)}
              />
              <TextareaField
                label="Quelque chose à améliorer dans ton bien-être mental ou émotionnel grâce au sport ? Niveau de stress général ?"
                value={form.mentalWellbeingGoal}
                onChange={(v) => setField("mentalWellbeingGoal", v)}
              />
              <TextareaField
                label="Notes libres"
                value={form.emotionalWellbeingNotes}
                onChange={(v) => setField("emotionalWellbeingNotes", v)}
              />
            </>
          )}

          {step === 8 && (
            <>
              <p className="text-sm text-muted-foreground">Tout est optionnel dans cette étape.</p>
              <Field
                label="Nombre de repas par jour"
                type="number"
                value={form.preferredMealCount}
                onChange={(v) => setField("preferredMealCount", v)}
              />
              <Field
                label="Aliments aimés (séparés par des virgules)"
                value={form.likedFoods}
                onChange={(v) => setField("likedFoods", v)}
              />
              <Field
                label="Aliments à éviter (séparés par des virgules)"
                value={form.dislikedFoods}
                onChange={(v) => setField("dislikedFoods", v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Allergies (séparées par des virgules)"
                  value={form.allergies}
                  onChange={(v) => setField("allergies", v)}
                />
                <Field
                  label="Intolérances (séparées par des virgules)"
                  value={form.intolerances}
                  onChange={(v) => setField("intolerances", v)}
                />
              </div>
              <Field
                label="Régime particulier"
                value={form.dietType}
                onChange={(v) => setField("dietType", v)}
              />
              <TextareaField
                label="Horaires de repas"
                value={form.mealTimingNotes}
                onChange={(v) => setField("mealTimingNotes", v)}
              />
              <TextareaField
                label="Contraintes travail / sociales"
                value={form.workScheduleNotes}
                onChange={(v) => setField("workScheduleNotes", v)}
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Grignotage"
                  value={form.snackingNotes}
                  onChange={(v) => setField("snackingNotes", v)}
                />
                <Field label="Faim" value={form.hungerNotes} onChange={(v) => setField("hungerNotes", v)} />
              </div>
              <TextareaField
                label="Notes nutrition"
                value={form.nutritionNotes}
                onChange={(v) => setField("nutritionNotes", v)}
              />
            </>
          )}

          {step === 9 && (
            <>
              <p className="text-sm text-muted-foreground">
                Vérifie tes réponses principales avant de valider. Les informations plus
                personnelles restent visibles uniquement dans le détail de ton profil.
              </p>
              <div className="flex flex-col gap-2 border border-border bg-background p-4 text-sm text-foreground">
                <span>
                  <strong>{form.firstName || "Prénom"} {form.lastName || "Nom"}</strong>
                </span>
                <span>Âge : {form.age || "Non renseigné"}</span>
                <span>Taille : {form.heightCm ? `${form.heightCm} cm` : "Non renseigné"}</span>
                <span>Poids actuel : {form.currentWeightKg ? `${form.currentWeightKg} kg` : "Non renseigné"}</span>
                <span>Objectif de poids : {form.targetWeightKg ? `${form.targetWeightKg} kg` : "Non renseigné"}</span>
                <span>Objectif principal : {form.mainGoal || "Non renseigné"}</span>
                <span>Niveau sportif : {form.level || "Non renseigné"}</span>
                <span>Fréquence : {form.trainingFrequencyPerWeek ? `${form.trainingFrequencyPerWeek}x / semaine` : "Non renseigné"}</span>
                <span>Lieu : {form.trainingLocation || "Non renseigné"}</span>
              </div>
              <button
                type="button"
                onClick={handleValidate}
                disabled={saving}
                className="mt-2 flex items-center justify-center gap-2 bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
              >
                <CheckCircle size={16} />
                {saving ? "Enregistrement…" : "Valider mon profil"}
              </button>
            </>
          )}
        </div>

        {step < 9 && (
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
              className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft size={13} />
              Précédent
            </button>
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
              disabled={!canProceedFromStep(step, form)}
              className="flex items-center gap-1.5 bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
            >
              Suivant
              <ArrowRight size={13} />
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
