"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Info, Pencil, X } from "lucide-react";

import { Field, SelectField, TextareaField, CheckboxField } from "@/components/admin/AdminFormFields";
import { InfoRow, TagList } from "@/components/student/ProfileSection";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getStudentOnboardingDetails, updateStudentOnboardingDetails } from "@/lib/supabase/onboarding";
import {
  emptyOnboardingForm,
  equipmentOptions,
  levelOptions,
  locationOptions,
  neatOptions,
  onboardingFormFromProfile,
  onboardingFormToSubmission,
  mainGoalOptions,
  type OnboardingFormState,
  type OnboardingProfileSource,
} from "@/lib/onboarding-form";
import type { SupabaseStudentProfile } from "@/types";

function val(value: string): string {
  return value.trim() !== "" ? value : "Non renseigné";
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details className="group border border-border" open>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-bold uppercase tracking-wide text-foreground">
        {title}
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border px-4 py-3">{children}</div>
    </details>
  );
}

export function StudentOnboardingDetailModal({ student }: { student: OnboardingProfileSource }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [profile, setProfile] = useState<SupabaseStudentProfile | null>(null);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<OnboardingFormState>(emptyOnboardingForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setLoading(false);
        return;
      }
      const id = await getCurrentStudentId(supabase);
      if (!id) {
        if (!cancelled) setLoading(false);
        return;
      }
      const details = await getStudentOnboardingDetails(supabase, id);
      if (!cancelled) {
        setStudentId(id);
        setProfile(details);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [open]);

  function startEdit() {
    setForm(onboardingFormFromProfile(student, profile));
    setEditing(true);
    setError(false);
  }

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

  async function handleSave() {
    if (saving || !studentId) return;
    setSaving(true);
    setError(false);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSaving(false);
      setError(true);
      return;
    }
    const success = await updateStudentOnboardingDetails(supabase, studentId, onboardingFormToSubmission(form), {
      skipEmptyFields: false,
      weightEntrySource: "student_update",
    });
    setSaving(false);
    if (!success) {
      setError(true);
      return;
    }
    const refreshed = await getStudentOnboardingDetails(supabase, studentId);
    setProfile(refreshed);
    setEditing(false);
  }

  function close() {
    setOpen(false);
    setEditing(false);
    setError(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        Voir mes informations complètes
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Informations complètes"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                {editing ? "Modifier mes informations" : "Informations complètes"}
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

            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loading ? (
                <p className="text-sm text-muted-foreground">Chargement…</p>
              ) : error ? (
                <div className="mb-4 flex items-center gap-3 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  <AlertTriangle size={18} className="flex-shrink-0" />
                  Échec de l&apos;enregistrement. Réessaie.
                </div>
              ) : null}

              {!loading && !editing && (
                <div className="flex flex-col gap-3">
                  <Section title="Objectifs">
                    <InfoRow label="Objectifs secondaires" value={(profile?.secondaryGoals ?? []).join(", ") || "Non renseigné"} />
                    <InfoRow label="Délai souhaité" value={val(profile?.targetTimeframe ?? "")} />
                    <InfoRow label="Date cible" value={val(profile?.targetDate ?? "")} />
                  </Section>
                  <Section title="Niveau et activité">
                    <InfoRow label="Niveau d'activité / NEAT" value={val(profile?.neatLevel ?? "")} />
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Sports pratiqués</span>
                      <TagList items={profile?.sportsPracticed ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Autres activités</span>
                      <TagList items={profile?.otherActivities ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Matériel disponible</span>
                      <TagList items={profile?.availableEquipment ?? []} />
                    </div>
                  </Section>
                  <Section title="Préférences et contraintes sportives">
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices préférés à la salle</span>
                      <TagList items={profile?.favoriteGymExercises ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices préférés</span>
                      <TagList items={profile?.favoriteExercises ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Exercices à éviter</span>
                      <TagList items={profile?.avoidedExercises ?? []} />
                    </div>
                    <InfoRow label="Douleurs / blessures" value={val(profile?.onboardingInjuries ?? "")} />
                    <InfoRow label="Notes pour le coach" value={val(profile?.trainingNotes ?? "")} />
                  </Section>
                  <Section title="Santé (sensible)">
                    <p className="mb-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <Info size={14} className="mt-0.5 flex-shrink-0" />
                      Visible uniquement ici, jamais sur le dashboard.
                    </p>
                    <InfoRow label="Traitements / contraintes médicales" value={val(profile?.medicalTreatments ?? "")} />
                    <InfoRow label="Médicaments" value={val(profile?.medications ?? "")} />
                    <InfoRow label="Informations pour adapter l'entraînement" value={val(profile?.healthNotes ?? "")} />
                  </Section>
                  <Section title="Sommeil, récupération, hydratation">
                    <InfoRow label="Durée de sommeil" value={val(profile?.sleepDuration ?? "")} />
                    <InfoRow label="Qualité du sommeil" value={val(profile?.sleepQuality ?? "")} />
                    <InfoRow label="Récupération / fatigue" value={val(profile?.recoveryNotes ?? "")} />
                    <InfoRow label="Hydratation" value={val(profile?.hydrationLevel ?? "")} />
                    <InfoRow label="Eau / jour" value={val(profile?.dailyWaterIntake ?? "")} />
                    <InfoRow label="Notes hygiène de vie" value={val(profile?.lifestyleNotes ?? "")} />
                  </Section>
                  <Section title="Motivation et contexte personnel (sensible)">
                    <p className="mb-2 flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                      <Info size={14} className="mt-0.5 flex-shrink-0" />
                      Visible uniquement ici, jamais sur le dashboard.
                    </p>
                    <InfoRow label="Source de motivation" value={val(profile?.motivationSource ?? "")} />
                    <InfoRow label="Événements récents" value={val(profile?.recentLifeEvents ?? "")} />
                    <InfoRow label="Bien-être mental / émotionnel" value={val(profile?.mentalWellbeingGoal ?? "")} />
                    <InfoRow label="Notes libres" value={val(profile?.emotionalWellbeingNotes ?? "")} />
                  </Section>
                  <Section title="Préférences nutritionnelles">
                    <InfoRow label="Repas par jour" value={profile?.preferredMealCount ? String(profile.preferredMealCount) : "Non renseigné"} />
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Aliments aimés</span>
                      <TagList items={profile?.foodPreferences.liked ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Aliments à éviter</span>
                      <TagList items={profile?.dislikedFoods ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Allergies</span>
                      <TagList items={profile?.allergies ?? []} />
                    </div>
                    <div className="py-2">
                      <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Intolérances</span>
                      <TagList items={profile?.intolerances ?? []} />
                    </div>
                    <InfoRow label="Régime particulier" value={val(profile?.dietType ?? "")} />
                    <InfoRow label="Horaires de repas" value={val(profile?.mealTimingNotes ?? "")} />
                    <InfoRow label="Contraintes travail / sociales" value={val(profile?.workScheduleNotes ?? "")} />
                    <InfoRow label="Grignotage" value={val(profile?.snackingNotes ?? "")} />
                    <InfoRow label="Faim" value={val(profile?.hungerNotes ?? "")} />
                    <InfoRow label="Notes nutrition" value={val(profile?.nutritionNotes ?? "")} />
                  </Section>

                  <button
                    type="button"
                    onClick={startEdit}
                    className="mt-2 flex items-center justify-center gap-1.5 border border-primary bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
                  >
                    <Pencil size={13} />
                    Modifier mes informations
                  </button>
                </div>
              )}

              {!loading && editing && (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Prénom" value={form.firstName} onChange={(v) => setField("firstName", v)} />
                    <Field label="Nom" value={form.lastName} onChange={(v) => setField("lastName", v)} />
                  </div>
                  <Field label="Téléphone" value={form.phone} onChange={(v) => setField("phone", v)} />
                  <div className="grid grid-cols-3 gap-4">
                    <Field label="Âge" type="number" value={form.age} onChange={(v) => setField("age", v)} />
                    <Field label="Taille (cm)" type="number" value={form.heightCm} onChange={(v) => setField("heightCm", v)} />
                    <Field
                      label="Poids actuel (kg)"
                      type="number"
                      step="0.1"
                      value={form.currentWeightKg}
                      onChange={(v) => setField("currentWeightKg", v)}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field
                      label="Poids de départ"
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
                    />
                  </div>
                  <SelectField label="Objectif principal" value={form.mainGoal} onChange={(v) => setField("mainGoal", v)} options={mainGoalOptions} />
                  <Field label="Objectifs secondaires (séparés par des virgules)" value={form.secondaryGoals} onChange={(v) => setField("secondaryGoals", v)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Délai souhaité" value={form.targetTimeframe} onChange={(v) => setField("targetTimeframe", v)} />
                    <Field label="Date cible" type="date" value={form.targetDate} onChange={(v) => setField("targetDate", v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <SelectField label="Niveau sportif" value={form.level} onChange={(v) => setField("level", v)} options={levelOptions} />
                    <Field
                      label="Fréquence (x/semaine)"
                      type="number"
                      value={form.trainingFrequencyPerWeek}
                      onChange={(v) => setField("trainingFrequencyPerWeek", v)}
                    />
                  </div>
                  <SelectField label="Lieu d'entraînement" value={form.trainingLocation} onChange={(v) => setField("trainingLocation", v)} options={locationOptions} />
                  <SelectField label="Niveau d'activité / NEAT" value={form.neatLevel} onChange={(v) => setField("neatLevel", v)} options={neatOptions} />
                  <Field label="Sports pratiqués (séparés par des virgules)" value={form.sportsPracticed} onChange={(v) => setField("sportsPracticed", v)} />
                  <Field label="Autres activités (séparées par des virgules)" value={form.otherActivities} onChange={(v) => setField("otherActivities", v)} />
                  <div>
                    <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Matériel disponible</span>
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
                  <Field label="Exercices préférés à la salle" value={form.favoriteGymExercises} onChange={(v) => setField("favoriteGymExercises", v)} />
                  <Field label="Exercices préférés" value={form.favoriteExercises} onChange={(v) => setField("favoriteExercises", v)} />
                  <Field label="Exercices à éviter" value={form.avoidedExercises} onChange={(v) => setField("avoidedExercises", v)} />
                  <TextareaField label="Douleurs / blessures" value={form.injuries} onChange={(v) => setField("injuries", v)} />
                  <TextareaField label="Notes pour le coach" value={form.trainingNotes} onChange={(v) => setField("trainingNotes", v)} />
                  <TextareaField label="Traitements / contraintes médicales" value={form.medicalTreatments} onChange={(v) => setField("medicalTreatments", v)} />
                  <TextareaField label="Médicaments" value={form.medications} onChange={(v) => setField("medications", v)} />
                  <TextareaField label="Informations santé pour l'entraînement" value={form.healthNotes} onChange={(v) => setField("healthNotes", v)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Durée de sommeil" value={form.sleepDuration} onChange={(v) => setField("sleepDuration", v)} />
                    <Field label="Qualité du sommeil" value={form.sleepQuality} onChange={(v) => setField("sleepQuality", v)} />
                  </div>
                  <TextareaField label="Récupération / fatigue" value={form.recoveryNotes} onChange={(v) => setField("recoveryNotes", v)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Hydratation" value={form.hydrationLevel} onChange={(v) => setField("hydrationLevel", v)} />
                    <Field label="Eau / jour" value={form.dailyWaterIntake} onChange={(v) => setField("dailyWaterIntake", v)} />
                  </div>
                  <TextareaField label="Notes hygiène de vie" value={form.lifestyleNotes} onChange={(v) => setField("lifestyleNotes", v)} />
                  <TextareaField label="Source de motivation" value={form.motivationSource} onChange={(v) => setField("motivationSource", v)} />
                  <TextareaField label="Événements récents" value={form.recentLifeEvents} onChange={(v) => setField("recentLifeEvents", v)} />
                  <TextareaField label="Bien-être mental / émotionnel / stress" value={form.mentalWellbeingGoal} onChange={(v) => setField("mentalWellbeingGoal", v)} />
                  <TextareaField label="Notes libres" value={form.emotionalWellbeingNotes} onChange={(v) => setField("emotionalWellbeingNotes", v)} />
                  <Field label="Repas par jour" type="number" value={form.preferredMealCount} onChange={(v) => setField("preferredMealCount", v)} />
                  <Field label="Aliments aimés" value={form.likedFoods} onChange={(v) => setField("likedFoods", v)} />
                  <Field label="Aliments à éviter" value={form.dislikedFoods} onChange={(v) => setField("dislikedFoods", v)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Allergies" value={form.allergies} onChange={(v) => setField("allergies", v)} />
                    <Field label="Intolérances" value={form.intolerances} onChange={(v) => setField("intolerances", v)} />
                  </div>
                  <Field label="Régime particulier" value={form.dietType} onChange={(v) => setField("dietType", v)} />
                  <TextareaField label="Horaires de repas" value={form.mealTimingNotes} onChange={(v) => setField("mealTimingNotes", v)} />
                  <TextareaField label="Contraintes travail / sociales" value={form.workScheduleNotes} onChange={(v) => setField("workScheduleNotes", v)} />
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Grignotage" value={form.snackingNotes} onChange={(v) => setField("snackingNotes", v)} />
                    <Field label="Faim" value={form.hungerNotes} onChange={(v) => setField("hungerNotes", v)} />
                  </div>
                  <TextareaField label="Notes nutrition" value={form.nutritionNotes} onChange={(v) => setField("nutritionNotes", v)} />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="flex-1 border border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={handleSave}
                      disabled={saving}
                      className="flex-1 bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
                    >
                      {saving ? "Enregistrement…" : "Enregistrer"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
