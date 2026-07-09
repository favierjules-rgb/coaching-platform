import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import { fromSupabaseMeasurementType, toSupabaseMeasurementType } from "@/lib/supabase/measurement-types";
import { getAssignedDocumentIdsByStudent } from "@/lib/supabase/documents";
import { getAssignedNutritionPlanIdsByStudent } from "@/lib/supabase/nutrition";
import { getAssignedProgramIdsByStudent } from "@/lib/supabase/programs";
import { normalizePaymentProfile } from "@/lib/payments";
import type { CustomMeasurementInput } from "@/components/student/UpdateMeasurementsModal";
import type {
  AdminFoodPreferences,
  AdminSportPreferences,
  AdminStudent,
  BodyMeasurement,
  BodyMeasurementType,
  CoachNote,
  CustomMeasurement,
  GoalIndicator,
  GoalPriority,
  ProgressPhoto,
  StudentPaymentEntry,
  StudentPaymentProfile,
  SupabaseBodyMeasurement,
  SupabaseCoachNote,
  SupabaseCustomMeasurement,
  SupabasePayment,
  SupabasePaymentEntry,
  SupabaseProgressPhoto,
  SupabaseStudent,
  SupabaseStudentProfile,
  SupabaseWeightEntry,
  StudentAccountStatus,
  WeightEntry,
  WeightEntrySource,
} from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès aux données élèves côté Supabase (tables `students`,
 * `student_profiles`, `body_measurements`, `custom_measurements`,
 * `progress_photos`, `payments`, `payment_entries`, `coach_notes`).
 *
 * Toutes les fonctions de lecture renvoient un tableau/objet "vide" (jamais
 * de rejet non géré) aussi bien quand Supabase n'a réellement aucune donnée
 * que lorsqu'une erreur survient (RLS, réseau...) — dans ce dernier cas un
 * warning est affiché en développement uniquement, jamais une erreur
 * bloquante, pour préserver le repli mock/localStorage (voir README.md).
 *
 * Les lignes brutes (snake_case) sont converties en types Supabase*
 * (camelCase, voir types/index.ts) puis, pour les champs déjà utilisés par
 * l'interface mock existante, vers les types mock (AdminStudent,
 * BodyMeasurement...) afin que les composants d'affichage n'aient rien à
 * changer.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

type StudentRow = Database["public"]["Tables"]["students"]["Row"];
type StudentProfileRow = Database["public"]["Tables"]["student_profiles"]["Row"];
type ProgressPhotoRow = Database["public"]["Tables"]["progress_photos"]["Row"];
type BodyMeasurementRow = Database["public"]["Tables"]["body_measurements"]["Row"];
type CustomMeasurementRow = Database["public"]["Tables"]["custom_measurements"]["Row"];
type PaymentRow = Database["public"]["Tables"]["payments"]["Row"];
type PaymentEntryRow = Database["public"]["Tables"]["payment_entries"]["Row"];
type CoachNoteRow = Database["public"]["Tables"]["coach_notes"]["Row"];
type WeightEntryRow = Database["public"]["Tables"]["weight_entries"]["Row"];

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
 * `students.status` a été vu en pratique sous deux formes selon l'historique
 * du projet Supabase : la contrainte française documentée dans
 * schema.sql ('actif' | 'pause' | 'terminé') et une contrainte anglaise
 * ('active' | 'paused' | 'completed') sur certains projets déjà initialisés
 * avant que ce nom français ne soit fixé. Le reste de l'app (mock, UI,
 * StatusBadge, filtres) n'utilise que les valeurs françaises — ces deux
 * fonctions font la conversion à la frontière Supabase pour que ni le code
 * d'affichage ni les écritures n'aient à connaître la variante réellement
 * en place sur un projet donné.
 */
const STATUS_DB_TO_APP: Record<string, StudentAccountStatus> = {
  actif: "actif",
  pause: "pause",
  "terminé": "terminé",
  active: "actif",
  paused: "pause",
  completed: "terminé",
};

const STATUS_APP_TO_DB: Record<StudentAccountStatus, "active" | "paused" | "completed"> = {
  actif: "active",
  pause: "paused",
  "terminé": "completed",
};

function mapStatusFromDb(raw: string): StudentAccountStatus {
  return STATUS_DB_TO_APP[raw] ?? "actif";
}

/* ─── Row -> types Supabase* (camelCase) ─── */

