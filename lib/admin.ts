import type {
  AdminContentStatus,
  AdminDocument,
  AdminDocumentStatus,
  AdminProgram,
  AdminNutritionPlan,
  AdminStudent,
  AdminStudentFeedback,
  CoachAccountStatus,
  CoachRole,
  DocumentCategory,
  DocumentDistributionMode,
  DocumentType,
  ExerciseCategory,
  ExerciseEquipment,
  ExerciseLevel,
  ExerciseLibraryItem,
  FeedbackStatus,
  FeedbackType,
  StudentAccountStatus,
  StudentDocumentUnlock,
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

/* ─── Documents : niveaux et déblocage progressif ─── */

export const distributionModeLabels: Record<DocumentDistributionMode, string> = {
  immediat: "Disponible immédiatement",
  "deblocage-auto": "Déblocage automatique progressif",
  "deblocage-manuel": "Déblocage manuel par le coach",
};

export const documentDifficultyLabels: Record<AdminDocument["difficulty"], string> = {
  facile: "Facile",
  "intermédiaire": "Intermédiaire",
  "avancé": "Avancé",
};

export interface DocumentAvailability {
  available: boolean;
  unlockDate: string | null;
  manuallyUnlocked: boolean;
}

/**
 * Calcule si un document est disponible pour un élève selon son mode de
 * distribution : immédiat (toujours dispo), déblocage manuel (dispo
 * seulement si présent dans manualUnlocks), ou déblocage automatique
 * (dispo à partir de startDate + (level - 1) * unlockAfterWeeks
 * semaines). Ex: niveau 1/unlockAfterWeeks=2 → dispo semaine 1, niveau 2 →
 * semaine 3, niveau 3 → semaine 5.
 */
export function computeDocumentAvailability(
  student: { startDate: string },
  document: AdminDocument,
  manualUnlocks: StudentDocumentUnlock[],
  reference = ADMIN_REFERENCE_DATE,
): DocumentAvailability {
  const manuallyUnlocked = manualUnlocks.some((u) => u.documentId === document.id);
  if (manuallyUnlocked) {
    return { available: true, unlockDate: null, manuallyUnlocked: true };
  }
  if (document.distributionMode === "immediat") {
    return { available: true, unlockDate: null, manuallyUnlocked: false };
  }
  if (document.distributionMode === "deblocage-manuel") {
    return { available: false, unlockDate: null, manuallyUnlocked: false };
  }
  const unlockOffsetWeeks = Math.max(0, document.level - 1) * document.unlockAfterWeeks;
  const unlockDate = new Date(student.startDate);
  unlockDate.setDate(unlockDate.getDate() + unlockOffsetWeeks * 7);
  const available = reference.getTime() >= unlockDate.getTime();
  return {
    available,
    unlockDate: available ? null : unlockDate.toISOString().slice(0, 10),
    manuallyUnlocked: false,
  };
}

/* ─── Banque d'exercices ─── */

export const exerciseCategoryLabels: Record<ExerciseCategory, string> = {
  push: "Push",
  pull: "Pull",
  legs: "Legs",
  cardio: "Cardio",
  mobilité: "Mobilité",
  abdos: "Abdos",
  autre: "Autre",
};

export const exerciseEquipmentLabels: Record<ExerciseEquipment, string> = {
  haltères: "Haltères",
  barre: "Barre",
  machine: "Machine",
  "poids du corps": "Poids du corps",
  élastique: "Élastique",
  autre: "Autre",
};

export const exerciseLevelLabels: Record<ExerciseLevel, string> = {
  débutant: "Débutant",
  intermédiaire: "Intermédiaire",
  avancé: "Avancé",
};

export function matchesExerciseSearch(item: ExerciseLibraryItem, query: string): boolean {
  if (!query.trim()) return true;
  const haystack = [item.name, item.muscleGroup, item.equipment, ...item.tags].join(" ").toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

/* ─── Coachs ─── */

export const coachRoleLabels: Record<CoachRole, string> = {
  coach: "Coach",
  admin: "Admin",
  assistant: "Assistant",
};

export const coachStatusLabels: Record<CoachAccountStatus, string> = {
  actif: "Actif",
  inactif: "Inactif",
};
