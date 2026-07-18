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

/* ─── Authentification (Supabase Auth) ───
 * Types côté application pour l'authentification et les rôles, distincts
 * du schéma SQL brut (voir supabase/schema.sql, table `profiles`, et
 * types/supabase.ts pour la forme exacte des lignes retournées par le
 * client Supabase) — lib/supabase/auth.ts fait la conversion entre les
 * deux (snake_case DB -> camelCase ici).
 */
export type UserRole = "admin" | "coach" | "student";

/** Correspond à une ligne de la table Supabase `profiles`. */
export interface AuthProfile {
  id: string;
  userId: string;
  role: UserRole;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  createdAt: string;
  updatedAt: string;
}

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
  /** Photo bannière (V3, chantier module Programmation étape 4) — voir AdminProgram.bannerUrl. */
  bannerUrl?: string | null;
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
  /**
   * Groupe musculaire ciblé par cet exercice précis (voir MuscleGroup dans
   * lib/training-metrics.ts). Optionnel : si absent, l'analyse de charge
   * retombe sur le muscleGroups de la séance parente.
   */
  muscleGroup?: string;
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
  /**
   * Type de séance et blocs cardio (V3), passés tels quels depuis
   * AdminWorkoutSession par toEleveWorkoutSession (voir
   * lib/training-schedule.ts) — réutilise directement SessionType/
   * AdminCardioBlock plutôt que dupliquer ces types côté élève. Optionnels
   * pour rester compatibles avec les séances mock/anciennes qui n'ont pas ce
   * champ ; voir components/student/CardioBlocksSection.tsx pour l'affichage.
   */
  sessionType?: SessionType;
  cardioBlocks?: AdminCardioBlock[];
  /** Photo bannière (V3, chantier module Programmation étape 4) — voir AdminWorkoutSession.bannerUrl. */
  bannerUrl?: string | null;
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
  exerciseName: string;
  sets: ExerciseSetFeedback[];
  rpe: number | null;
  comment: string;
}

/**
 * Retour élève global pour une séance entière. Correspond à une future
 * table Supabase `workout_feedback`, liée à `exercise_feedback` par
 * sessionId + studentId. Persisté en mock dans le même localStorage que le
 * reste de l'espace admin (voir AdminStudentFeedback plus bas, converti
 * depuis ce type au moment de l'envoi) pour que le retour saisi par
 * l'élève apparaisse immédiatement dans /admin/retours.
 */
