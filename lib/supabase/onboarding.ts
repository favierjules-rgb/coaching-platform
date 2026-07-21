import type { SupabaseClient } from "@supabase/supabase-js";

import { HEALTH_DATA_CONSENT_TEXT_VERSION, insertLegalConsent } from "@/lib/legal-consents";
import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import { addWeightEntry, getStudentProfile } from "@/lib/supabase/students";
import type { Database } from "@/types/supabase";
import type { StudentOnboardingSubmission, SupabaseStudentProfile, WeightEntrySource } from "@/types";

type TypedSupabaseClient = SupabaseClient<Database>;
type StudentProfileUpdate = Database["public"]["Tables"]["student_profiles"]["Update"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    // Chaîne composée plutôt que l'objet brut : un PostgrestError passé tel
    // quel à console.error s'affiche "{}" dans l'overlay Next.js, ce qui
    // rend le vrai diagnostic (colonne inconnue, RLS...) invisible.
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

/**
 * `student_profiles.onboarding_completed` pour l'élève donné — `false` si
 * aucune fiche n'existe encore (élève tout juste créé par le coach, jamais
 * connecté) ou en cas d'erreur, jamais un blocage silencieux qui laisserait
 * passer un profil non complété.
 */
export async function getOnboardingCompleted(supabase: TypedSupabaseClient, studentId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("student_profiles")
    .select("onboarding_completed")
    .eq("student_id", studentId)
    .maybeSingle();
  devWarn("getOnboardingCompleted", error);
  return data?.onboarding_completed ?? false;
}

/**
 * Construit l'objet de mise à jour `student_profiles` à partir d'un
 * `Partial<StudentOnboardingSubmission>`. `skipEmptyFields` (utilisé côté
 * coach, voir updateStudentOnboardingDetails) omet les champs texte/tableau
 * vides du payload plutôt que de les écrire tels quels, pour ne jamais
 * écraser une réponse déjà renseignée par l'élève avec une case restée
 * vide dans le formulaire du coach.
 */
function buildProfileUpdate(
  partial: Partial<StudentOnboardingSubmission>,
  skipEmptyFields: boolean,
): StudentProfileUpdate {
  const update: StudentProfileUpdate = {};

  function setText(key: keyof StudentProfileUpdate, value: string | undefined) {
    if (value === undefined) return;
    if (skipEmptyFields && value.trim() === "") return;
    (update as Record<string, unknown>)[key] = value;
  }
  function setArray(key: keyof StudentProfileUpdate, value: string[] | undefined) {
    if (value === undefined) return;
    if (skipEmptyFields && value.length === 0) return;
    (update as Record<string, unknown>)[key] = value;
  }
  function setNumber(key: keyof StudentProfileUpdate, value: number | null | undefined) {
    if (value === undefined) return;
    if (skipEmptyFields && value === null) return;
    (update as Record<string, unknown>)[key] = value;
  }

  setNumber("age", partial.age);
  setNumber("height_cm", partial.heightCm);
  setNumber("current_weight_kg", partial.currentWeightKg);
  setNumber("start_weight_kg", partial.startWeightKg);
  setNumber("target_weight_kg", partial.targetWeightKg);
  // Uniquement main_goal / sport_level : ce sont les colonnes réellement
  // présentes sur le projet Supabase de production — les colonnes goal/level
  // de schema.sql n'y existent pas, et les inclure ferait échouer TOUTE la
  // mise à jour PostgREST (même cause que le bug de statut corrigé sur la
  // PR #15, voir lib/supabase/students.ts updateStudentFields).
  if (partial.mainGoal !== undefined && !(skipEmptyFields && partial.mainGoal.trim() === "")) {
    update.main_goal = partial.mainGoal;
  }
  setArray("secondary_goals", partial.secondaryGoals);
  setText("target_timeframe", partial.targetTimeframe);
  if (partial.targetDate !== undefined && !(skipEmptyFields && partial.targetDate.trim() === "")) {
    update.target_date = partial.targetDate.trim() === "" ? null : partial.targetDate;
  }
  if (partial.level !== undefined && !(skipEmptyFields && partial.level.trim() === "")) {
    update.sport_level = partial.level;
  }
  setNumber("training_frequency_per_week", partial.trainingFrequencyPerWeek);
  setText("training_location", partial.trainingLocation);
  setText("neat_level", partial.neatLevel);
  setArray("sports_practiced", partial.sportsPracticed);
  setArray("other_activities", partial.otherActivities);
  setArray("available_equipment", partial.availableEquipment);
  setArray("favorite_gym_exercises", partial.favoriteGymExercises);
  setArray("favorite_exercises", partial.favoriteExercises);
  setArray("avoided_exercises", partial.avoidedExercises);
  setText("injuries", partial.injuries);
  setText("training_notes", partial.trainingNotes);
  setText("medical_treatments", partial.medicalTreatments);
  setText("medications", partial.medications);
  setText("health_notes", partial.healthNotes);
  setText("sleep_duration", partial.sleepDuration);
  setText("sleep_quality", partial.sleepQuality);
  setText("recovery_notes", partial.recoveryNotes);
  setText("hydration_level", partial.hydrationLevel);
  setText("daily_water_intake", partial.dailyWaterIntake);
  setText("lifestyle_notes", partial.lifestyleNotes);
  setText("motivation_source", partial.motivationSource);
  setText("recent_life_events", partial.recentLifeEvents);
  setText("mental_wellbeing_goal", partial.mentalWellbeingGoal);
  setText("emotional_wellbeing_notes", partial.emotionalWellbeingNotes);
  setNumber("preferred_meal_count", partial.preferredMealCount);
  if (partial.likedFoods !== undefined && !(skipEmptyFields && partial.likedFoods.length === 0)) {
    update.food_preferences = { liked: partial.likedFoods };
  }
  setArray("disliked_foods", partial.dislikedFoods);
  setArray("allergies", partial.allergies);
  setArray("intolerances", partial.intolerances);
  setText("diet_type", partial.dietType);
  setText("meal_timing_notes", partial.mealTimingNotes);
  setText("work_schedule_notes", partial.workScheduleNotes);
  setText("snacking_notes", partial.snackingNotes);
  setText("hunger_notes", partial.hungerNotes);
  setText("nutrition_notes", partial.nutritionNotes);

  return update;
}

async function writeStudentProfile(
  supabase: TypedSupabaseClient,
  studentId: string,
  update: StudentProfileUpdate,
): Promise<boolean> {
  if (Object.keys(update).length === 0) {
    return true;
  }
  const { data: existing, error: lookupError } = await supabase
    .from("student_profiles")
    .select("id")
    .eq("student_id", studentId)
    .maybeSingle();
  devWarn("writeStudentProfile (lookup)", lookupError);
  if (lookupError) {
    return false;
  }

  if (existing) {
    const { error } = await supabase.from("student_profiles").update(update).eq("student_id", studentId);
    devWarn("writeStudentProfile (update)", error);
    return !error;
  }

  const { error } = await supabase.from("student_profiles").insert({ student_id: studentId, ...update });
  devWarn("writeStudentProfile (insert)", error);
  return !error;
}

/**
 * Sauvegarde finale du questionnaire /onboarding (étape 9 "Valider mon
 * profil") : identité (students), toutes les réponses (student_profiles),
 * un relevé `weight_entries` initial pour le poids actuel, puis
 * `onboarding_completed = true` + `onboarding_completed_at = now()`. Les
 * champs sensibles laissés vides par l'élève sont sauvegardés tels quels
 * (chaîne/tableau vide) — jamais bloquant.
 *
 * `options.healthDataConsent` (chantier conformité juridique/RGPD, lot
 * technique — juillet 2026) : si `true`, écrit une preuve de consentement
 * séparée dans `legal_consents` (voir lib/legal-consents.ts). N'écrit rien
 * si `false`/absent — n'échoue jamais la sauvegarde du reste du
 * questionnaire pour autant, l'absence de consentement n'est pas bloquante
 * ici (le blocage éventuel, si des données de santé sont renseignées, est
 * géré côté UI dans OnboardingWizard.tsx avant même d'arriver ici).
 */
export async function submitOnboarding(
  supabase: TypedSupabaseClient,
  studentId: string,
  submission: StudentOnboardingSubmission,
  options: { healthDataConsent?: boolean } = {},
): Promise<boolean> {
  const studentUpdate: Database["public"]["Tables"]["students"]["Update"] = {
    first_name: submission.firstName,
    last_name: submission.lastName,
    phone: submission.phone,
  };

  const profileUpdate = buildProfileUpdate(submission, false);
  profileUpdate.onboarding_completed = true;
  profileUpdate.onboarding_completed_at = new Date().toISOString();

  const [studentsSuccess, profileSuccess, weightEntrySuccess] = await Promise.all([
    (async () => {
      const { error } = await supabase.from("students").update(studentUpdate).eq("id", studentId);
      devWarn("submitOnboarding (students)", error);
      return !error;
    })(),
    writeStudentProfile(supabase, studentId, profileUpdate),
    addWeightEntry(supabase, studentId, submission.currentWeightKg, "initial" satisfies WeightEntrySource),
  ]);

  const success = studentsSuccess && profileSuccess && weightEntrySuccess;
  if (success) {
    await logActivityEvent(supabase, {
      studentId,
      actorType: "student",
      eventType: "onboarding_completed",
      title: "Onboarding complété",
      description: `${submission.firstName} ${submission.lastName}`.trim() + " a terminé son questionnaire d'onboarding.",
      metadata: buildStudentActivityLink(studentId),
    });
    if (options.healthDataConsent) {
      // Ne bloque jamais la sauvegarde de l'onboarding : une erreur ici est
      // déjà journalisée par insertLegalConsent lui-même.
      await insertLegalConsent(supabase, {
        studentId,
        consentType: "sante_onboarding",
        consentTextVersion: HEALTH_DATA_CONSENT_TEXT_VERSION,
      });
    }
  }
  return success;
}

/**
 * Édition après onboarding (élève depuis /profil, coach depuis
 * /admin/eleves/[studentId]). `skipEmptyFields: true` (coach complétant un
 * questionnaire que l'élève n'a pas fini) omet les champs laissés vides du
 * formulaire plutôt que d'écraser une réponse déjà enregistrée ; l'élève
 * éditant ses propres réponses peut au contraire les vider volontairement
 * (`skipEmptyFields: false`, par défaut). Crée un relevé `weight_entries` si
 * `currentWeightKg` change.
 */
export async function updateStudentOnboardingDetails(
  supabase: TypedSupabaseClient,
  studentId: string,
  partial: Partial<StudentOnboardingSubmission>,
  options: { skipEmptyFields?: boolean; weightEntrySource?: WeightEntrySource } = {},
): Promise<boolean> {
  const { skipEmptyFields = false, weightEntrySource } = options;

  const studentUpdate: Database["public"]["Tables"]["students"]["Update"] = {};
  if (partial.firstName !== undefined && !(skipEmptyFields && partial.firstName.trim() === "")) {
    studentUpdate.first_name = partial.firstName;
  }
  if (partial.lastName !== undefined && !(skipEmptyFields && partial.lastName.trim() === "")) {
    studentUpdate.last_name = partial.lastName;
  }
  if (partial.phone !== undefined && !(skipEmptyFields && partial.phone.trim() === "")) {
    studentUpdate.phone = partial.phone;
  }

  const profileUpdate = buildProfileUpdate(partial, skipEmptyFields);

  const writes: Promise<boolean>[] = [];
  if (Object.keys(studentUpdate).length > 0) {
    writes.push(
      (async () => {
        const { error } = await supabase.from("students").update(studentUpdate).eq("id", studentId);
        devWarn("updateStudentOnboardingDetails (students)", error);
        return !error;
      })(),
    );
  }
  writes.push(writeStudentProfile(supabase, studentId, profileUpdate));

  if (partial.currentWeightKg !== undefined && weightEntrySource) {
    writes.push(addWeightEntry(supabase, studentId, partial.currentWeightKg, weightEntrySource));
  }

  const results = await Promise.all(writes);
  return results.every(Boolean);
}

/** Réponses détaillées existantes de l'élève, ou `null` si pas encore de fiche. */
export async function getStudentOnboardingDetails(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<SupabaseStudentProfile | null> {
  return getStudentProfile(supabase, studentId);
}
