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

export type CoachingStatus = "actif" | "pause" | "terminé";

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
  targetWeightKg: number;
  trainingFrequencyPerWeek: number;
  trainingLocation: string;
  coachingStatus: CoachingStatus;
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
export type DocumentType = "pdf" | "vidéo" | "lien" | "guide" | "image";

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

export type BodyMeasurementUnit = "cm" | "kg";

export type BodyMeasurementType =
  | "poids"
  | "cou"
  | "epaules"
  | "poitrine"
  | "taille"
  | "nombril"
  | "hanches"
  | "bras-droit"
  | "bras-gauche"
  | "avant-bras-droit"
  | "avant-bras-gauche"
  | "cuisse-droite"
  | "cuisse-gauche"
  | "mollet-droit"
  | "mollet-gauche";

/**
 * Une mensuration suivie dans le temps. `id` correspond au futur
 * measurementId d'une table Supabase `body_measurement` (une ligne par type
 * de mensuration et par élève, mise à jour à chaque relevé).
 */
export interface BodyMeasurement {
  id: string;
  studentId: string;
  type: BodyMeasurementType;
  unit: BodyMeasurementUnit;
  startValue: number;
  currentValue: number;
  note: string;
  lastUpdatedAt: string;
}

/**
 * Mesure personnalisée définie librement par l'élève (ex: "Tour de
 * cheville"). Correspond à une future table Supabase `custom_measurement`,
 * distincte de `body_measurement` car le type/l'unité ne sont pas fixés à
 * l'avance.
 */
export interface CustomMeasurement {
  id: string;
  studentId: string;
  name: string;
  unit: string;
  startValue: number;
  currentValue: number;
  note: string;
  lastUpdatedAt: string;
}

export interface FoodPreferences {
  studentId: string;
  liked: string[];
  disliked: string[];
  intolerances: string[];
  allergies: string[];
  diet: string;
  mealsPerDay: number;
  mealTimes: string[];
  socialConstraints: string;
  updatedAt: string;
}