function mapStudentRow(row: StudentRow): SupabaseStudent {
  return {
    id: row.id,
    userId: row.user_id,
    coachId: row.coach_id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    status: mapStatusFromDb(row.status),
    startDate: row.start_date,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function mapStudentProfileRow(row: StudentProfileRow): SupabaseStudentProfile {
  const food = (row.food_preferences ?? {}) as Partial<AdminFoodPreferences>;
  const sport = (row.sport_preferences ?? {}) as Partial<AdminSportPreferences>;
  const injury = (row.injury_note ?? {}) as { currentInjuries?: unknown; coachRemarks?: unknown };

  const currentInjuries = asStringArray(injury.currentInjuries);
  const coachRemarks = typeof injury.coachRemarks === "string" ? injury.coachRemarks : "";

  return {
    id: row.id,
    studentId: row.student_id,
    age: row.age,
    heightCm: row.height_cm,
    currentWeightKg: row.current_weight_kg,
    startWeightKg: row.start_weight_kg,
    targetWeightKg: row.target_weight_kg,
    goal: row.goal,
    // `sport_level` est la colonne réellement utilisée sur ce projet pour le
    // niveau sportif ; `level` (ajoutée par la migration 4bis) reste un repli
    // si jamais elle est vide, voir docs/supabase-student-model.md.
    level: row.sport_level || row.level || "",
    trainingFrequencyPerWeek: row.training_frequency_per_week,
    trainingLocation: row.training_location,
    foodPreferences: {
      liked: asStringArray(food.liked),
      disliked: asStringArray(food.disliked),
      intolerances: asStringArray(food.intolerances),
      diet: typeof food.diet === "string" ? food.diet : "",
    },
    sportPreferences: {
      sports: asStringArray(sport.sports),
      equipment: asStringArray(sport.equipment),
      preferredExercises: asStringArray(sport.preferredExercises),
      exercisesToAvoid: asStringArray(sport.exercisesToAvoid),
    },
    injuryNote: [...currentInjuries, coachRemarks].filter(Boolean).join(" ").trim(),
    mainGoal: row.main_goal,
    secondaryGoals: asStringArray(row.secondary_goals),
    targetDate: row.target_date,
    priority: (row.priority as GoalPriority | null) ?? null,
    trackedIndicators: asStringArray(row.tracked_indicators) as GoalIndicator[],
    onboardingCompleted: row.onboarding_completed,
    onboardingCompletedAt: row.onboarding_completed_at,
    targetTimeframe: row.target_timeframe ?? "",
    activityLevel: row.activity_level ?? "",
    neatLevel: row.neat_level ?? "",
    sportsPracticed: asStringArray(row.sports_practiced),
    otherActivities: asStringArray(row.other_activities),
    availableEquipment: asStringArray(row.available_equipment),
    favoriteExercises: asStringArray(row.favorite_exercises),
    favoriteGymExercises: asStringArray(row.favorite_gym_exercises),
    avoidedExercises: asStringArray(row.avoided_exercises),
    onboardingInjuries: row.injuries ?? "",
    trainingNotes: row.training_notes ?? "",
    medicalTreatments: row.medical_treatments ?? "",
    medications: row.medications ?? "",
    healthNotes: row.health_notes ?? "",
    hydrationLevel: row.hydration_level ?? "",
    dailyWaterIntake: row.daily_water_intake ?? "",
    sleepDuration: row.sleep_duration ?? "",
    sleepQuality: row.sleep_quality ?? "",
    recoveryNotes: row.recovery_notes ?? "",
    lifestyleNotes: row.lifestyle_notes ?? "",
    motivationSource: row.motivation_source ?? "",
    recentLifeEvents: row.recent_life_events ?? "",
    mentalWellbeingGoal: row.mental_wellbeing_goal ?? "",
    emotionalWellbeingNotes: row.emotional_wellbeing_notes ?? "",
    dislikedFoods: asStringArray(row.disliked_foods),
    allergies: asStringArray(row.allergies),
    intolerances: asStringArray(row.intolerances),
    dietType: row.diet_type ?? "",
    preferredMealCount: row.preferred_meal_count,
    mealTimingNotes: row.meal_timing_notes ?? "",
    hungerNotes: row.hunger_notes ?? "",
    snackingNotes: row.snacking_notes ?? "",
    workScheduleNotes: row.work_schedule_notes ?? "",
    nutritionNotes: row.nutrition_notes ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapProgressPhotoRow(row: ProgressPhotoRow): SupabaseProgressPhoto {
  return {
    id: row.id,
    studentId: row.student_id,
    type: row.type,
    date: row.date,
    weightKg: row.weight_kg,
    note: row.note,
    imageUrl: row.image_url,
    storagePath: row.storage_path,
    pending: row.pending,
    photoType: row.photo_type,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    fileMimeType: row.file_mime_type,
    isBeforeCandidate: row.is_before_candidate,
    isAfterCandidate: row.is_after_candidate,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBodyMeasurementRow(row: BodyMeasurementRow): SupabaseBodyMeasurement {
  return {
    id: row.id,
    studentId: row.student_id,
    type: row.type,
    unit: row.unit,
    startValue: row.start_value,
    currentValue: row.current_value,
    note: row.note,
    lastUpdatedAt: row.last_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCustomMeasurementRow(row: CustomMeasurementRow): SupabaseCustomMeasurement {
  return {
    id: row.id,
    studentId: row.student_id,
    name: row.name,
    unit: row.unit,
    startValue: row.start_value,
    currentValue: row.current_value,
    note: row.note,
    lastUpdatedAt: row.last_updated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPaymentRow(row: PaymentRow): SupabasePayment {
  return {
    id: row.id,
    studentId: row.student_id,
    offerName: row.offer_name,
    monthlyPriceEuros: row.monthly_price_euros,
    durationMonths: row.duration_months,
    totalPriceEuros: row.total_price_euros,
    paidAmountEuros: row.paid_amount_euros,
    status: row.status,
    method: row.method,
    nextPaymentDate: row.next_payment_date,
    installmentsTotal: row.installments_total,
    installmentsPaid: row.installments_paid,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapPaymentEntryRow(row: PaymentEntryRow): SupabasePaymentEntry {
  return {
    id: row.id,
    paymentId: row.payment_id,
    studentId: row.student_id,
    amount: row.amount,
    date: row.date,
    method: row.method,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCoachNoteRow(row: CoachNoteRow): SupabaseCoachNote {
  return {
    id: row.id,
    studentId: row.student_id,
    coachId: row.coach_id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWeightEntryRow(row: WeightEntryRow): SupabaseWeightEntry {
  return {
    id: row.id,
    studentId: row.student_id,
    weightKg: row.weight_kg,
    recordedAt: row.recorded_at,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ─── types Supabase* -> types mock (pour réutiliser les composants existants) ─── */

function toMockProgressPhoto(photo: SupabaseProgressPhoto): ProgressPhoto {
  return {
    id: photo.id,
    studentId: photo.studentId,
    type: photo.type,
    date: photo.date,
    weightKg: photo.weightKg,
    note: photo.note,
    imageUrl: photo.imageUrl,
    storagePath: photo.storagePath,
    pending: photo.pending,
    photoType: photo.photoType,
    uploadedBy: photo.uploadedBy,
    fileName: photo.fileName,
    fileSizeBytes: photo.fileSizeBytes,
    fileMimeType: photo.fileMimeType,
    isBeforeCandidate: photo.isBeforeCandidate,
    isAfterCandidate: photo.isAfterCandidate,
    status: photo.status,
    createdAt: photo.createdAt,
    updatedAt: photo.updatedAt,
  };
}

/** `null` pour une mensuration dont le type Supabase ne correspond à aucune clé mock connue. */
function toMockBodyMeasurement(measurement: SupabaseBodyMeasurement): BodyMeasurement | null {
  const type = fromSupabaseMeasurementType(measurement.type);
  if (!type) {
    return null;
  }
  return {
    id: measurement.id,
    studentId: measurement.studentId,
    type,
    unit: measurement.unit === "kg" ? "kg" : "cm",
    startValue: measurement.startValue,
    currentValue: measurement.currentValue,
    note: measurement.note,
    lastUpdatedAt: measurement.lastUpdatedAt,
  };
}

function toMockCustomMeasurement(measurement: SupabaseCustomMeasurement): CustomMeasurement {
  return {
    id: measurement.id,
    studentId: measurement.studentId,
    name: measurement.name,
    unit: measurement.unit,
    startValue: measurement.startValue,
    currentValue: measurement.currentValue,
    note: measurement.note,
    lastUpdatedAt: measurement.lastUpdatedAt,
  };
}

function toMockCoachNote(note: SupabaseCoachNote): CoachNote {
  return { id: note.id, studentId: note.studentId, text: note.text, createdAt: note.createdAt };
}

/** `month` sert de libellé d'axe pour WeightChart : jour/mois court plutôt qu'un vrai nom de mois mocké. */
function toMockWeightEntry(entry: SupabaseWeightEntry): WeightEntry {
  const date = new Date(entry.recordedAt);
  const label = Number.isNaN(date.getTime())
    ? entry.recordedAt
    : date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
  return { month: label, kg: entry.weightKg };
}

function toMockPaymentEntry(entry: SupabasePaymentEntry): StudentPaymentEntry {
  return {
    paymentId: entry.id,
    studentId: entry.studentId,
    amount: entry.amount,
    date: entry.date,
    method: entry.method,
    note: entry.note,
    status: entry.status,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function toMockPaymentProfile(
  studentId: string,
  payment: SupabasePayment | null,
  entries: SupabasePaymentEntry[],
): StudentPaymentProfile {
  if (!payment) {
    return normalizePaymentProfile(studentId, null);
  }
  return {
    studentId,
    offerName: payment.offerName,
    monthlyPriceEuros: payment.monthlyPriceEuros,
    durationMonths: payment.durationMonths,
    totalPriceEuros: payment.totalPriceEuros,
    paidAmountEuros: payment.paidAmountEuros,
    status: payment.status,
    method: payment.method,
    nextPaymentDate: payment.nextPaymentDate,
    installmentsTotal: payment.installmentsTotal,
    installmentsPaid: payment.installmentsPaid,
    entries: entries.map(toMockPaymentEntry),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
  };
}

/**
 * Compose un AdminStudent complet à partir de la fiche élève Supabase
 * (identité + statut, table `students`) et de son profil coaching (table
 * `student_profiles`, voir docs/supabase-student-model.md), déjà convertis
 * en types mock. `measurementHistory` reste volontairement vide : l'historique
 * de mensurations n'est pas encore migré — normalizeAdminStudent() garantit
 * un affichage propre plutôt qu'un plantage. `assignedProgramIds` vient de
 * la table `assignments` (voir lib/supabase/programs.ts) ;
 * `assignedNutritionPlanIds` vient de `nutrition_plans.student_id`
 * directement (voir lib/supabase/nutrition.ts) ; `assignedDocumentIds` vient
 * de `document_assignments` (voir lib/supabase/documents.ts) — ces trois
 * mécanismes ne sont jamais mélangés entre eux.
 *
 * `profile` peut être `null` (élève sans fiche `student_profiles` encore
 * créée) : les champs coaching retombent alors sur des valeurs par défaut
 * plutôt que de laisser passer `undefined`/`NaN` à l'affichage.
 */
function toAdminStudent(
  student: SupabaseStudent,
  profile: SupabaseStudentProfile | null,
  extras: {
    weightHistory: WeightEntry[];
    measurements: BodyMeasurement[];
    customMeasurements: CustomMeasurement[];
    progressPhotos: ProgressPhoto[];
    paymentProfile: StudentPaymentProfile;
    coachNotes: CoachNote[];
    assignedProgramIds: string[];
    assignedNutritionPlanIds: string[];
    assignedDocumentIds: string[];
  },
): AdminStudent {
  const currentWeightKg = profile?.currentWeightKg ?? 0;
  // `weight_entries` est trié par date croissante (voir getWeightHistory) :
  // son premier relevé est le repli le plus fiable pour le poids de départ
  // quand student_profiles.start_weight_kg n'a jamais été renseigné —
  // préférable à retomber directement sur le poids actuel (voir
  // docs/supabase-student-model.md).
  const startWeightKg = profile?.startWeightKg ?? extras.weightHistory[0]?.kg ?? currentWeightKg;
  return {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    email: student.email,
    phone: student.phone,
    age: profile?.age ?? 0,
    heightCm: profile?.heightCm ?? 0,
    currentWeightKg,
    startWeightKg,
    targetWeightKg: profile?.targetWeightKg ?? currentWeightKg,
    // `main_goal` est le champ d'objectif détaillé pré-existant (section
    // "Objectifs" de /profil, voir docs/supabase-student-model.md) ;
    // `goal` est le résumé court ajouté par la migration 4bis. Un élève
    // renseigné uniquement côté `main_goal` ne doit pas afficher "Non
    // renseigné" ici — on privilégie `main_goal` quand il existe.
    goal: profile?.mainGoal || profile?.goal || "",
    level: profile?.level ?? "",
    trainingFrequencyPerWeek: profile?.trainingFrequencyPerWeek ?? 0,
    trainingLocation: profile?.trainingLocation ?? "",
    status: student.status,
    startDate: student.startDate,
    lastLoginAt: student.lastLoginAt,
    foodPreferences: profile?.foodPreferences ?? emptyFoodPreferences,
    sportPreferences: profile?.sportPreferences ?? emptySportPreferences,
    injuries: profile?.injuryNote ?? "",
    weightHistory: extras.weightHistory,
    measurements: extras.measurements,
    customMeasurements: extras.customMeasurements,
    measurementHistory: [],
    progressPhotos: extras.progressPhotos,
    paymentProfile: extras.paymentProfile,
    assignedProgramIds: extras.assignedProgramIds,
    assignedNutritionPlanIds: extras.assignedNutritionPlanIds,
    assignedDocumentIds: extras.assignedDocumentIds,
    coachNotes: extras.coachNotes,
    createdAt: student.createdAt,
    updatedAt: student.updatedAt,
  };
}

const emptyFoodPreferences: AdminFoodPreferences = { liked: [], disliked: [], intolerances: [], diet: "" };
const emptySportPreferences: AdminSportPreferences = {
  sports: [],
  equipment: [],
  preferredExercises: [],
  exercisesToAvoid: [],
};

/* ─── Lecture ─── */

/**
 * Liste des élèves pour /admin/eleves. Renvoie un tableau vide (jamais
 * d'exception) si Supabase n'a aucun élève ou en cas d'erreur — à
 * l'appelant de décider du repli mock (voir hooks/useSupabaseStudents.ts).
 */
export async function getStudents(supabase: TypedSupabaseClient): Promise<AdminStudent[]> {
  const { data, error } = await supabase.from("students").select("*").order("created_at", { ascending: false });
  devWarn("getStudents", error);
  if (!data || data.length === 0) {
    return [];
  }

  const studentIds = data.map((row) => row.id);
  const [
    { data: profileRows, error: profilesError },
    { data: paymentRows, error: paymentsError },
    programIdsByStudent,
    nutritionPlanIdsByStudent,
    documentIdsByStudent,
  ] = await Promise.all([
    supabase.from("student_profiles").select("*").in("student_id", studentIds),
    supabase.from("payments").select("*").in("student_id", studentIds),
    getAssignedProgramIdsByStudent(supabase, studentIds),
    getAssignedNutritionPlanIdsByStudent(supabase, studentIds),
    getAssignedDocumentIdsByStudent(supabase, studentIds),
  ]);
  devWarn("getStudents (profiles)", profilesError);
  devWarn("getStudents (payments)", paymentsError);
  const profileByStudent = new Map((profileRows ?? []).map((row) => [row.student_id, mapStudentProfileRow(row)]));
  const paymentByStudent = new Map((paymentRows ?? []).map((row) => [row.student_id, mapPaymentRow(row)]));

  return data.map((row) => {
    const student = mapStudentRow(row);
    return toAdminStudent(student, profileByStudent.get(student.id) ?? null, {
      weightHistory: [],
      measurements: [],
      customMeasurements: [],
      progressPhotos: [],
      paymentProfile: toMockPaymentProfile(student.id, paymentByStudent.get(student.id) ?? null, []),
      coachNotes: [],
      assignedProgramIds: programIdsByStudent.get(student.id) ?? [],
      assignedNutritionPlanIds: nutritionPlanIdsByStudent.get(student.id) ?? [],
      assignedDocumentIds: documentIdsByStudent.get(student.id) ?? [],
    });
  });
}

/** Fiche élève de base (table `students`), ou `null` si introuvable/erreur. */
export async function getStudentById(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<SupabaseStudent | null> {
  const { data, error } = await supabase.from("students").select("*").eq("id", studentId).maybeSingle();
  devWarn("getStudentById", error);
  return data ? mapStudentRow(data) : null;
}

export async function getStudentProfile(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<SupabaseStudentProfile | null> {
  const { data, error } = await supabase
    .from("student_profiles")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();
  devWarn("getStudentProfile", error);
  return data ? mapStudentProfileRow(data) : null;
}

export async function getStudentMeasurements(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<{ measurements: BodyMeasurement[]; customMeasurements: CustomMeasurement[] }> {
  const [{ data: standardRows, error: standardError }, { data: customRows, error: customError }] = await Promise.all([
    supabase.from("body_measurements").select("*").eq("student_id", studentId),
    supabase.from("custom_measurements").select("*").eq("student_id", studentId),
  ]);
  devWarn("getStudentMeasurements", standardError);
  devWarn("getStudentMeasurements (custom)", customError);

  const measurements = (standardRows ?? [])
    .map((row) => toMockBodyMeasurement(mapBodyMeasurementRow(row)))
    .filter((m): m is BodyMeasurement => m !== null);
  const customMeasurements = (customRows ?? []).map((row) => toMockCustomMeasurement(mapCustomMeasurementRow(row)));

  return { measurements, customMeasurements };
}

export async function getStudentProgressPhotos(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<ProgressPhoto[]> {
  const { data, error } = await supabase
    .from("progress_photos")
    .select("*")
    .eq("student_id", studentId)
    .order("date", { ascending: true });
  devWarn("getStudentProgressPhotos", error);
  return (data ?? []).map((row) => toMockProgressPhoto(mapProgressPhotoRow(row)));
}

/** Toujours une fiche paiement exploitable (jamais `null`) — vide si aucun paiement n'existe encore. */
export async function getStudentPayments(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<StudentPaymentProfile> {
  const { data: paymentRow, error: paymentError } = await supabase
    .from("payments")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();
  devWarn("getStudentPayments", paymentError);

  if (!paymentRow) {
    return normalizePaymentProfile(studentId, null);
  }

  const { data: entryRows, error: entriesError } = await supabase
    .from("payment_entries")
    .select("*")
    .eq("student_id", studentId)
    .order("date", { ascending: true });
  devWarn("getStudentPayments (entries)", entriesError);

  return toMockPaymentProfile(
    studentId,
    mapPaymentRow(paymentRow),
    (entryRows ?? []).map(mapPaymentEntryRow),
  );
}

export async function getStudentCoachNotes(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<CoachNote[]> {
  const { data, error } = await supabase
    .from("coach_notes")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: true });
  devWarn("getStudentCoachNotes", error);
  return (data ?? []).map((row) => toMockCoachNote(mapCoachNoteRow(row)));
}

/**
 * Fiche élève complète (toutes les sous-ressources en parallèle), utilisée
 * par hooks/useSupabaseStudentDetail.ts pour /admin/eleves/[studentId].
 * `null` si l'élève n'existe pas côté Supabase — l'appelant retombe alors
 * sur la logique mock existante (isLinked / useAdminData).
 */
export async function getFullAdminStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminStudent | null> {
  const student = await getStudentById(supabase, studentId);
  if (!student) {
    return null;
  }

  const [
    profile,
    weightHistory,
    { measurements, customMeasurements },
    progressPhotos,
    paymentProfile,
    coachNotes,
    assignedProgramIdsByStudent,
    assignedNutritionPlanIdsByStudent,
    assignedDocumentIdsByStudent,
  ] = await Promise.all([
    getStudentProfile(supabase, studentId),
    getWeightHistory(supabase, studentId),
    getStudentMeasurements(supabase, studentId),
    getStudentProgressPhotos(supabase, studentId),
    getStudentPayments(supabase, studentId),
    getStudentCoachNotes(supabase, studentId),
    getAssignedProgramIdsByStudent(supabase, [studentId]),
    getAssignedNutritionPlanIdsByStudent(supabase, [studentId]),
    getAssignedDocumentIdsByStudent(supabase, [studentId]),
  ]);

  return toAdminStudent(student, profile, {
    weightHistory,
    measurements,
    customMeasurements,
    progressPhotos,
    paymentProfile,
    coachNotes,
    assignedProgramIds: assignedProgramIdsByStudent.get(studentId) ?? [],
    assignedNutritionPlanIds: assignedNutritionPlanIdsByStudent.get(studentId) ?? [],
    assignedDocumentIds: assignedDocumentIdsByStudent.get(studentId) ?? [],
  });
}

/**
 * Historique de poids trié par date croissante (le plus ancien en premier,
 * pour matcher l'ordre attendu par WeightChart/computeWeightEvolution).
 * Tableau vide si aucun relevé n'existe encore.
 */
export async function getWeightHistory(supabase: TypedSupabaseClient, studentId: string): Promise<WeightEntry[]> {
  const { data, error } = await supabase
    .from("weight_entries")
    .select("*")
    .eq("student_id", studentId)
    .order("recorded_at", { ascending: true });
  devWarn("getWeightHistory", error);
  return (data ?? []).map((row) => toMockWeightEntry(mapWeightEntryRow(row)));
}

/**
 * Ajoute un relevé de poids (`source` distingue une saisie élève d'une
 * saisie coach, voir docs/supabase-student-model.md) — appelé à chaque mise
 * à jour du poids actuel, en plus de l'écriture sur `student_profiles`, pour
 * que la carte "Évolution du poids" ait une vraie courbe.
 */
export async function addWeightEntry(
  supabase: TypedSupabaseClient,
  studentId: string,
  weightKg: number,
  source: WeightEntrySource,
): Promise<boolean> {
  const { error } = await supabase.from("weight_entries").insert({
    student_id: studentId,
    weight_kg: weightKg,
    recorded_at: new Date().toISOString().slice(0, 10),
    source,
  });
  devWarn("addWeightEntry", error);
  // "initial" = relevé créé automatiquement pendant l'onboarding (déjà
  // couvert par l'évènement "onboarding_completed") — pas de doublon dans
  // le centre d'activité pour cette source.
  if (!error && source !== "initial") {
    await logActivityEvent(supabase, {
      studentId,
      actorType: source === "student_update" ? "student" : "coach",
      eventType: "weight_added",
      title: "Poids mis à jour",
      description: `Nouveau poids enregistré : ${weightKg} kg.`,
      metadata: buildStudentActivityLink(studentId),
    });
  }
  return !error;
}

/* ─── Écriture ─── */

/**
 * Écrit les champs "infos personnelles" (EditStudentModal), le statut
 * (pause/réactiver/archiver) et les détails coaching (poids, taille,
 * objectif, niveau, fréquence, lieu) à partir d'un seul `Partial<AdminStudent>`
 * — en interne, chaque champ est routé vers la bonne table (`students` pour
 * l'identité/statut, `student_profiles` pour les détails coaching, voir
 * docs/supabase-student-model.md) sans que l'appelant ait à le savoir.
 * Les deux écritures sont indépendantes : si l'une échoue (RLS, réseau...),
 * l'autre est quand même tentée plutôt que de tout bloquer. Les autres
 * champs d'AdminStudent (mensurations, photos, paiement...) passent par
 * leurs propres fonctions d'écriture ci-dessous.
 */
export async function updateStudentFields(
  supabase: TypedSupabaseClient,
  studentId: string,
  partial: Partial<AdminStudent>,
): Promise<boolean> {
  const studentUpdate: Database["public"]["Tables"]["students"]["Update"] = {};
  if (partial.firstName !== undefined) studentUpdate.first_name = partial.firstName;
  if (partial.lastName !== undefined) studentUpdate.last_name = partial.lastName;
  if (partial.email !== undefined) studentUpdate.email = partial.email;
  if (partial.phone !== undefined) studentUpdate.phone = partial.phone;
  if (partial.status !== undefined) {
    studentUpdate.status = STATUS_APP_TO_DB[partial.status];
  }

  const profileUpdate: Database["public"]["Tables"]["student_profiles"]["Update"] = {};
  if (partial.age !== undefined) profileUpdate.age = partial.age;
  if (partial.heightCm !== undefined) profileUpdate.height_cm = partial.heightCm;
  if (partial.currentWeightKg !== undefined) profileUpdate.current_weight_kg = partial.currentWeightKg;
  if (partial.targetWeightKg !== undefined) profileUpdate.target_weight_kg = partial.targetWeightKg;
  // `main_goal` et `sport_level` sont les colonnes réellement utilisées sur
  // ce projet pour l'objectif et le niveau sportif (voir toAdminStudent /
  // mapStudentProfileRow) — on écrit uniquement celles-ci, pas les colonnes
  // `goal`/`level` ajoutées par la migration 4bis, qui ne servent plus que
  // de repli en lecture si jamais main_goal/sport_level sont vides.
  if (partial.goal !== undefined) profileUpdate.main_goal = partial.goal;
  if (partial.level !== undefined) profileUpdate.sport_level = partial.level;
  if (partial.trainingFrequencyPerWeek !== undefined) {
    profileUpdate.training_frequency_per_week = partial.trainingFrequencyPerWeek;
  }
  if (partial.trainingLocation !== undefined) profileUpdate.training_location = partial.trainingLocation;

  const writes: Promise<boolean>[] = [];

  if (Object.keys(studentUpdate).length > 0) {
    writes.push(
      (async () => {
        const { error } = await supabase.from("students").update(studentUpdate).eq("id", studentId);
        devWarn("updateStudentFields (students)", error);
        return !error;
      })(),
    );
  }

  if (Object.keys(profileUpdate).length > 0) {
    writes.push(
      (async () => {
        // Update-or-insert explicite plutôt qu'un .upsert({...}, {onConflict:
        // "student_id"}) : ce dernier échoue silencieusement (ou avec une
        // erreur uniquement visible en dev) si aucune contrainte unique/
        // exclusion n'est enregistrée exactement sur cette colonne côté
        // Postgres, même si les valeurs sont en pratique uniques — vu en
        // pratique sur ce projet pour `students.status` (voir
        // STATUS_APP_TO_DB), donc on ne prend plus ce risque ici non plus.
        const { data: existing, error: lookupError } = await supabase
          .from("student_profiles")
          .select("id")
          .eq("student_id", studentId)
          .maybeSingle();
        devWarn("updateStudentFields (student_profiles lookup)", lookupError);
        if (lookupError) {
          return false;
        }

        if (existing) {
          const { error } = await supabase.from("student_profiles").update(profileUpdate).eq("student_id", studentId);
          devWarn("updateStudentFields (student_profiles update)", error);
          return !error;
        }

        const { error } = await supabase.from("student_profiles").insert({ student_id: studentId, ...profileUpdate });
        devWarn("updateStudentFields (student_profiles insert)", error);
        return !error;
      })(),
    );
  }

  if (writes.length === 0) {
    return true;
  }
  const results = await Promise.all(writes);
  return results.every(Boolean);
}

/**
 * Met à jour `students.last_login_at` pour l'élève associé à cet utilisateur
 * Auth — appelée depuis LoginForm juste après une connexion réussie, pour
 * que "Dernière connexion" dans /admin/eleves/[studentId] reflète une vraie
 * date plutôt que d'afficher "Jamais" indéfiniment. Sans effet (et sans
 * erreur) si l'utilisateur connecté n'est pas un élève (coach/admin).
 */
export async function updateLastLoginTimestamp(supabase: TypedSupabaseClient, userId: string): Promise<void> {
  const { error } = await supabase
    .from("students")
    .update({ last_login_at: new Date().toISOString() })
    .eq("user_id", userId);
  devWarn("updateLastLoginTimestamp", error);
}

/**
 * Ajoute/actualise une ou plusieurs mensurations préréglées en une fois
 * (une ligne `body_measurements` par type, contrainte unique
 * (student_id, type) côté DB — voir supabase/schema.sql). Une mensuration
 * saisie pour la première fois crée sa ligne avec startValue = currentValue
 * ("Première mesure"), exactement comme le mock (hooks/useStudentProfile.ts).
 */
export async function upsertBodyMeasurements(
  supabase: TypedSupabaseClient,
  studentId: string,
  values: Partial<Record<BodyMeasurementType, number>>,
  date: string,
  note: string,
): Promise<void> {
  const types = (Object.keys(values) as BodyMeasurementType[]).filter((type) => values[type] !== undefined);
  if (types.length === 0) {
    return;
  }

  const supabaseTypes = types.map(toSupabaseMeasurementType);
  const { data: existingRows, error: existingError } = await supabase
    .from("body_measurements")
    .select("*")
    .eq("student_id", studentId)
    .in("type", supabaseTypes);
  devWarn("upsertBodyMeasurements (lookup)", existingError);
  const existingByType = new Map((existingRows ?? []).map((row) => [row.type, row]));

  const rows: Database["public"]["Tables"]["body_measurements"]["Insert"][] = types.map((type) => {
    const supabaseType = toSupabaseMeasurementType(type);
    const newValue = values[type] as number;
    const existing = existingByType.get(supabaseType);
    return {
      ...(existing ? { id: existing.id } : {}),
      student_id: studentId,
      type: supabaseType,
      unit: type === "poids" ? "kg" : "cm",
      start_value: existing ? existing.start_value : newValue,
      current_value: newValue,
      note: note || existing?.note || "",
      last_updated_at: date,
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await supabase.from("body_measurements").upsert(rows, { onConflict: "student_id,type" });
  devWarn("upsertBodyMeasurements", error);
}

/**
 * Ajoute/actualise une mesure personnalisée par nom (insensible à la
 * casse), comme hooks/useStudentProfile.ts côté mock : une mesure
 * existante est mise à jour plutôt que dupliquée.
 */
export async function upsertCustomMeasurement(
  supabase: TypedSupabaseClient,
  studentId: string,
  custom: CustomMeasurementInput,
  date: string,
): Promise<void> {
  const { data: existingRows, error: lookupError } = await supabase
    .from("custom_measurements")
    .select("*")
    .eq("student_id", studentId);
  devWarn("upsertCustomMeasurement (lookup)", lookupError);

  const normalizedName = custom.name.trim().toLowerCase();
  const existing = (existingRows ?? []).find((row) => row.name.trim().toLowerCase() === normalizedName);

  if (existing) {
    const { error } = await supabase
      .from("custom_measurements")
      .update({
        current_value: custom.value,
        note: custom.note || existing.note,
        last_updated_at: date,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    devWarn("upsertCustomMeasurement (update)", error);
    return;
  }

  const { error } = await supabase.from("custom_measurements").insert({
    student_id: studentId,
    name: custom.name,
    unit: custom.unit,
    start_value: custom.value,
    current_value: custom.value,
    note: custom.note,
    last_updated_at: date,
  });
  devWarn("upsertCustomMeasurement (insert)", error);
}

export async function addCoachNoteSupabase(
  supabase: TypedSupabaseClient,
  studentId: string,
  text: string,
): Promise<CoachNote | null> {
  const { data, error } = await supabase
    .from("coach_notes")
    .insert({ student_id: studentId, text })
    .select("*")
    .single();
  devWarn("addCoachNoteSupabase", error);
  if (data) {
    await logActivityEvent(supabase, {
      studentId,
      actorType: "coach",
      eventType: "coach_note_added",
      title: "Note coach ajoutée",
      description: text.length > 140 ? `${text.slice(0, 140)}…` : text,
      metadata: buildStudentActivityLink(studentId),
    });
  }
  return data ? toMockCoachNote(mapCoachNoteRow(data)) : null;
}

/**
 * `photo.imageUrl` peut contenir une URL classique ou une dataUrl base64
 * (aucun Storage Supabase réel branché à cette étape, voir consignes de
 * cette migration) — stockée telle quelle dans `progress_photos.image_url`.
 */
export async function addProgressPhotoSupabase(
  supabase: TypedSupabaseClient,
  studentId: string,
  photo: Omit<ProgressPhoto, "id" | "studentId">,
): Promise<ProgressPhoto | null> {
  const { data, error } = await supabase
    .from("progress_photos")
    .insert({
      student_id: studentId,
      type: photo.type,
      date: photo.date,
      weight_kg: photo.weightKg,
      note: photo.note,
      image_url: photo.imageUrl,
      storage_path: photo.storagePath,
      pending: photo.pending,
    })
    .select("*")
    .single();
  devWarn("addProgressPhotoSupabase", error);
  return data ? toMockProgressPhoto(mapProgressPhotoRow(data)) : null;
}

export async function deleteProgressPhotoSupabase(supabase: TypedSupabaseClient, photoId: string): Promise<boolean> {
  const { error } = await supabase.from("progress_photos").delete().eq("id", photoId);
  devWarn("deleteProgressPhotoSupabase", error);
  return !error;
}

/**
 * Écrit la fiche paiement complète : upsert du profil (`payments`, une
 * ligne par élève) puis insertion des nouveaux versements uniquement
 * (`payment_entries`) — `previousEntryCount` permet de ne réinsérer que les
 * entrées ajoutées depuis le dernier chargement (PaymentSection renvoie
 * toujours le tableau `entries` complet, voir components/admin/PaymentSection.tsx).
 * Renvoie la fiche rechargée depuis Supabase (ids/dates réels) pour que
 * l'état local reste fidèle à la base.
 */
export async function updateStudentPaymentSupabase(
  supabase: TypedSupabaseClient,
  studentId: string,
  previousEntryCount: number,
  nextProfile: StudentPaymentProfile,
): Promise<StudentPaymentProfile> {
  const { data: paymentRow, error: upsertError } = await supabase
    .from("payments")
    .upsert(
      {
        student_id: studentId,
        offer_name: nextProfile.offerName,
        monthly_price_euros: nextProfile.monthlyPriceEuros,
        duration_months: nextProfile.durationMonths,
        total_price_euros: nextProfile.totalPriceEuros,
        paid_amount_euros: nextProfile.paidAmountEuros,
        status: nextProfile.status,
        method: nextProfile.method,
        next_payment_date: nextProfile.nextPaymentDate,
        installments_total: nextProfile.installmentsTotal,
        installments_paid: nextProfile.installmentsPaid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id" },
    )
    .select("*")
    .single();
  devWarn("updateStudentPaymentSupabase", upsertError);

  if (paymentRow && nextProfile.entries.length > previousEntryCount) {
    const newEntries = nextProfile.entries.slice(previousEntryCount);
    const { error: entriesError } = await supabase.from("payment_entries").insert(
      newEntries.map((entry) => ({
        payment_id: paymentRow.id,
        student_id: studentId,
        amount: entry.amount,
        date: entry.date,
        method: entry.method,
        note: entry.note,
        status: entry.status,
      })),
    );
    devWarn("updateStudentPaymentSupabase (entries)", entriesError);
  }

  return getStudentPayments(supabase, studentId);
}
