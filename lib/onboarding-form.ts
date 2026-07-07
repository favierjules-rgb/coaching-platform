import type { StudentOnboardingSubmission, SupabaseStudentProfile } from "@/types";

/**
 * Sous-ensemble d'identité/coaching commun à `AdminStudent` (admin) et
 * `StudentProfile` (élève, /profil) — pour que `onboardingFormFromProfile`
 * accepte les deux sans dépendre du type mock complet. `phone` et
 * `startWeightKg` sont optionnels car absents de `StudentProfile`.
 */
export interface OnboardingProfileSource {
  firstName: string;
  lastName: string;
  phone?: string;
  age: number;
  heightCm: number;
  currentWeightKg: number;
  startWeightKg?: number;
  targetWeightKg: number;
  goal: string;
  level: string;
  trainingFrequencyPerWeek: number;
  trainingLocation: string;
}

/**
 * State de formulaire (toutes chaînes/tableaux, jamais de nombre brut) pour
 * le questionnaire /onboarding — partagé entre le wizard (app/onboarding) et
 * la vue "Modifier mes informations" / "Voir le questionnaire complet"
 * (profil élève, détail admin) pour ne pas dupliquer le parsing/la
 * validation à trois endroits différents.
 */
export interface OnboardingFormState {
  firstName: string;
  lastName: string;
  phone: string;
  age: string;
  heightCm: string;
  currentWeightKg: string;
  startWeightKg: string;
  targetWeightKg: string;
  mainGoal: string;
  secondaryGoals: string;
  targetTimeframe: string;
  targetDate: string;
  level: string;
  trainingFrequencyPerWeek: string;
  trainingLocation: string;
  neatLevel: string;
  sportsPracticed: string;
  otherActivities: string;
  availableEquipment: string[];
  favoriteGymExercises: string;
  favoriteExercises: string;
  avoidedExercises: string;
  injuries: string;
  trainingNotes: string;
  medicalTreatments: string;
  medications: string;
  healthNotes: string;
  sleepDuration: string;
  sleepQuality: string;
  recoveryNotes: string;
  hydrationLevel: string;
  dailyWaterIntake: string;
  lifestyleNotes: string;
  motivationSource: string;
  recentLifeEvents: string;
  mentalWellbeingGoal: string;
  emotionalWellbeingNotes: string;
  preferredMealCount: string;
  likedFoods: string;
  dislikedFoods: string;
  allergies: string;
  intolerances: string;
  dietType: string;
  mealTimingNotes: string;
  workScheduleNotes: string;
  snackingNotes: string;
  hungerNotes: string;
  nutritionNotes: string;
}

export const emptyOnboardingForm: OnboardingFormState = {
  firstName: "",
  lastName: "",
  phone: "",
  age: "",
  heightCm: "",
  currentWeightKg: "",
  startWeightKg: "",
  targetWeightKg: "",
  mainGoal: "",
  secondaryGoals: "",
  targetTimeframe: "",
  targetDate: "",
  level: "",
  trainingFrequencyPerWeek: "",
  trainingLocation: "",
  neatLevel: "",
  sportsPracticed: "",
  otherActivities: "",
  availableEquipment: [],
  favoriteGymExercises: "",
  favoriteExercises: "",
  avoidedExercises: "",
  injuries: "",
  trainingNotes: "",
  medicalTreatments: "",
  medications: "",
  healthNotes: "",
  sleepDuration: "",
  sleepQuality: "",
  recoveryNotes: "",
  hydrationLevel: "",
  dailyWaterIntake: "",
  lifestyleNotes: "",
  motivationSource: "",
  recentLifeEvents: "",
  mentalWellbeingGoal: "",
  emotionalWellbeingNotes: "",
  preferredMealCount: "",
  likedFoods: "",
  dislikedFoods: "",
  allergies: "",
  intolerances: "",
  dietType: "",
  mealTimingNotes: "",
  workScheduleNotes: "",
  snackingNotes: "",
  hungerNotes: "",
  nutritionNotes: "",
};

export const mainGoalOptions = [
  { value: "", label: "Sélectionner…" },
  { value: "Prise de masse", label: "Prise de masse" },
  { value: "Perte de poids", label: "Perte de poids" },
  { value: "Recomposition corporelle", label: "Recomposition corporelle" },
  { value: "Performance", label: "Performance" },
  { value: "Santé / bien-être", label: "Santé / bien-être" },
  { value: "Autre", label: "Autre" },
];