export interface StudentWorkoutFeedback {
  id: string;
  studentId: string;
  sessionId: string;
  programId: string | null;
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
export type DocumentType = "pdf" | "vidéo" | "lien" | "guide" | "image" | "texte";
/** "global" : visible de tout élève actif dès publié, sans assignation. "assigned" : visible seulement des élèves assignés. */
export type DocumentVisibility = "global" | "assigned";

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

/**
 * Un relevé daté d'une mensuration (préréglée ou personnalisée). Complète
 * BodyMeasurement/CustomMeasurement — qui ne gardent que la valeur de
 * départ et la valeur actuelle — par un vrai journal chronologique, pour
 * l'affichage "Historique" et une future table Supabase `measurement_log`.
 * `key` vaut le BodyMeasurementType pour une mensuration préréglée, ou l'id
 * de la CustomMeasurement pour une mesure personnalisée.
 */
export interface MeasurementLogEntry {
  id: string;
  studentId: string;
  key: string;
  label: string;
  value: number;
  unit: string;
  measuredAt: string;
  note: string;
  createdAt: string;
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
  /**
   * Niveau de déblocage progressif (voir DocumentDistributionMode côté
   * admin) : level 1 dispo dès le début du coaching, puis un niveau de
   * plus tous les `unlockIntervalWeeks` (voir lib/documents.ts).
   */
  level: number;
  distributionMode: DocumentDistributionMode;
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
 * Angle de prise de vue (chantier "supabase-progress-photos-before-after-export").
 * Distinct de ProgressPhotoType ci-dessus, qui reste le *rôle* de la photo
 * (avant/actuelle/objectif/mensuelle) — les deux colonnes coexistent, voir
 * docs/supabase-progress-photos-before-after-export-model.md.
 */
export type ProgressPhotoAngle = "face" | "profil" | "dos" | "autre";

export type ProgressPhotoStatus = "active" | "archived";

/**
 * Photo de progression. `imageUrl` est une URL objet locale
 * (URL.createObjectURL) tant qu'aucun backend n'est connecté ; `storagePath`
 * est préparé pour recevoir le chemin retourné par Supabase Storage une fois
 * l'upload réel branché (photoId = id).
 *
 * Les champs ci-dessous (photoType → updatedAt) sont optionnels : ajoutés
 * par le chantier "supabase-progress-photos-before-after-export" pour le
 * vrai upload Storage + comparaison avant/après, sans casser les usages
 * existants (mock data/admin.ts, data/student.ts, AddProgressPhotoModal...)
 * qui ne les renseignent pas.
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
  photoType?: ProgressPhotoAngle;
  uploadedBy?: string | null;
  fileName?: string | null;
  fileSizeBytes?: number | null;
  fileMimeType?: string | null;
  isBeforeCandidate?: boolean;
  isAfterCandidate?: boolean;
  status?: ProgressPhotoStatus;
  createdAt?: string;
  updatedAt?: string;
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

/**
 * Fiche élève côté admin. Correspond à une future table Supabase
 * `student` (le compte élève lui-même, distinct du profil élève détaillé
 * qu'il édite dans /profil).
 *
 * measurements/customMeasurements/progressPhotos/weightHistory réutilisent
 * volontairement les mêmes types que le profil élève (BodyMeasurement,
 * CustomMeasurement, ProgressPhoto, WeightEntry) plutôt que d'en dupliquer
 * une version admin : quand un élève admin correspond au compte élève
 * connecté (même id que StudentProfile.id), ces données sont lues/écrites
 * via le même hook useStudentProfile et le même localStorage, donc une
 * modification admin apparaît immédiatement dans /profil.
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
  weightHistory: WeightEntry[];
  measurements: BodyMeasurement[];
  customMeasurements: CustomMeasurement[];
  measurementHistory: MeasurementLogEntry[];
  progressPhotos: ProgressPhoto[];
  /** Fiche paiement mockée de l'élève (voir StudentPaymentProfile plus bas). */
  paymentProfile: StudentPaymentProfile;
  assignedProgramIds: string[];
  assignedNutritionPlanIds: string[];
  assignedDocumentIds: string[];
  coachNotes: CoachNote[];
  createdAt: string;
  updatedAt: string;
  /**
   * Type d'accès (chantier module Programmation, étape 6) : "coaching"
   * (défaut, comportement historique — accès complet) ou "programme_seul"
   * (compte auto-créé après achat/réclamation d'un programme public sur la
   * home page — accès restreint à /entrainement uniquement, voir
   * lib/supabase/guards.ts). Optionnel : absent = "coaching" en mock.
   */
  accessType?: "coaching" | "programme_seul";
}

export type StudentAccountStatus = "actif" | "pause" | "terminé";

/* ─── Paiement élève (admin) ───
 * Types mockés (aucun paiement réel, aucune donnée bancaire) préparés pour
 * une future intégration Supabase + prestataire de paiement : chaque
 * entité porte déjà studentId/paymentId et createdAt/updatedAt.
 */

export type PaymentStatus = "à jour" | "en attente" | "en retard" | "terminé";

export type PaymentMethod = "virement" | "carte" | "espèces" | "chèque" | "autre";

/**
 * Historique d'un versement reçu pour le coaching d'un élève. Correspond à
 * une future table Supabase `student_payment_entry`.
 */
export interface StudentPaymentEntry {
  paymentId: string;
  studentId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  note: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fiche paiement d'un élève (une par élève) : offre souscrite, prix,
 * échéancier et statut global. Correspond à une future table Supabase
 * `student_payment_profile`, reliée à `student_payment_entry` par
 * studentId. Toutes les données ici sont mockées à des fins de
 * démonstration — aucun paiement réel n'est traité.
 */
export interface StudentPaymentProfile {
  studentId: string;
  offerName: string;
  monthlyPriceEuros: number;
  durationMonths: number;
  totalPriceEuros: number;
  paidAmountEuros: number;
  status: PaymentStatus;
  method: PaymentMethod;
  nextPaymentDate: string | null;
  installmentsTotal: number;
  installmentsPaid: number;
  entries: StudentPaymentEntry[];
  createdAt: string;
  updatedAt: string;
}

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
  /**
   * Groupe musculaire ciblé par cet exercice précis (voir MuscleGroup dans
   * lib/training-metrics.ts). Optionnel : si absent, l'analyse de charge
   * retombe sur le muscleGroup de la séance parente.
   */
  muscleGroup?: string;
  /**
   * Référence vers l'exercice de la banque (`exercise_library`) dont cet
   * exercice de séance a été créé, s'il y en a une — voir
   * lib/supabase/exercise-library.ts. Les champs ci-dessus restent copiés
   * par valeur (nom, vidéo, groupe musculaire...) et modifiables librement
   * pour ce programme précis, sans jamais être réécrits par une future
   * modification de l'exercice source dans la banque. Absente pour tout
   * exercice créé en texte libre ou avant ce chantier.
   */
  libraryExerciseId?: string;
}

/** Type de séance (V3 cardio) — voir workout_sessions.session_type. */
export type SessionType = "strength" | "cardio" | "mixed";

/**
 * Type de cardio d'un bloc (training_blocks.cardio_type — voir migration
 * 20260716_training_v3_cardio_foundation.sql pour la liste exacte des 21
 * valeurs autorisées côté base).
 */
export type CardioType =
  | "continuous_run"
  | "easy_run"
  | "long_run"
  | "tempo_run"
  | "threshold_intervals"
  | "vma_intervals"
  | "short_intervals"
  | "long_intervals"
  | "fartlek"
  | "hill_repeats"
  | "sprint_repeats"
  | "run_walk"
  | "warmup_run"
  | "cooldown_run"
  | "race_pace"
  | "time_trial"
  | "vma_test"
  | "luc_leger"
  | "hyrox_run"
  | "cardio_machine"
  | "custom_cardio";

/** Machine cardio de salle (training_blocks.machine_type), pertinent seulement si cardioType = "cardio_machine". */
export type MachineType = "treadmill" | "bike" | "rower" | "skierg" | "elliptical" | "air_bike" | "stepper" | "other";

/**
 * Type de segment cardio stocké en base (training_prescriptions.segment_type
 * autorise aussi "work"/"recovery" pour un usage futur plus fin — voir
 * migration V3). Ce builder ne génère volontairement que ces 4 valeurs :
 * un "repeat_group" porte lui-même ses champs travail/récupération
 * (repetitions + durée/distance de travail + durée/distance de
 * récupération) plutôt que des lignes enfants "work"/"recovery" séparées,
 * pour un formulaire simple à éditer côté coach.
 */
export type CardioSegmentType = "single" | "repeat_group" | "ramp_up" | "ramp_down";

/** Type d'intensité ciblée d'un segment (training_prescriptions.intensity_target_type). */
export type IntensityTargetType =
  | "vma_percentage"
  | "speed_kmh"
  | "pace"
  | "heart_rate_zone"
  | "heart_rate_percentage"
  | "rpe"
  | "power"
  | "race_pace"
  | "free"
  | "custom";

/**
 * Segment d'un bloc cardio (training_prescriptions avec block_id renseigné
 * et exercise_id nul — voir lib/supabase/programs.ts). Un segment "single",
 * "ramp_up" ou "ramp_down" décrit un effort continu (durationSeconds et/ou
 * distanceMeters) ; un "repeat_group" décrit un fractionné répété
 * `repetitions` fois : effort (durationSeconds/distanceMeters) puis
 * récupération (recoveryDurationSeconds/recoveryDistanceMeters).
 */
export interface AdminCardioSegment {
  id: string;
  order: number;
  segmentType: CardioSegmentType;
  title: string;
  repetitions?: number;
  durationSeconds?: number;
  distanceMeters?: number;
  elevationGainMeters?: number;
  inclinePercentage?: number;
  recoveryDurationSeconds?: number;
  recoveryDistanceMeters?: number;
  intensityTargetType: IntensityTargetType;
  targetVmaPercentage?: number;
  targetSpeedKmh?: number;
  targetPaceSecondsPerKm?: number;
  targetHrPercentage?: number;
  targetHrZone?: string;
  targetPowerWatts?: number;
  targetCadence?: number;
  intensityMin?: number;
  intensityMax?: number;
  surface?: string;
  terrain?: string;
  equipmentType?: string;
  coachNotes?: string;
}

/** Bloc cardio d'une séance (training_blocks avec block_type = "cardio"). */
export interface AdminCardioBlock {
  id: string;
  order: number;
  title: string;
  cardioType: CardioType;
  machineType?: MachineType;
  segments: AdminCardioSegment[];
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
  /**
   * Type de séance (V3 cardio). Optionnel pour rester compatible avec les
   * données mock/anciennes séances qui n'ont pas encore ce champ —
   * normaliser avec `session.sessionType ?? "strength"` avant utilisation
   * (voir lib/cardio.ts).
   */
  sessionType?: SessionType;
  /**
   * Blocs cardio (V3). Optionnel pour la même raison que sessionType —
   * normaliser avec `session.cardioBlocks ?? []`.
   */
  cardioBlocks?: AdminCardioBlock[];
  /**
   * Photo bannière de la séance (URL publique, bucket Storage "banners" —
   * chantier module Programmation, étape 4). Optionnel, null/absent = pas de
   * bannière.
   */
  bannerUrl?: string | null;
}

/**
 * Modèle de séance réutilisable (V3 étape 4 — table `session_templates`,
 * voir lib/supabase/session-templates.ts). Contenu copié par valeur dans la
 * séance cible au moment de l'application du modèle (mêmes principes que
 * l'ajout d'un exercice depuis la banque) — une future modification du
 * modèle n'affecte jamais une séance déjà construite depuis celui-ci.
 */
export interface SessionTemplate {
  id: string;
  name: string;
  description: string;
  sessionType: SessionType;
  muscleGroup: string;
  durationMinutes: number | null;
  content: {
    warmup: string;
    coachNotes: string;
    exercises: AdminExercise[];
    cardioBlocks: AdminCardioBlock[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * Programme d'entraînement créé par le coach. Composé depuis les tables
 * Supabase `programs`/`program_weeks`/`workout_sessions`/`workout_exercises`
 * quand elles ont au moins un programme réel (voir lib/supabase/programs.ts),
 * sinon mock/localStorage (useAdminData) — même forme dans les deux cas.
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
  /**
   * Photo bannière du programme (URL publique, bucket Storage "banners" —
   * chantier module Programmation, étape 4). Optionnel, null/absent = pas de
   * bannière.
   */
  bannerUrl?: string | null;
  /**
   * Mode du programme (chantier module Programmation, étape 5) : "individuel"
   * (défaut, comportement historique — semaine calculée depuis la date de
   * suivi de chaque élève) ou "groupe" (calendrier partagé, une seule date de
   * démarrage fixe pour tous les élèves assignés, voir groupStartDate).
   */
  programMode?: "individuel" | "groupe";
  /**
   * Date de démarrage fixe (YYYY-MM-DD) utilisée uniquement quand
   * programMode === "groupe" pour calculer la semaine courante partagée par
   * tous les élèves assignés au programme.
   */
  groupStartDate?: string | null;
  /**
   * Catalogue public (chantier module Programmation, étape 6) : isPublic
   * affiche le programme sur /programmes et la home page publique.
   * publicSubscriptionTemplateId pointe vers une formule "one_time" (prix
   * Stripe) ; null/absent = programme gratuit (pas de Stripe, compte élève
   * créé directement, voir lib/supabase/public-programs.ts).
   */
  isPublic?: boolean;
  publicSubscriptionTemplateId?: string | null;
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
 * Mode de distribution d'un document aux élèves :
 * - immediat : disponible dès l'attribution
 * - deblocage-auto : débloqué automatiquement selon le niveau du document
 *   et le nombre de semaines écoulées depuis le début du coaching
 * - deblocage-manuel : le coach débloque lui-même, élève par élève
 * - deblocage-date : débloqué à une date précise (AdminDocument.unlockAt)
 */
export type DocumentDistributionMode = "immediat" | "deblocage-auto" | "deblocage-manuel" | "deblocage-date";

/**
 * Règle de déblocage dérivée d'un document (niveau + délai). Prête à
 * devenir une vraie table Supabase `document_unlock_rule` ; pour l'instant
 * calculée directement depuis AdminDocument.level / unlockAfterWeeks.
 */
export interface DocumentUnlockRule {
  documentId: string;
  level: number;
  unlockAfterWeeks: number;
}

/**
 * Déblocage manuel d'un document pour un élève précis (force la
 * disponibilité même si la règle automatique ne le permettrait pas
 * encore). Correspond à une future table Supabase
 * `student_document_unlock`.
 */
export interface StudentDocumentUnlock {
  studentId: string;
  documentId: string;
  unlockedAt: string;
}

/**
 * Document/ressource géré par le coach. Correspond à une future table
 * Supabase `document_resource_admin` ; fileName/storagePath préparés pour
 * Supabase Storage (fileName = nom mocké choisi dans l'input file,
 * storagePath = chemin réel une fois l'upload branché). level +
 * unlockAfterWeeks alimentent DocumentUnlockRule lorsque distributionMode
 * vaut "deblocage-auto" (ex : niveau 2, unlockAfterWeeks 2 → disponible à
 * partir de la semaine 3 du coaching).
 */
export interface AdminDocument {
  id: string;
  title: string;
  type: DocumentType;
  category: DocumentCategory;
  level: number;
  difficulty: "facile" | "intermédiaire" | "avancé";
  shortDescription: string;
  fullDescription: string;
  /** Contenu texte pour type "texte" (note/guide affiché directement, sans fichier ni lien). */
  contentText: string;
  externalUrl: string;
  /** Lien vidéo (YouTube/Vimeo/...), distinct de externalUrl pour type "vidéo". */
  videoUrl: string;
  fileName: string | null;
  /** Chemin réel dans le bucket Storage "documents" si un fichier a été uploadé (voir lib/supabase/storage-documents.ts) — distinct de externalUrl/videoUrl (lien externe). */
  storagePath: string | null;
  fileSizeBytes: number | null;
  fileMimeType: string | null;
  status: AdminDocumentStatus;
  important: boolean;
  distributionMode: DocumentDistributionMode;
  unlockAfterWeeks: number;
  /** Date de déblocage précise, utilisée quand distributionMode = "deblocage-date". */
  unlockAt: string | null;
  /** "global" : visible de tout élève actif dès publié. "assigned" : seulement les élèves assignés (assignedStudentIds). */
  visibility: DocumentVisibility;
  tags: string[];
  assignedStudentIds: string[];
  createdAt: string;
  updatedAt: string;
}

export type FeedbackType = "entrainement" | "nutrition" | "profil";
export type FeedbackStatus = "a-traiter" | "traité" | "important";

export interface AdminExerciseFeedbackEntry {
  /**
   * Optionnel : absent sur les retours historiques mockés (avant l'ajout
   * de ce champ), toujours renseigné pour un retour envoyé depuis
   * /entrainement/seance/[sessionId] (correspond à Exercise.id).
   */
  exerciseId?: string;
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
 * table séparée pour rester simple en mock. Un retour d'entraînement
 * envoyé depuis /entrainement/seance/[sessionId] est converti en
 * AdminStudentFeedback (type "entrainement") au moment de l'envoi et
 * ajouté ici, pour que /admin/retours lise une seule source de vérité
 * quel que soit le type de retour (entraînement, nutrition, profil).
 */
export interface AdminStudentFeedback {
  id: string;
  studentId: string;
  type: FeedbackType;
  /** Id de la séance d'origine — uniquement pour type "entrainement". */
  sessionId?: string;
  /** Id du programme d'origine — uniquement pour type "entrainement". */
  programId?: string | null;
  refLabel: string;
  date: string;
  /** "Séance terminée" côté élève — uniquement pertinent pour type "entrainement". */
  completed?: boolean;
  rpe: number | null;
  pain: string;
  comment: string;
  exerciseEntries: AdminExerciseFeedbackEntry[];
  status: FeedbackStatus;
  coachReply: string;
  createdAt: string;
  updatedAt: string;
}

/* ─── Retours d'entraînement Supabase ───
 * Types correspondant directement aux lignes des tables Supabase
 * `workout_feedback`, `exercise_feedback` et `exercise_set_feedback` (voir
 * supabase/schema.sql et types/supabase.ts) — lib/supabase/workout-feedback.ts
 * fait la conversion vers AdminStudentFeedback / AdminExerciseFeedbackEntry
 * pour que /admin/retours et FeedbackDetailModal n'aient rien à changer.
 *
 * `sessionId` / `programId` restent les FK uuid réelles (toujours `null`
 * tant que les programmes ne sont pas migrés) ; `sessionKey` porte l'id
 * mock de la séance (ex: "session-upper"), utilisé pour retrouver/mettre à
 * jour le bon retour sans dupliquer.
 */
export interface SupabaseWorkoutFeedback {
  id: string;
  studentId: string;
  sessionId: string | null;
  programId: string | null;
  sessionKey: string | null;
  sessionRefLabel: string;
  completed: boolean;
  globalRpe: number | null;
  globalComment: string;
  pain: string;
  status: FeedbackStatus;
  coachReply: string;
  submittedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseExerciseFeedback {
  id: string;
  workoutFeedbackId: string;
  studentId: string;
  exerciseId: string | null;
  exerciseName: string;
  exerciseOrder: number | null;
  rpe: number | null;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseExerciseSetFeedback {
  id: string;
  exerciseFeedbackId: string;
  studentId: string;
  setNumber: number;
  loadUsed: string;
  repsDone: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Forme d'entrée pour lib/supabase/workout-feedback.ts::saveWorkoutFeedback —
 * hiérarchique (séance → exercices → séries), contrairement à
 * AdminStudentFeedback.exerciseEntries qui est une liste à plat (une entrée
 * par série, exercice/rpe/commentaire dupliqués) : SessionFeedbackSection
 * tient déjà l'état sous cette forme hiérarchique avant de l'aplatir pour
 * le mock, donc le chemin Supabase l'utilise directement sans conversion.
 */
export interface ExerciseSetFeedbackPayload {
  setNumber: number;
  loadUsed: string;
  repsDone: string;
}

export interface ExerciseFeedbackPayload {
  exerciseName: string;
  exerciseOrder: number;
  rpe: number | null;
  comment: string;
  sets: ExerciseSetFeedbackPayload[];
}

export interface WorkoutFeedbackPayload {
  studentId: string;
  sessionKey: string;
  sessionRefLabel: string;
  completed: boolean;
  globalRpe: number | null;
  globalComment: string;
  pain: string;
  exercises: ExerciseFeedbackPayload[];
  /** FK uuid réelles quand la séance vient d'un programme Supabase migré (voir lib/supabase/programs.ts). */
  sessionId?: string | null;
  programId?: string | null;
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
 * Ligne brute de la table Supabase `assignments` (studentId + contentType +
 * contentId réels, contrairement à AdminAssignment qui peut aussi être
 * dérivée d'assignedStudentIds mock) — voir lib/supabase/programs.ts.
 */
export interface SupabaseAssignment {
  id: string;
  studentId: string;
  contentType: "programme" | "nutrition";
  contentId: string;
  assignedAt: string;
}

/**
 * Formes Supabase (camelCase) des tables `programs` / `program_weeks` /
 * `workout_sessions` / `workout_exercises` / `exercise_library` — voir
 * supabase/schema.sql sections 10-14. lib/supabase/programs.ts les compose
 * en AdminProgram / AdminWorkoutSession / AdminExercise (formes mock déjà
 * utilisées par tout l'admin et l'élève) pour que les composants existants
 * n'aient rien à changer.
 */
export interface SupabaseProgram {
  id: string;
  coachId: string | null;
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  description: string;
  status: AdminContentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseProgramWeek {
  id: string;
  programId: string;
  weekNumber: number;
}

export interface SupabaseWorkoutSession {
  id: string;
  programId: string;
  programWeekId: string;
  day: string;
  isRestDay: boolean;
  name: string;
  muscleGroup: string;
  durationMinutes: number | null;
  warmup: string;
  coachNotes: string;
}

export interface SupabaseWorkoutExercise {
  id: string;
  sessionId: string;
  orderIndex: number;
  name: string;
  sets: number;
  reps: string;
  restSeconds: number;
  tempo: string;
  recommendedLoad: string;
  videoUrl: string;
  notes: string;
  muscleGroup: string | null;
}

export interface SupabaseExerciseLibraryItem {
  id: string;
  coachId: string | null;
  name: string;
  category: string;
  equipment: string;
  level: string;
  muscleGroup: string;
  videoUrl: string;
  notes: string;
}

/**
 * Formes Supabase (camelCase) des tables `nutrition_plans` /
 * `nutrition_days` / `meals` — voir supabase/schema.sql sections 15-17.
 * lib/supabase/nutrition.ts les compose en AdminNutritionPlan /
 * AdminNutritionDay / AdminMeal (formes mock déjà utilisées par tout
 * l'admin) pour que NutritionPlanBuilder et les pages d'affichage n'aient
 * rien à changer.
 */
export interface SupabaseNutritionPlan {
  id: string;
  studentId: string | null;
  coachId: string | null;
  name: string;
  description: string;
  goalType: NutritionGoalType;
  dailyTarget: MacroTarget;
  weeklyTargetCalories: number;
  status: AdminContentStatus;
  shoppingList: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseNutritionDay {
  id: string;
  planId: string;
  day: string;
  target: MacroTarget;
}

export interface SupabaseMeal {
  id: string;
  nutritionDayId: string;
  slot: string;
  name: string;
  items: MealFoodItem[];
  macros: MacroTarget;
  coachNotes: string;
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

/* ─── Fiche élève Supabase (profils élèves) ───
 * Types correspondant directement aux lignes des tables Supabase
 * `students`, `student_profiles`, `progress_photos`, `body_measurements`,
 * `custom_measurements`, `payments`, `payment_entries` et `coach_notes`
 * (voir supabase/schema.sql et types/supabase.ts pour la forme exacte des
 * lignes retournées par le client) — lib/supabase/students.ts fait la
 * conversion entre ces types "bruts" (snake_case, tels que stockés) et les
 * types mock existants (AdminStudent, BodyMeasurement...) pour que les
 * composants déjà écrits n'aient rien à changer.
 */
/** Identité + statut de suivi uniquement — voir docs/supabase-student-model.md. */
export interface SupabaseStudent {
  id: string;
  userId: string | null;
  coachId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: StudentAccountStatus;
  startDate: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
  accessType: "coaching" | "programme_seul";
}

/**
 * Détails coaching (une ligne par élève) : mensurations de référence,
 * niveau, objectif, contraintes et préférences — voir
 * docs/supabase-student-model.md.
 */
export interface SupabaseStudentProfile {
  id: string;
  studentId: string;
  age: number | null;
  heightCm: number | null;
  currentWeightKg: number | null;
  startWeightKg: number | null;
  targetWeightKg: number | null;
  goal: string;
  level: string;
  trainingFrequencyPerWeek: number | null;
  trainingLocation: string;
  foodPreferences: AdminFoodPreferences;
  sportPreferences: AdminSportPreferences;
  injuryNote: string;
  mainGoal: string;
  secondaryGoals: string[];
  targetDate: string | null;
  priority: GoalPriority | null;
  trackedIndicators: GoalIndicator[];
  // Onboarding élève (voir app/onboarding, docs/supabase-student-model.md) —
  // beaucoup de ces champs sont optionnels et sensibles (santé, motivation,
  // contexte personnel) : à ne jamais afficher sur /dashboard ou /admin,
  // uniquement dans le détail de profil.
  onboardingCompleted: boolean;
  onboardingCompletedAt: string | null;
  targetTimeframe: string;
  activityLevel: string;
  neatLevel: string;
  sportsPracticed: string[];
  otherActivities: string[];
  availableEquipment: string[];
  favoriteExercises: string[];
  favoriteGymExercises: string[];
  avoidedExercises: string[];
  onboardingInjuries: string;
  trainingNotes: string;
  medicalTreatments: string;
  medications: string;
  healthNotes: string;
  hydrationLevel: string;
  dailyWaterIntake: string;
  sleepDuration: string;
  sleepQuality: string;
  recoveryNotes: string;
  lifestyleNotes: string;
  motivationSource: string;
  recentLifeEvents: string;
  mentalWellbeingGoal: string;
  emotionalWellbeingNotes: string;
  dislikedFoods: string[];
  allergies: string[];
  intolerances: string[];
  dietType: string;
  preferredMealCount: number | null;
  mealTimingNotes: string;
  hungerNotes: string;
  snackingNotes: string;
  workScheduleNotes: string;
  nutritionNotes: string;
  /** Accès conditionnel au site (chantier "supabase-stripe-access-control") — voir lib/supabase/student-access.ts. */
  billingAccessMode: BillingAccessMode;
  assignedStripePlan: string | null;
  assignedStripePriceId: string | null;
  accessNote: string;
  accessUpdatedAt: string | null;
  accessUpdatedBy: string | null;
  /** Modèle d'abonnement attribué (chantier "supabase-subscription-templates") — voir lib/supabase/subscription-templates.ts. */
  assignedSubscriptionTemplateId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Réponses du questionnaire /onboarding (voir app/onboarding). Un seul type
 * plat pour les 9 étapes plutôt qu'un type par étape : le formulaire vit en
 * un seul state React tout du long, converti en écritures Supabase
 * (students + student_profiles + weight_entries) uniquement à la
 * validation finale (étape 9). Tous les champs marqués optionnels dans le
 * questionnaire restent des chaînes/tableaux vides plutôt qu'`undefined` —
 * jamais bloquant à la sauvegarde.
 */
export interface StudentOnboardingSubmission {
  firstName: string;
  lastName: string;
  phone: string;
  age: number;
  heightCm: number;
  currentWeightKg: number;
  startWeightKg: number | null;
  targetWeightKg: number;
  mainGoal: string;
  secondaryGoals: string[];
  targetTimeframe: string;
  targetDate: string;
  level: string;
  trainingFrequencyPerWeek: number;
  trainingLocation: string;
  neatLevel: string;
  sportsPracticed: string[];
  otherActivities: string[];
  availableEquipment: string[];
  favoriteGymExercises: string[];
  favoriteExercises: string[];
  avoidedExercises: string[];
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
  preferredMealCount: number | null;
  likedFoods: string[];
  dislikedFoods: string[];
  allergies: string[];
  intolerances: string[];
  dietType: string;
  mealTimingNotes: string;
  workScheduleNotes: string;
  snackingNotes: string;
  hungerNotes: string;
  nutritionNotes: string;
}

export type WeightEntrySource = "initial" | "student_update" | "coach_update";

/** Un relevé de poids daté — voir docs/supabase-student-model.md. */
export interface SupabaseWeightEntry {
  id: string;
  studentId: string;
  weightKg: number;
  recordedAt: string;
  source: WeightEntrySource;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseBodyMeasurement {
  id: string;
  studentId: string;
  /** Clé anglaise snake_case telle que stockée en base (voir lib/supabase/measurement-types.ts). */
  type: string;
  unit: string;
  startValue: number;
  currentValue: number;
  note: string;
  lastUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseCustomMeasurement {
  id: string;
  studentId: string;
  name: string;
  unit: string;
  startValue: number;
  currentValue: number;
  note: string;
  lastUpdatedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseProgressPhoto {
  id: string;
  studentId: string;
  type: ProgressPhotoType;
  date: string;
  weightKg: number | null;
  note: string;
  imageUrl: string | null;
  storagePath: string | null;
  pending: boolean;
  photoType: ProgressPhotoAngle;
  uploadedBy: string | null;
  fileName: string | null;
  fileSizeBytes: number | null;
  fileMimeType: string | null;
  isBeforeCandidate: boolean;
  isAfterCandidate: boolean;
  status: ProgressPhotoStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupabasePayment {
  id: string;
  studentId: string;
  offerName: string;
  monthlyPriceEuros: number;
  durationMonths: number;
  totalPriceEuros: number;
  paidAmountEuros: number;
  status: PaymentStatus;
  method: PaymentMethod;
  nextPaymentDate: string | null;
  installmentsTotal: number;
  installmentsPaid: number;
  createdAt: string;
  updatedAt: string;
}

export interface SupabasePaymentEntry {
  id: string;
  paymentId: string;
  studentId: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  note: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupabaseCoachNote {
  id: string;
  studentId: string;
  coachId: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * "admin" = compte principal (jamais attribué via le formulaire d'ajout,
 * réservé au propriétaire du site) ; "assistant" = collaborateur ajouté
 * depuis /admin/parametres. N'a aucune incidence sur les droits réels
 * (voir is_coach_or_admin() : un profil `coach` a le même accès complet
 * qu'un profil `admin`) — purement un libellé d'organisation affiché dans
 * la liste. Doit rester synchronisé avec la contrainte CHECK
 * `coaches_role_check` en base (ANY ['admin','assistant']).
 */
export type CoachRole = "admin" | "assistant";
export type CoachAccountStatus = "actif" | "inactif";

/**
 * Collaborateur admin/coach listé sur /admin/parametres — reflète une ligne
 * réelle de la table Supabase `coaches` (voir lib/supabase/coaches.ts et
 * lib/supabase/coach-account-provisioning.ts). `id` est l'id de la ligne
 * `coaches`, pas celui du compte `auth.users` associé (`userId`).
 */
export interface AdminCoach {
  id: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  email: string;
  role: CoachRole;
  status: CoachAccountStatus;
  speciality: string;
  createdAt: string;
  updatedAt: string;
}

export type CardStyle = "angulaire" | "arrondi";
export type UiDensity = "compacte" | "normale" | "large";

/**
 * Apparence du site, éditable en mock sur /admin/parametres (appliquée en
 * direct sur l'espace admin via des variables CSS). Correspond à une
 * future table Supabase `appearance_settings`.
 */
export interface AdminAppearanceSettings {
  accentColor: string;
  secondaryColor: string;
  darkMode: "sombre" | "très sombre";
  cardStyle: CardStyle;
  density: UiDensity;
  titleStyle: string;
  brandLogoText: string;
  brandTagline: string;
}

/**
 * Sécurité admin mockée. AVERTISSEMENT : ceci n'est PAS un mécanisme de
 * sécurité réel — le mot de passe est stocké en clair dans localStorage
 * uniquement pour la démo. À remplacer entièrement par une vraie
 * authentification (Supabase Auth) avant toute mise en production.
 */
export interface AdminSecuritySettings {
  mockPasswordSet: boolean;
  mockPasswordHint: string;
  updatedAt: string;
}

/* ─── Banque d'exercices ───
 * Types de la table Supabase réelle `exercise_library` (chantier
 * "supabase-exercise-library"), composés en localStorage tant que Supabase
 * n'est pas configuré (voir hooks/useSupabaseExerciseLibrary.ts).
 */

export type ExerciseCategory =
  | "Force"
  | "Hypertrophie"
  | "Mobilité"
  | "Cardio"
  | "Gainage"
  | "Plyométrie"
  | "Échauffement"
  | "Réathlétisation"
  | "Technique";
/** Partage volontairement la même liste que ExerciseCategory (aucune liste distincte fournie pour le "type" d'exercice). */
export type ExerciseType = ExerciseCategory;
export type ExerciseEquipment =
  | "Aucun"
  | "Haltères"
  | "Barre"
  | "Machine"
  | "Poulie"
  | "Élastique"
  | "Kettlebell"
  | "Smith machine"
  | "TRX"
  | "Médecine ball"
  | "Cardio machine"
  | "Autre";
export type ExerciseLevel = "débutant" | "intermédiaire" | "avancé";
export type ExerciseLibraryStatus = "active" | "archived";

export interface ExerciseTag {
  id: string;
  label: string;
}

export interface ExerciseLibraryItem {
  id: string;
  name: string;
  description: string;
  /** Groupe musculaire principal (voir MuscleGroup, lib/training-metrics.ts). */
  muscleGroup: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  category: ExerciseCategory;
  exerciseType: ExerciseType;
  equipment: ExerciseEquipment;
  level: ExerciseLevel;
  videoUrl: string;
  alternativeVideoUrl: string;
  /** Consignes techniques. */
  technicalNote: string;
  /** Erreurs fréquentes. */
  commonMistakes: string;
  /** Note interne coach (colonne `notes`, jamais affichée à l'élève). */
  coachInstructions: string;
  defaultTempo: string;
  defaultRestSeconds: number | null;
  tags: string[];
  status: ExerciseLibraryStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Métadonnées d'une semaine de programme (message affiché quand elle a
 * été créée par duplication d'une autre semaine). Les séances elles-mêmes
 * restent stockées à plat dans AdminProgram.sessions (weekNumber + day).
 */
export interface ProgramWeek {
  programId: string;
  weekNumber: number;
  duplicatedFromWeek: number | null;
}

/**
 * Forme "modèle" d'une séance, réutilisable indépendamment d'une semaine
 * ou d'un programme précis (ex: dupliquer une séance vers une nouvelle
 * semaine sans ses identifiants de position).
 */
export type WorkoutSessionTemplate = Omit<AdminWorkoutSession, "id" | "programId" | "weekNumber" | "day">;

/* ─── Analyse de charge d'entraînement (volume / séries / tonnage) ───
 * Types consommés par lib/training-metrics.ts. Tout est calculé côté
 * client à partir des programmes/séances mockés (et des retours élève
 * déjà persistés côté admin) — rien n'est encore branché à Supabase, mais
 * la forme est prête pour recevoir de vraies données de retour élève plus
 * tard (voir PlannedVsActualTrainingMetrics).
 */

export type MuscleGroup =
  | "pectoraux"
  | "dos"
  | "épaules"
  | "biceps"
  | "triceps"
  | "quadriceps"
  | "ischios"
  | "fessiers"
  | "mollets"
  | "abdos"
  | "lombaires"
  | "avant-bras"
  | "cardio"
  | "full-body"
  | "autre";

/**
 * Type de charge d'un exercice, utilisé pour calculer un tonnage fiable :
 * kg_per_dumbbell double la charge saisie (deux haltères), bodyweight /
 * machine / assisted / other ne comptent pas de tonnage tant que le poids
 * du corps ou la charge machine ne sont pas structurés (voir parseLoad).
 */
export type LoadType = "kg" | "kg_per_dumbbell" | "bodyweight" | "machine" | "assisted" | "other";

/** Résultat de l'analyse d'une chaîne de charge libre (ex: "24 kg / haltère"). */
export interface ParsedLoad {
  loadType: LoadType;
  /** Valeur telle que saisie (avant doublement pour kg_per_dumbbell), null si non chiffrable. */
  valueKg: number | null;
  isEstimate: boolean;
}

/** Métriques calculées pour un seul exercice au sein d'une séance. */
export interface ExerciseMetrics {
  exerciseId: string;
  name: string;
  muscleGroup: MuscleGroup;
  sets: number;
  averageReps: number;
  /** volume = sets × averageReps, en répétitions totales. */
  volume: number;
  /** tonnage = sets × averageReps × charge effective (kg), 0 si notCalculated. */
  tonnageKg: number;
  loadType: LoadType;
  /** true si reps/charge est une fourchette ou une estimation. */
  isEstimate: boolean;
  /** true si la charge n'est pas chiffrable (poids du corps, machine sans charge...). */
  notCalculated: boolean;
}

export interface MuscleGroupVolume {
  muscleGroup: MuscleGroup;
  sets: number;
  volume: number;
  tonnageKg: number;
}

/** Métriques agrégées pour une séance entière. */
export interface SessionMetrics {
  sessionId: string;
  totalSets: number;
  totalVolume: number;
  totalTonnageKg: number;
  hasEstimatedValues: boolean;
  hasNotCalculatedValues: boolean;
  /** true si au moins un exercice inclus dans le calcul n'a pas de muscleGroup renseigné. */
  hasUntaggedExercises: boolean;
  exercises: ExerciseMetrics[];
  muscleGroupBreakdown: MuscleGroupVolume[];
}

/** Métriques agrégées pour toutes les séances d'une semaine de programme. */
export interface WeekTrainingMetrics {
  weekNumber: number;
  sessionsCount: number;
  totalSets: number;
  totalVolume: number;
  totalTonnageKg: number;
  hasUntaggedExercises: boolean;
  exercises: ExerciseMetrics[];
  muscleGroupBreakdown: MuscleGroupVolume[];
  mostTrainedMuscleGroup: MuscleGroup | null;
  busiestDay: { day: string; sets: number } | null;
}

/** Métriques agrégées génériques (ex: programme entier, élève sur une période). */
export interface TrainingMetrics {
  totalSets: number;
  totalVolume: number;
  totalTonnageKg: number;
  hasUntaggedExercises: boolean;
  exercises: ExerciseMetrics[];
  muscleGroupBreakdown: MuscleGroupVolume[];
}

/** Filtre d'analyse par groupe musculaire : "tous" = pas de filtre. */
export type MuscleGroupFilter = MuscleGroup | "tous";

/**
 * Entrée de charge réellement effectuée par l'élève pour une série d'un
 * exercice, telle qu'elle existe déjà dans AdminExerciseFeedbackEntry
 * (retours consolidés côté admin) — réutilisée ici pour ne pas dupliquer
 * la forme, seulement pour la lecture par lib/training-metrics.ts.
 */
export interface ActualSetEntry {
  exerciseName: string;
  setNumber: number;
  loadUsed: string;
  repsDone: string;
}

/** Comparaison volume/tonnage prévu (programme) vs réalisé (retour élève). */
export interface PlannedVsActualTrainingMetrics {
  planned: SessionMetrics;
  /** null tant qu'aucun retour élève n'existe pour cette séance. */
  actual: SessionMetrics | null;
  volumeDeltaPercent: number | null;
  tonnageDeltaKg: number | null;
  tonnageDeltaPercent: number | null;
}

/* ─── Calendrier / réservation (chantier "supabase-calendar-booking-system") ───
 * Types de la table Supabase réelle `appointments` + `coach_availabilities` +
 * `coach_unavailabilities` + `booking_settings`. Aucun mock équivalent
 * n'existait avant ce chantier (voir docs/supabase-calendar-booking-model.md).
 */

export type AppointmentType =
  | "Coaching en salle"
  | "Coaching visio"
  | "Point nutrition"
  | "Bilan mensuel"
  | "Appel suivi"
  | "Autre";

export const appointmentTypes: AppointmentType[] = [
  "Coaching en salle",
  "Coaching visio",
  "Point nutrition",
  "Bilan mensuel",
  "Appel suivi",
  "Autre",
];

export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed" | "no_show";

export interface AdminAppointment {
  id: string;
  studentId: string | null;
  coachId: string | null;
  title: string;
  description: string;
  appointmentType: AppointmentType;
  startAt: string;
  endAt: string;
  timezone: string;
  location: string;
  meetingUrl: string;
  status: AppointmentStatus;
  cancellationReason: string;
  rescheduledFromId: string | null;
  icsUid: string;
  createdAt: string;
  updatedAt: string;
}

/** 0 dimanche .. 6 samedi (voir JS Date#getDay(), même convention que la colonne `weekday`). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const weekdayLabels: Record<Weekday, string> = {
  0: "Dimanche",
  1: "Lundi",
  2: "Mardi",
  3: "Mercredi",
  4: "Jeudi",
  5: "Vendredi",
  6: "Samedi",
};

export interface CoachAvailability {
  id: string;
  coachId: string | null;
  weekday: Weekday;
  /** "09:00" (format HH:mm, colonne SQL `time`). */
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  appointmentType: AppointmentType;
  location: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CoachUnavailability {
  id: string;
  coachId: string | null;
  startAt: string;
  endAt: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
}

export interface BookingSettings {
  id: string | null;
  minLeadMinutes: number;
  maxDaysAhead: number;
  defaultDurationMinutes: number;
}

/** Un créneau proposable à la réservation, déjà purgé des chevauchements/indisponibilités. */
export interface AvailableSlot {
  startAt: string;
  endAt: string;
  appointmentType: AppointmentType;
  location: string;
}

/* ─── Centre d'activité (chantier "supabase-activity-notifications") ───
 * Types de la table Supabase réelle `activity_events`. Aucun système de
 * notification équivalent n'existait avant ce chantier (le panneau
 * "Notifications (exemple)" de /admin et coachNotifications côté élève sont
 * des fonctionnalités mock distinctes, non liées, non modifiées ici).
 */

export type ActivityActorType = "student" | "coach" | "system";

export type ActivityEventType =
  | "onboarding_completed"
  | "weight_added"
  | "workout_feedback_submitted"
  | "nutrition_log_filled"
  | "appointment_booked"
  | "appointment_cancelled"
  | "document_assigned"
  | "document_viewed"
  | "program_assigned"
  | "nutrition_assigned"
  | "coach_note_added"
  | "progress_photo_uploaded"
  | "payment_succeeded"
  | "payment_failed"
  | "subscription_cancelled";

export interface ActivityEvent {
  id: string;
  studentId: string | null;
  actorType: ActivityActorType;
  eventType: ActivityEventType;
  title: string;
  description: string;
  /** Contient généralement { link: string } — page admin à ouvrir depuis le centre d'activité. */
  metadata: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

/* ─── Paiements / abonnements Stripe (chantier "supabase-stripe-payments-subscriptions") ───
 * Types des tables Supabase réelles billing_customers / subscriptions /
 * stripe_payments / billing_events — voir supabase/schema.sql et
 * docs/supabase-stripe-payments-subscriptions-model.md. Distincts de
 * StudentPaymentProfile/StudentPaymentEntry (PaymentStatus/PaymentMethod
 * plus haut), qui restent la fiche paiement saisie manuellement par le
 * coach (table `payments`, inchangée) — deux systèmes séparés, non fusionnés.
 * Source de vérité : Stripe (webhook) → Supabase, jamais l'inverse.
 */

export interface BillingCustomer {
  id: string;
  studentId: string;
  stripeCustomerId: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

/** Statut Stripe brut (jamais traduit avant stockage) — voir lib/stripe/status.ts pour la traduction élève (actif/en attente/paiement échoué/annulé/expiré). */
export type StripeSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

export interface Subscription {
  id: string;
  studentId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  stripeProductId: string | null;
  planName: string;
  status: StripeSubscriptionStatus | string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  amountCents: number | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface StripePayment {
  id: string;
  studentId: string;
  stripeCustomerId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  amountCents: number | null;
  currency: string;
  status: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BillingEvent {
  id: string;
  stripeEventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  processedAt: string;
  createdAt: string;
}

/** Statut simplifié affiché à l'élève, dérivé de Subscription.status (voir lib/stripe/status.ts). */
export type StudentBillingStatus = "actif" | "en_attente" | "paiement_echoue" | "annule" | "expire" | "sans_abonnement";

/** Résumé billing d'un élève, composé pour l'affichage admin/élève (voir lib/supabase/billing.ts). */
export interface StudentBillingSummary {
  studentId: string;
  customer: BillingCustomer | null;
  subscription: Subscription | null;
  lastPayment: StripePayment | null;
  status: StudentBillingStatus;
}

/* ─── Accès conditionnel au site (chantier "supabase-stripe-access-control") ───
 * Colonnes ajoutées sur student_profiles — voir supabase/schema.sql et
 * lib/supabase/student-access.ts. `subscription_required` (défaut) : accès
 * dérivé de subscriptions.status. `manual_allowed`/`manual_blocked` :
 * dérogation posée par le coach, prioritaire sur le statut Stripe.
 */
export type BillingAccessMode = "subscription_required" | "manual_allowed" | "manual_blocked";

/** Raison précise de l'autorisation/refus d'accès — sert à afficher un message explicite (jamais juste "bloqué"). */
export type StudentAccessReason =
  | "manual_allowed"
  | "manual_blocked"
  | "subscription_active"
  | "no_subscription"
  | "subscription_incomplete"
  | "subscription_incomplete_expired"
  | "subscription_past_due"
  | "subscription_canceled"
  | "subscription_unpaid"
  | "subscription_paused";

export interface StudentAccessStatus {
  allowed: boolean;
  reason: StudentAccessReason;
  accessMode: BillingAccessMode;
  /** Statut Stripe brut ayant servi au calcul (null si aucun abonnement) — jamais recalculé/stocké ailleurs, toujours dérivé à la volée. */
  subscriptionStatus: string | null;
}

/* ─── Modèles d'abonnements (chantier "supabase-subscription-templates") ───
 * Formules gérées depuis l'admin (table subscription_templates) au lieu
 * d'un mapping figé par variables d'environnement — voir
 * lib/supabase/subscription-templates.ts et
 * docs/supabase-stripe-payments-subscriptions-model.md.
 */
export type BillingInterval = "monthly" | "quarterly" | "yearly" | "one_time";

/**
 * Programme du catalogue public (chantier module Programmation, étape 6) —
 * uniquement les champs marketing exposés à un visiteur anonyme sur
 * /programmes et la home page. Jamais le détail séance/exercice (voir
 * lib/supabase/public-programs.ts).
 */
export interface PublicProgramSummary {
  id: string;
  name: string;
  goal: string;
  description: string;
  level: string;
  durationWeeks: number;
  bannerUrl: string | null;
  /** null = programme gratuit (aucune formule liée). */
  priceCents: number | null;
  currency: string;
}

export interface SubscriptionTemplate {
  id: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  billingInterval: BillingInterval;
  durationMonths: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/* ─── Emails transactionnels (chantier "supabase-resend-transactional-emails") ───
 * Un seul journal (table email_logs) pour tous les emails envoyés via
 * Resend, quel que soit le déclencheur — voir
 * lib/email/send-transactional-email.ts et docs/resend-transactional-emails.md.
 * Union centralisée pour éviter les chaînes répétées dans le code.
 */
export type EmailType =
  | "welcome"
  | "subscription_assigned"
  | "payment_succeeded"
  | "payment_failed"
  | "subscription_cancelled"
  | "program_assigned"
  | "nutrition_assigned"
  | "document_assigned"
  | "appointment_created"
  | "appointment_cancelled"
  | "appointment_reminder"
  | "password_reset"
  | "account_expiry_warning"
  | "coach_invite"
  | "collaborator_invite";

export type EmailStatus = "pending" | "sent" | "failed" | "skipped";

export interface EmailLog {
  id: string;
  recipientEmail: string;
  recipientUserId: string | null;
  emailType: EmailType;
  subject: string;
  resendEmailId: string | null;
  status: EmailStatus;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  sentAt: string | null;
  createdAt: string;
}
