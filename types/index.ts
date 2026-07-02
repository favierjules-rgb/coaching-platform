import type { LucideIcon } from "lucide-react";

export interface NavLink {
  label: string;
  href: string;
}

export interface MethodPillar {
  icon: LucideIcon;
  title: string;
  description: string;
}

export interface Transformation {
  id: string;
  name: string;
  duration: string;
  goal: string;
  quote: string;
}

export interface NewsletterGoalOption {
  value: string;
  label: string;
}

export type UserRole = "visitor" | "student" | "admin";

export interface StudentProfile {
  id: string;
  firstName: string;
  lastName: string;
  goal: string;
  level: string;
  startDate: string;
  weekNumber: number;
  age: number;
  heightCm: number;
  currentWeightKg: number;
}

export type ProgramStatus = "actif" | "terminé" | "à venir";

export interface ProgramScheduleDay {
  day: string;
  isToday?: boolean;
  sessionId: string | null;
}

export interface TrainingProgram {
  id: string;
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  status: ProgramStatus;
  sessionsPerWeek: number;
  currentWeek: number;
  progressPercent: number;
  schedule: ProgramScheduleDay[];
}

export interface UpcomingSession {
  id: string;
  name: string;
  day: string;
  time: string;
  durationMinutes: number;
  exerciseCount: number;
}

export interface Exercise {
  id: string;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  tempo: string;
  recommendedLoad: string;
  videoUrl: string;
}

export interface WorkoutSession {
  id: string;
  programId: string;
  day: string;
  name: string;
  muscleGroups: string;
  durationMinutes: number;
  warmup: string;
  exercises: Exercise[];
  coachNotes: string;
}

/**
 * Retour élève pour une série d'un exercice. Forme prête pour une future
 * table Supabase `exercise_set_feedback` (une ligne par série renseignée).
 */
export interface ExerciseSetFeedback {
  studentId: string;
  sessionId: string;
  exerciseId: string;
  setNumber: number;
  loadUsed: string;
  repsDone: string;
}

/**
 * Retour élève pour un exercice complet de la séance (regroupe les séries
 * + le ressenti sur cet exercice). Correspond à une future table Supabase
 * `exercise_feedback`, liée à `exercise_set_feedback` par exerciseId.
 */
export interface ExerciseFeedback {
  studentId: string;
  sessionId: string;
  exerciseId: string;
  sets: ExerciseSetFeedback[];
  rpe: number | null;
  comment: string;
}

/**
 * Retour élève global pour une séance entière. Correspond à une future
 * table Supabase `workout_feedback`, liée à `exercise_feedback` par
 * sessionId + studentId.
 */
export interface WorkoutFeedback {
  studentId: string;
  sessionId: string;
  completed: boolean;
  exercises: ExerciseFeedback[];
  globalRpe: number | null;
  globalComment: string;
  pain: string;
  submittedAt: string;
}

export type MealPlanStatus = "actif" | "ancien" | "prochain";

export interface MealPlan {
  id: string;
  name: string;
  goal: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  status: MealPlanStatus;
}

export type MealSlot =
  | "Petit déjeuner"
  | "Collation matin"
  | "Midi"
  | "Collation après-midi"
  | "Dîner"
  | "Compléments";

export interface Meal {
  slot: MealSlot;
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface HydrationAndSupplements {
  waterTarget: string;
  supplements: string[];
  tipOfTheDay: string;
}

export type DocumentCategory = "nutrition" | "entrainement" | "administratif";
export type DocumentType = "pdf" | "vidéo" | "lien" | "guide";

export interface DocumentItem {
  id: string;
  title: string;
  description: string;
  type: DocumentType;
  category: DocumentCategory;
  addedAt: string;
}

export interface WeightEntry {
  month: string;
  kg: number;
}

export interface CoachNotification {
  id: string;
  message: string;
  time: string;
  unread: boolean;
}

export interface BodyMeasurements {
  waist: number;
  hips: number;
  chest: number;
  arm: number;
  thigh: number;
  calf: number;
}

export interface FoodPreferences {
  liked: string[];
  disliked: string[];
  intolerances: string[];
  diet: string;
  mealsPerDay: number;
}

export interface SportPreferences {
  mainGoal: string;
  sports: string[];
  injuries: string;
  equipment: string[];
  location: string;
  sessionsPerWeek: number;
}

/* ─── Budget calorique hebdomadaire (Nutrition) ───
 * Types préparés pour une future persistance Supabase : chaque enregistrement
 * porte déjà ses clés de liaison (studentId, planId, dayId, weekStartDate).
 */

export type NutritionGoalType =
  | "perte-de-poids"
  | "maintien"
  | "prise-de-masse"
  | "performance";

export interface MacroTarget {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MacroActual {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealFoodItem {
  name: string;
  quantity: string;
}

export interface PlannedMeal {
  id: string;
  planId: string;
  dayId: string;
  slot: MealSlot;
  name: string;
  items: MealFoodItem[];
  macros: MacroTarget;
  coachNotes: string;
}

export type NutritionDayStatus = "non-commence" | "en-cours" | "valide";

/**
 * Saisie manuelle de l'élève pour une journée. Forme prête pour une future
 * table Supabase `actual_daily_intake` (une ligne par journée validée).
 */
export interface ActualDailyIntake {
  studentId: string;
  planId: string;
  dayId: string;
  macros: MacroActual;
  comment: string;
  hunger: string;
  energy: string;
  digestion: string;
  validatedAt: string;
}

export interface NutritionDay {
  id: string;
  planId: string;
  weekStartDate: string;
  day: string;
  isToday?: boolean;
  status: NutritionDayStatus;
  target: MacroTarget;
  meals: PlannedMeal[];
  actual: ActualDailyIntake | null;
}

/**
 * Plan alimentaire complet, avec sa semaine type (Lundi → Dimanche).
 * Correspond à une future table Supabase `nutrition_plan`, reliée à
 * `nutrition_day` par planId.
 */
export interface NutritionPlan {
  id: string;
  studentId: string;
  name: string;
  goalType: NutritionGoalType;
  dailyTarget: MacroTarget;
  weeklyTargetCalories: number;
  status: MealPlanStatus;
  shoppingList: string[];
  days: NutritionDay[];
}

/**
 * Vue calculée du budget calorique de la semaine. Pourrait correspondre à
 * une vue matérialisée Supabase (`weekly_nutrition_summary`) recalculée à
 * chaque validation de journée.
 */
export interface WeeklyNutritionSummary {
  studentId: string;
  planId: string;
  weekStartDate: string;
  weeklyTargetCalories: number;
  consumedCalories: number;
  remainingCalories: number;
  daysValidated: number;
  daysRemaining: number;
  recommendedDailyAverage: number;
}

export type NutritionAdjustmentTone =
  | "no-data"
  | "on-track"
  | "over"
  | "under"
  | "week-complete";

/**
 * Recommandation affichée dans la carte "Ajustement semaine", dérivée du
 * WeeklyNutritionSummary. Porte ses propres clés de liaison pour pouvoir,
 * plus tard, journaliser les recommandations envoyées à l'élève.
 */
export interface NutritionAdjustment {
  studentId: string;
  planId: string;
  weekStartDate: string;
  tone: NutritionAdjustmentTone;
  message: string;
  summary: WeeklyNutritionSummary;
}