export const levelOptions = [
  { value: "", label: "Sélectionner…" },
  { value: "Débutant", label: "Débutant" },
  { value: "Intermédiaire", label: "Intermédiaire" },
  { value: "Avancé", label: "Avancé" },
];

export const locationOptions = [
  { value: "", label: "Sélectionner…" },
  { value: "Salle de sport", label: "Salle de sport" },
  { value: "Domicile", label: "Domicile" },
  { value: "Extérieur", label: "Extérieur" },
  { value: "Mixte", label: "Mixte" },
];

export const neatOptions = [
  { value: "", label: "Sélectionner (facultatif)…" },
  { value: "Très faible", label: "Très faible" },
  { value: "Faible", label: "Faible" },
  { value: "Modéré", label: "Modéré" },
  { value: "Élevé", label: "Élevé" },
  { value: "Très élevé", label: "Très élevé" },
];

export const equipmentOptions = [
  "Salle équipée",
  "Haltères",
  "Barre",
  "Élastiques",
  "Banc",
  "Machines",
  "Aucun matériel",
  "Autre",
];

export function parseTags(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRequiredNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function onboardingFormToSubmission(form: OnboardingFormState): StudentOnboardingSubmission {
  const currentWeightKg = parseRequiredNumber(form.currentWeightKg) ?? 0;
  return {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    phone: form.phone.trim(),
    age: parseRequiredNumber(form.age) ?? 0,
    heightCm: parseRequiredNumber(form.heightCm) ?? 0,
    currentWeightKg,
    startWeightKg: parseOptionalNumber(form.startWeightKg),
    targetWeightKg: parseRequiredNumber(form.targetWeightKg) ?? currentWeightKg,
    mainGoal: form.mainGoal.trim(),
    secondaryGoals: parseTags(form.secondaryGoals),
    targetTimeframe: form.targetTimeframe.trim(),
    targetDate: form.targetDate.trim(),
    level: form.level.trim(),
    trainingFrequencyPerWeek: parseRequiredNumber(form.trainingFrequencyPerWeek) ?? 0,
    trainingLocation: form.trainingLocation.trim(),
    neatLevel: form.neatLevel.trim(),
    sportsPracticed: parseTags(form.sportsPracticed),
    otherActivities: parseTags(form.otherActivities),
    availableEquipment: form.availableEquipment,
    favoriteGymExercises: parseTags(form.favoriteGymExercises),
    favoriteExercises: parseTags(form.favoriteExercises),
    avoidedExercises: parseTags(form.avoidedExercises),
    injuries: form.injuries.trim(),
    trainingNotes: form.trainingNotes.trim(),
    medicalTreatments: form.medicalTreatments.trim(),
    medications: form.medications.trim(),
    healthNotes: form.healthNotes.trim(),
    sleepDuration: form.sleepDuration.trim(),
    sleepQuality: form.sleepQuality.trim(),
    recoveryNotes: form.recoveryNotes.trim(),
    hydrationLevel: form.hydrationLevel.trim(),
    dailyWaterIntake: form.dailyWaterIntake.trim(),
    lifestyleNotes: form.lifestyleNotes.trim(),
    motivationSource: form.motivationSource.trim(),
    recentLifeEvents: form.recentLifeEvents.trim(),
    mentalWellbeingGoal: form.mentalWellbeingGoal.trim(),
    emotionalWellbeingNotes: form.emotionalWellbeingNotes.trim(),
    preferredMealCount: parseOptionalNumber(form.preferredMealCount),
    likedFoods: parseTags(form.likedFoods),
    dislikedFoods: parseTags(form.dislikedFoods),
    allergies: parseTags(form.allergies),
    intolerances: parseTags(form.intolerances),
    dietType: form.dietType.trim(),
    mealTimingNotes: form.mealTimingNotes.trim(),
    workScheduleNotes: form.workScheduleNotes.trim(),
    snackingNotes: form.snackingNotes.trim(),
    hungerNotes: form.hungerNotes.trim(),
    nutritionNotes: form.nutritionNotes.trim(),
  };
}

export function canProceedFromStep(step: number, form: OnboardingFormState): boolean {
  if (step === 1) {
    return (
      form.firstName.trim() !== "" &&
      form.lastName.trim() !== "" &&
      parseRequiredNumber(form.age) !== null &&
      parseRequiredNumber(form.heightCm) !== null &&
      parseRequiredNumber(form.currentWeightKg) !== null &&
      parseRequiredNumber(form.targetWeightKg) !== null
    );
  }
  if (step === 2) {
    return form.mainGoal.trim() !== "";
  }
  if (step === 3) {
    return (
      form.level.trim() !== "" &&
      parseRequiredNumber(form.trainingFrequencyPerWeek) !== null &&
      form.trainingLocation.trim() !== ""
    );
  }
  return true;
}

/**
 * Pré-remplit le formulaire d'édition depuis les données déjà en base
 * (student + student_profiles) — utilisé par "Modifier mes informations"
 * (/profil) et "Compléter le questionnaire" (admin), jamais par le wizard
 * initial qui démarre toujours d'un formulaire vide.
 */
export function onboardingFormFromProfile(
  student: OnboardingProfileSource,
  profile: SupabaseStudentProfile | null,
): OnboardingFormState {
  return {
    firstName: student.firstName,
    lastName: student.lastName,
    phone: student.phone ?? "",
    age: student.age > 0 ? String(student.age) : "",
    heightCm: student.heightCm > 0 ? String(student.heightCm) : "",
    currentWeightKg: student.currentWeightKg > 0 ? String(student.currentWeightKg) : "",
    startWeightKg: student.startWeightKg && student.startWeightKg > 0 ? String(student.startWeightKg) : "",
    targetWeightKg: student.targetWeightKg > 0 ? String(student.targetWeightKg) : "",
    mainGoal: student.goal,
    secondaryGoals: (profile?.secondaryGoals ?? []).join(", "),
    targetTimeframe: profile?.targetTimeframe ?? "",
    targetDate: profile?.targetDate ?? "",
    level: student.level,
    trainingFrequencyPerWeek: student.trainingFrequencyPerWeek > 0 ? String(student.trainingFrequencyPerWeek) : "",
    trainingLocation: student.trainingLocation,
    neatLevel: profile?.neatLevel ?? "",
    sportsPracticed: (profile?.sportsPracticed ?? []).join(", "),
    otherActivities: (profile?.otherActivities ?? []).join(", "),
    availableEquipment: profile?.availableEquipment ?? [],
    favoriteGymExercises: (profile?.favoriteGymExercises ?? []).join(", "),
    favoriteExercises: (profile?.favoriteExercises ?? []).join(", "),
    avoidedExercises: (profile?.avoidedExercises ?? []).join(", "),
    injuries: profile?.onboardingInjuries ?? "",
    trainingNotes: profile?.trainingNotes ?? "",
    medicalTreatments: profile?.medicalTreatments ?? "",
    medications: profile?.medications ?? "",
    healthNotes: profile?.healthNotes ?? "",
    sleepDuration: profile?.sleepDuration ?? "",
    sleepQuality: profile?.sleepQuality ?? "",
    recoveryNotes: profile?.recoveryNotes ?? "",
    hydrationLevel: profile?.hydrationLevel ?? "",
    dailyWaterIntake: profile?.dailyWaterIntake ?? "",
    lifestyleNotes: profile?.lifestyleNotes ?? "",
    motivationSource: profile?.motivationSource ?? "",
    recentLifeEvents: profile?.recentLifeEvents ?? "",
    mentalWellbeingGoal: profile?.mentalWellbeingGoal ?? "",
    emotionalWellbeingNotes: profile?.emotionalWellbeingNotes ?? "",
    preferredMealCount: profile?.preferredMealCount ? String(profile.preferredMealCount) : "",
    likedFoods: (profile?.foodPreferences.liked ?? []).join(", "),
    dislikedFoods: (profile?.dislikedFoods ?? []).join(", "),
    allergies: (profile?.allergies ?? []).join(", "),
    intolerances: (profile?.intolerances ?? []).join(", "),
    dietType: profile?.dietType ?? "",
    mealTimingNotes: profile?.mealTimingNotes ?? "",
    workScheduleNotes: profile?.workScheduleNotes ?? "",
    snackingNotes: profile?.snackingNotes ?? "",
    hungerNotes: profile?.hungerNotes ?? "",
    nutritionNotes: profile?.nutritionNotes ?? "",
  };
}