export interface SportPreferences {
  studentId: string;
  mainGoal: string;
  sports: string[];
  equipment: string[];
  location: string;
  sessionsPerWeek: number;
  preferredExercises: string[];
  exercisesToAvoid: string[];
  weeklyAvailability: string[];
  updatedAt: string;
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

/* ─── Bibliothèque de documents ───
 * Types préparés pour une future persistance Supabase : DocumentResource
 * correspondrait à une table `document_resource`, StudentDocumentAccess à
 * une table de liaison `student_document_access` (clé composite
 * studentId + documentId) qui porte le viewedAt par élève — un même
 * document assigné à plusieurs élèves peut donc être "nouveau" pour l'un
 * et "consulté" pour l'autre.
 */

/** Dérivé de StudentDocumentAccess.viewedAt : jamais consulté vs consulté. */
export type DocumentStatus = "nouveau" | "consulté";

export interface DocumentResource {
  id: string;
  title: string;
  description: string;
  type: DocumentType;
  category: DocumentCategory;
  createdAt: string;
  important: boolean;
  assignedStudentIds: string[];
  previewContent: string;
  fileUrl?: string;
  videoUrl?: string;
  externalUrl?: string;
  relatedDocumentIds: string[];
}

export interface StudentDocumentAccess {
  studentId: string;
  documentId: string;
  viewedAt: string | null;
}

/* ─── Profil élève ───
 * Types préparés pour une future persistance Supabase : chaque enregistrement
 * porte déjà studentId (et updatedAt le cas échéant) pour correspondre
 * directement à de futures tables (progress_photo, body_measurement déjà
 * défini plus haut, food_preference, sport_preference, injury_note,
 * student_goal...).
 */

export type ProgressPhotoType = "avant" | "actuelle" | "objectif" | "mensuelle";

/**
 * Photo de progression. `imageUrl` est une URL objet locale
 * (URL.createObjectURL) tant qu'aucun backend n'est connecté ; `storagePath`
 * est préparé pour recevoir le chemin retourné par Supabase Storage une fois
 * l'upload réel branché (photoId = id).
 */
export interface ProgressPhoto {
  id: string;
  studentId: string;
  type: ProgressPhotoType;
  date: string;
  weightKg: number | null;
  note: string;
  imageUrl: string | null;
  storagePath: string | null;
  pending: boolean;
}

/**
 * Notes blessures/contraintes d'un élève. Correspond à une future table
 * Supabase `injury_note` (une ligne par élève, mise à jour par le coach
 * et/ou l'élève).
 */
export interface InjuryNote {
  studentId: string;
  currentInjuries: string[];
  pastInjuries: string[];
  recurringPain: string[];
  movementsToAvoid: string[];
  coachRemarks: string;
  updatedAt: string;
}

export type GoalPriority = "haute" | "moyenne" | "basse";

export type GoalIndicator =
  | "poids"
  | "mensurations"
  | "photos"
  | "performance"
  | "énergie"
  | "digestion"
  | "sommeil";

/**
 * Objectifs de l'élève. Correspond à une future table Supabase
 * `student_goal` (une ligne par élève, éditable par le coach).
 */
export interface StudentGoal {
  studentId: string;
  mainGoal: string;
  secondaryGoals: string[];
  targetDate: string;
  priority: GoalPriority;
  trackedIndicators: GoalIndicator[];
  updatedAt: string;
}

/* ─── Interface admin coach ───
 * Types mockés pour l'espace /admin, tenus séparés du modèle élève
 * (types/index.ts ci-dessus) car l'admin gère une liste de plusieurs
 * élèves fictifs plutôt qu'un seul élève connecté. Chaque entité porte
 * déjà id (+ studentId le cas échéant) et createdAt/updatedAt pour
 * correspondre directement à de futures tables Supabase ; les relations
 * many-to-many (contenu ↔ élèves) sont représentées des deux côtés
 * (assignedStudentIds sur le contenu, assignedProgramIds/... sur
 * l'élève) — pratique en mock, et prête à devenir une vraie table de
 * liaison (`assignment`) plus tard.
 */

export type AdminContentStatus = "brouillon" | "actif" | "archivé";
export type AdminDocumentStatus = "brouillon" | "publié" | "archivé";

/**
 * Note privée du coach sur un élève. Correspond à une future table
 * Supabase `coach_note`.
 */
export interface CoachNote {
  id: string;
  studentId: string;
  text: string;
  createdAt: string;
}

export interface AdminFoodPreferences {
  liked: string[];
  disliked: string[];
  intolerances: string[];
  diet: string;
}

export interface AdminSportPreferences {
  sports: string[];
  equipment: string[];
  preferredExercises: string[];
  exercisesToAvoid: string[];
}

export interface AdminProgressPhoto {
  id: string;
  date: string;
  weightKg: number | null;
  note: string;
}

export interface AdminBodyMeasurement {
  label: string;
  startValueCm: number;
  currentValueCm: number;
}

/**
 * Fiche élève côté admin. Correspond à une future table Supabase
 * `student` (le compte élève lui-même, distinct du profil élève détaillé
 * qu'il édite dans /profil).
 */
export interface AdminStudent {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  age: number;
  heightCm: number;
  currentWeightKg: number;
  startWeightKg: number;
  targetWeightKg: number;
  goal: string;
  level: string;
  trainingFrequencyPerWeek: number;
  trainingLocation: string;
  status: StudentAccountStatus;
  startDate: string;
  lastLoginAt: string | null;
  foodPreferences: AdminFoodPreferences;
  sportPreferences: AdminSportPreferences;
  injuries: string;
  measurements: AdminBodyMeasurement[];
  progressPhotos: AdminProgressPhoto[];
  assignedProgramIds: string[];
  assignedNutritionPlanIds: string[];
  assignedDocumentIds: string[];
  coachNotes: CoachNote[];
  createdAt: string;
  updatedAt: string;
}

export type StudentAccountStatus = "actif" | "pause" | "terminé";

export type AdminRepsValue = string; // "8" | "8-10" | "12-15" | "AMRAP" ...

export interface AdminExercise {
  id: string;
  order: number;
  name: string;
  sets: number;
  reps: AdminRepsValue;
  restSeconds: number;
  tempo: string;
  recommendedLoad: string;
  videoUrl: string;
  notes: string;
}

export interface AdminWorkoutSession {
  id: string;
  programId: string;
  weekNumber: number;
  day: string;
  isRestDay: boolean;
  name: string;
  muscleGroup: string;
  durationMinutes: number;
  warmup: string;
  coachNotes: string;
  exercises: AdminExercise[];
}

/**
 * Programme d'entraînement créé par le coach. Correspond à une future
 * table Supabase `program`, reliée à `workout_session` par programId.
 */
export interface AdminProgram {
  id: string;
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  description: string;
  status: AdminContentStatus;
  assignedStudentIds: string[];
  sessions: AdminWorkoutSession[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminMealFoodItem {
  name: string;
  quantity: string;
}

export interface AdminMeal {
  id: string;
  slot: MealSlot;
  name: string;
  items: AdminMealFoodItem[];
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  coachNotes: string;
}

export interface AdminNutritionDay {
  id: string;
  planId: string;
  day: string;
  meals: AdminMeal[];
}

/**
 * Plan alimentaire créé par le coach. Correspond à une future table
 * Supabase `nutrition_plan_admin`, reliée à `nutrition_day` par planId.
 * Reste compatible avec la logique élève déjà en place (objectif
 * hebdomadaire, validation journée, calories restantes) : caloriesPerDay
 * et weeklyTargetCalories jouent le même rôle que dailyTarget /
 * weeklyTargetCalories côté NutritionPlan élève.
 */
export interface AdminNutritionPlan {
  id: string;
  name: string;
  goalType: NutritionGoalType;
  caloriesPerDay: number;
  protein: number;
  carbs: number;
  fat: number;
  weeklyTargetCalories: number;
  status: AdminContentStatus;
  coachNotes: string;
  hydrationTip: string;
  supplements: string[];
  shoppingList: string[];
  days: AdminNutritionDay[];
  assignedStudentIds: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Document/ressource géré par le coach. Correspond à une future table
 * Supabase `document_resource_admin` ; fileName/storagePath préparés pour
 * Supabase Storage (fileName = nom mocké choisi dans l'input file,
 * storagePath = chemin réel une fois l'upload branché).
 */
export interface AdminDocument {
  id: string;
  title: string;
  type: DocumentType;
  category: DocumentCategory;
  shortDescription: string;
  fullDescription: string;
  externalUrl: string;
  fileName: string | null;
  storagePath: string | null;
  status: AdminDocumentStatus;
  important: boolean;
  assignedStudentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type FeedbackType = "entrainement" | "nutrition" | "profil";
export type FeedbackStatus = "a-traiter" | "traité" | "important";

export interface AdminExerciseFeedbackEntry {
  exerciseName: string;
  setNumber: number;
  loadUsed: string;
  repsDone: string;
  rpe: number | null;
  comment: string;
}

/**
 * Retour élève consolidé côté admin (entraînement, nutrition ou profil).
 * Correspond à une future table Supabase `student_feedback` ; les détails
 * par exercice restent une sous-liste (exerciseEntries) plutôt qu'une
 * table séparée pour rester simple en mock.
 */
export interface AdminStudentFeedback {
  id: string;
  studentId: string;
  type: FeedbackType;
  refLabel: string;
  date: string;
  rpe: number | null;
  pain: string;
  comment: string;
  exerciseEntries: AdminExerciseFeedbackEntry[];
  status: FeedbackStatus;
  coachReply: string;
  createdAt: string;
  updatedAt: string;
}

export type AssignableContentType = "programme" | "nutrition" | "document";

/**
 * Représentation "à plat" d'une assignation contenu ↔ élève, dérivée des
 * tableaux assignedStudentIds / assigned*Ids. Prête à devenir une vraie
 * table de liaison Supabase `assignment` (studentId + contentType +
 * contentId comme clé composite) le jour où les deux tableaux ne seront
 * plus tenus manuellement en synchronisation côté client.
 */
export interface AdminAssignment {
  id: string;
  studentId: string;
  contentType: AssignableContentType;
  contentId: string;
  assignedAt: string;
}

/**
 * Paramètres du coach / de la marque, éditables sur /admin/parametres.
 * Correspond à une future table Supabase `coach_settings` (une ligne par
 * coach).
 */
export interface AdminCoachSettings {
  coachName: string;
  brandName: string;
  email: string;
  accentColor: string;
  compactDisplay: boolean;
  siteStatus: "en ligne" | "maintenance";
  mockVersion: string;
}
