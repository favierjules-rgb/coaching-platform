import type {
  AdminContentStatus,
  AdminDocument,
  AdminDocumentStatus,
  AdminProgram,
  AdminNutritionPlan,
  AdminStudent,
  AdminStudentFeedback,
  DocumentCategory,
  DocumentType,
  FeedbackStatus,
  FeedbackType,
  StudentAccountStatus,
} from "@/types";

export const studentStatusLabels: Record<StudentAccountStatus, string> = {
  actif: "Actif",
  pause: "En pause",
  terminé: "Terminé",
};

export const contentStatusLabels: Record<AdminContentStatus, string> = {
  brouillon: "Brouillon",
  actif: "Actif",
  archivé: "Archivé",
};

export const documentStatusLabels: Record<AdminDocumentStatus, string> = {
  brouillon: "Brouillon",
  publié: "Publié",
  archivé: "Archivé",
};

export const feedbackTypeLabels: Record<FeedbackType, string> = {
  entrainement: "Entraînement",
  nutrition: "Nutrition",
  profil: "Profil",
};

export const feedbackStatusLabels: Record<FeedbackStatus, string> = {
  "a-traiter": "À traiter",
  traité: "Traité",
  important: "Important",
};

export const documentTypeLabels: Record<DocumentType, string> = {
  pdf: "PDF",
  vidéo: "Vidéo",
  lien: "Lien",
  guide: "Guide",
  image: "Image",
};

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  nutrition: "Nutrition",
  entrainement: "Entraînement",
  administratif: "Administratif",
};

export function fullName(student: { firstName: string; lastName: string }): string {
  return `${student.firstName} ${student.lastName}`;
}

export function matchesStudentSearch(student: AdminStudent, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = `${fullName(student)} ${student.email}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function matchesTextSearch(fields: string[], query: string): boolean {
  if (!query.trim()) return true;
  const haystack = fields.join(" ").toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function weightProgressLabel(student: AdminStudent): string {
  const delta = Math.round((student.currentWeightKg - student.startWeightKg) * 10) / 10;
  const sign = delta >= 0 ? "+" : "";
  return `${student.startWeightKg} → ${student.currentWeightKg} kg (${sign}${delta} kg)`;
}

export function daysSince(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const diffMs = Date.now() - new Date(dateIso).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function formatDate(dateIso: string): string {
  return new Date(dateIso).toLocaleDateString("fr-FR");
}

export function formatDateTime(dateIso: string): string {
  return new Date(dateIso).toLocaleString("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export function studentsAssignedToProgram(
  program: AdminProgram,
  students: AdminStudent[],
): AdminStudent[] {
  return students.filter((s) => program.assignedStudentIds.includes(s.id));
}

export function studentsAssignedToPlan(
  plan: AdminNutritionPlan,
  students: AdminStudent[],
): AdminStudent[] {
  return students.filter((s) => plan.assignedStudentIds.includes(s.id));
}

export function studentsAssignedToDocument(
  document: AdminDocument,
  students: AdminStudent[],
): AdminStudent[] {
  return students.filter((s) => document.assignedStudentIds.includes(s.id));
}

export function totalSessions(program: AdminProgram): number {
  return program.sessions.filter((s) => !s.isRestDay).length;
}

export function totalWeeks(program: AdminProgram): number {
  return new Set(program.sessions.map((s) => s.weekNumber)).size || program.durationWeeks;
}

let idCounter = 0;
export function generateId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

export const weekDays = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

export const mealSlots = [
  "Petit déjeuner",
  "Collation matin",
  "Midi",
  "Collation après-midi",
  "Dîner",
  "Compléments",
] as const;

/**
 * "Aujourd'hui" fictif utilisé pour calculer les listes de suivi du
 * dashboard admin (dernière connexion, dernier retour...), pour que la
 * démo reste cohérente indépendamment de la date réelle du test. À
 * remplacer par des requêtes réelles une fois Supabase connecté.
 */
export const ADMIN_REFERENCE_DATE = new Date("2026-07-02T12:00:00.000Z");

export function daysBetween(dateIso: string, reference = ADMIN_REFERENCE_DATE): number {
  return Math.floor((reference.getTime() - new Date(dateIso).getTime()) / 86_400_000);
}

export function studentsWithoutRecentLogin(students: AdminStudent[], thresholdDays = 14): AdminStudent[] {
  return students.filter(
    (s) => s.status === "actif" && (s.lastLoginAt === null || daysBetween(s.lastLoginAt) > thresholdDays),
  );
}

export function studentsWithStaleWeight(students: AdminStudent[]): AdminStudent[] {
  return students.filter((s) => s.status === "actif" && s.currentWeightKg === s.startWeightKg);
}

export function studentsWithRecentFeedback(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
  withinDays = 2,
): AdminStudent[] {
  const recentStudentIds = new Set(
    feedback.filter((f) => daysBetween(f.date) <= withinDays).map((f) => f.studentId),
  );
  return students.filter((s) => recentStudentIds.has(s.id));
}

function studentsMissingRecentFeedback(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
  type: FeedbackType,
  assignedIdsKey: "assignedProgramIds" | "assignedNutritionPlanIds",
  withinDays = 2,
): AdminStudent[] {
  const recentIds = new Set(
    feedback
      .filter((f) => f.type === type && daysBetween(f.date) <= withinDays)
      .map((f) => f.studentId),
  );
  return students.filter(
    (s) => s.status === "actif" && s[assignedIdsKey].length > 0 && !recentIds.has(s.id),
  );
}

export function studentsWithUnvalidatedSession(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
): AdminStudent[] {
  return studentsMissingRecentFeedback(students, feedback, "entrainement", "assignedProgramIds");
}

export function studentsWithUnvalidatedNutritionDay(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
): AdminStudent[] {
  return studentsMissingRecentFeedback(students, feedback, "nutrition", "assignedNutritionPlanIds");
}
