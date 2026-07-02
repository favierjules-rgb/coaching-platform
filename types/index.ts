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
}

export interface TrainingProgram {
  id: string;
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  status: "actif" | "terminé" | "à venir";
}

export interface UpcomingSession {
  id: string;
  name: string;
  day: string;
  time: string;
  durationMinutes: number;
  exerciseCount: number;
}

export interface MealPlan {
  id: string;
  name: string;
  goal: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  status: "actif" | "ancien" | "prochain";
}

export interface DocumentItem {
  id: string;
  title: string;
  type: "pdf" | "vidéo" | "lien" | "image";
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
