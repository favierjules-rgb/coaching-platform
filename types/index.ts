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

export interface DayCalorieTarget {
  day: string;
  isToday?: boolean;
  calories: number;
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
