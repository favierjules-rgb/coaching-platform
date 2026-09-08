import { currentDate } from "@/lib/clock";
import { movementPatternLabels } from "@/lib/movement-patterns";
import { normalizePaymentProfile } from "@/lib/payments";
import type {
  AdminContentStatus,
  AdminDocument,
  AdminDocumentStatus,
  AdminProgram,
  AdminNutritionPlan,
  AdminStudent,
  AdminStudentFeedback,
  AppointmentStatus,
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
  texte: "Texte / note",
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
  if (student.currentWeightKg <= 0) {
    return "Non renseigné";
  }
  const delta = Math.round((student.currentWeightKg - student.startWeightKg) * 10) / 10;
  const sign = delta >= 0 ? "+" : "";
  return `${student.startWeightKg} → ${student.currentWeightKg} kg (${sign}${delta} kg)`;
}

/**
 * Renvoie une copie de l'élève admin où toutes les listes/objets imbriqués
 * sont garantis définis (tableau vide, objet aux champs vides...) même si
 * l'enregistrement en localStorage date d'avant l'ajout de ces champs, ou a
 * été corrompu. À appeler juste après avoir récupéré un AdminStudent et
 * avant de le passer à la page/aux composants détail élève, pour ne jamais
 * planter sur measurements/customMeasurements/progressPhotos/weightHistory/
 * coachNotes/assignedXIds/injuries/foodPreferences/sportPreferences absents.
 */
export function normalizeAdminStudent(student: AdminStudent): AdminStudent {
  return {
    ...student,
    injuries: student.injuries ?? "",
    goal: student.goal ?? "",
    weightHistory: Array.isArray(student.weightHistory) ? student.weightHistory : [],
    measurements: Array.isArray(student.measurements) ? student.measurements : [],
    customMeasurements: Array.isArray(student.customMeasurements) ? student.customMeasurements : [],
    measurementHistory: Array.isArray(student.measurementHistory) ? student.measurementHistory : [],
    progressPhotos: Array.isArray(student.progressPhotos) ? student.progressPhotos : [],
    paymentProfile: normalizePaymentProfile(student.id, student.paymentProfile),
    assignedProgramIds: Array.isArray(student.assignedProgramIds) ? student.assignedProgramIds : [],
    assignedNutritionPlanIds: Array.isArray(student.assignedNutritionPlanIds)
      ? student.assignedNutritionPlanIds
      : [],
    assignedDocumentIds: Array.isArray(student.assignedDocumentIds) ? student.assignedDocumentIds : [],
    coachNotes: Array.isArray(student.coachNotes) ? student.coachNotes : [],
    foodPreferences: {
      diet: student.foodPreferences?.diet ?? "",
      liked: Array.isArray(student.foodPreferences?.liked) ? student.foodPreferences.liked : [],
      disliked: Array.isArray(student.foodPreferences?.disliked) ? student.foodPreferences.disliked : [],
      intolerances: Array.isArray(student.foodPreferences?.intolerances)
        ? student.foodPreferences.intolerances
        : [],
    },
    sportPreferences: {
      sports: Array.isArray(student.sportPreferences?.sports) ? student.sportPreferences.sports : [],
      equipment: Array.isArray(student.sportPreferences?.equipment) ? student.sportPreferences.equipment : [],
      preferredExercises: Array.isArray(student.sportPreferences?.preferredExercises)
        ? student.sportPreferences.preferredExercises
        : [],
      exercisesToAvoid: Array.isArray(student.sportPreferences?.exercisesToAvoid)
        ? student.sportPreferences.exercisesToAvoid
        : [],
    },
  };
}

export function daysSince(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const diffMs = Date.now() - new Date(dateIso).getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

export function formatDate(dateIso: string | null | undefined): string {
  if (!dateIso) return "Date non renseignée";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "Date non renseignée";
  return date.toLocaleDateString("fr-FR");
}

export function formatDateTime(dateIso: string | null | undefined): string {
  if (!dateIso) return "Date non renseignée";
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) return "Date non renseignée";
  return date.toLocaleString("fr-FR", {
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
 * "Aujourd'hui" fictif des FIXTURES de démonstration et des tests.
 *
 * ⚠️ Ne doit JAMAIS servir de date courante en production : elle l'a été
 * jusqu'au 26/07/2026 (valeur par défaut de `daysBetween` et de
 * `computeDocumentAvailability`), ce qui gelait le déblocage automatique des
 * documents et la progression des semaines de programme. Les calculs
 * dépendant du temps utilisent désormais `currentDate()` par défaut et
 * acceptent une `reference` explicite pour rester déterministes en test.
 */
export const ADMIN_REFERENCE_DATE = new Date("2026-07-02T12:00:00.000Z");

/**
 * Le JOUR CALENDAIRE LOCAL d'une valeur, ramené à un repère comparable.
 *
 * ⚠️ DEUX FORMES ENTRENT ICI, ET ELLES N'ONT PAS LA MÊME NATURE.
 *  · `2026-08-17` — une DATE, sans heure ni lieu. Le 17 août est le 17 août.
 *  · `2026-08-17T23:30:00+02:00` — un INSTANT, dont le jour dépend du fuseau
 *    depuis lequel on le regarde.
 * Les confondre est précisément ce qui produisait le défaut corrigé ici.
 *
 * ⚠️ UNE DATE SEULE N'EST PAS PASSÉE À `new Date()`. ECMAScript interprète la
 * forme `YYYY-MM-DD` en MINUIT UTC — soit 02:00 à Paris en été. Comparée à un
 * instant local, la différence portait donc un décalage de deux heures, et la
 * semaine basculait à 02:00 au lieu de minuit. Mesuré avant correction :
 * `daysBetween("2026-08-10", 17/08 01:30 Paris)` rendait 6, puis 7 à 02:30.
 * On lit donc les trois nombres tels qu'ils sont écrits.
 *
 * ⚠️ ET CETTE BRANCHE NE SE PROUVE PAS DEPUIS PARIS. Repasser par `new Date()`
 * puis relire le jour LOCAL redonnerait le bon jour sous tout décalage
 * POSITIF : minuit UTC vu depuis UTC+2 reste le même jour. Le défaut ne
 * réapparaîtrait qu'à décalage négatif — un runtime aux Amériques, où minuit
 * UTC est la veille au soir. Le harnais ne peut donc pas l'attraper par le
 * comportement ; il garde cette branche par sa forme (`AFFECT`/`MINUIT6`).
 *
 * ⚠️ UN INSTANT, LUI, EST RAMENÉ À SON JOUR LOCAL via `getFullYear/Month/Date`
 * — le jour que l'utilisateur a vécu, pas le jour UTC. Une connexion à 00:30
 * heure de Paris appartient au jour qui vient de commencer, pas au précédent.
 *
 * Rend `null` sur une valeur illisible : l'appelant décide, personne
 * n'invente 0.
 */
function jourCalendaireLocal(valeur: string | Date): number | null {
  if (valeur instanceof Date) {
    if (Number.isNaN(valeur.getTime())) return null;
    return Date.UTC(valeur.getFullYear(), valeur.getMonth(), valeur.getDate());
  }
  const dateSeule = /^\s*(\d{4})-(\d{2})-(\d{2})\s*$/.exec(valeur);
  if (dateSeule) {
    return Date.UTC(Number(dateSeule[1]), Number(dateSeule[2]) - 1, Number(dateSeule[3]));
  }
  const instant = new Date(valeur);
  if (Number.isNaN(instant.getTime())) return null;
  return Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate());
}

/**
 * Nombre de JOURS CALENDAIRES entre `dateIso` et `reference`.
 *
 * ⚠️ CE N'EST PLUS UNE SOUSTRACTION D'INSTANTS. L'ancienne version divisait un
 * écart de millisecondes par 86 400 000, ce qui répondait « combien de
 * tranches de 24 h se sont écoulées » — une question voisine, mais pas celle
 * qu'on pose. On veut « combien de fois minuit est passé », la seule qui fasse
 * changer une semaine de programme au bon moment.
 *
 * ⚠️ `Math.round` PLUTÔT QUE `Math.floor`, ET SANS PRÉTENDRE QUE ÇA CHANGE
 * QUELQUE CHOSE AUJOURD'HUI. `Date.UTC(y, m, d)` rend toujours un minuit UTC
 * exact : l'écart entre deux bornes est donc toujours un multiple exact de
 * 86 400 000, et `floor` rendrait le même nombre — vérifié, y compris à
 * travers une transition d'heure d'été, que la normalisation ci-dessus a déjà
 * neutralisée. `round` est une ceinture contre une imprécision flottante
 * future, pas une correction active. Le sabotage le confirme : remplacer
 * `round` par `floor` ne rougit aucun test, et c'est normal.
 */
export function daysBetween(dateIso: string, reference: Date = currentDate()): number {
  const debut = jourCalendaireLocal(dateIso);
  const fin = jourCalendaireLocal(reference);
  if (debut === null || fin === null) return Number.NaN;
  return Math.round((fin - debut) / 86_400_000);
}

export function studentsWithoutRecentLogin(
  students: AdminStudent[],
  thresholdDays = 14,
  reference: Date = currentDate(),
): AdminStudent[] {
  return students.filter(
    (s) => s.status === "actif" && (s.lastLoginAt === null || daysBetween(s.lastLoginAt, reference) > thresholdDays),
  );
}

export function studentsWithStaleWeight(students: AdminStudent[]): AdminStudent[] {
  return students.filter((s) => s.status === "actif" && s.currentWeightKg === s.startWeightKg);
}

export function studentsWithRecentFeedback(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
  withinDays = 2,
  reference: Date = currentDate(),
): AdminStudent[] {
  const recentStudentIds = new Set(
    feedback.filter((f) => daysBetween(f.date, reference) <= withinDays).map((f) => f.studentId),
  );
  return students.filter((s) => recentStudentIds.has(s.id));
}

function studentsMissingRecentFeedback(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
  type: FeedbackType,
  assignedIdsKey: "assignedProgramIds" | "assignedNutritionPlanIds",
  withinDays = 2,
  reference: Date = currentDate(),
): AdminStudent[] {
  const recentIds = new Set(
    feedback
      .filter((f) => f.type === type && daysBetween(f.date, reference) <= withinDays)
      .map((f) => f.studentId),
  );
  return students.filter(
    (s) => s.status === "actif" && s[assignedIdsKey].length > 0 && !recentIds.has(s.id),
  );
}

export function studentsWithUnvalidatedSession(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
  reference: Date = currentDate(),
): AdminStudent[] {
  return studentsMissingRecentFeedback(students, feedback, "entrainement", "assignedProgramIds", 2, reference);
}

export function studentsWithUnvalidatedNutritionDay(
  students: AdminStudent[],
  feedback: AdminStudentFeedback[],
  reference: Date = currentDate(),
): AdminStudent[] {
  return studentsMissingRecentFeedback(students, feedback, "nutrition", "assignedNutritionPlanIds", 2, reference);
}

/* ─── Documents : niveaux et déblocage progressif ─── */

export const distributionModeLabels: Record<DocumentDistributionMode, string> = {
  immediat: "Disponible immédiatement",
  "deblocage-auto": "Déblocage automatique progressif",
  "deblocage-manuel": "Déblocage manuel par le coach",
  "deblocage-date": "Déblocage à une date précise",
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

/** true si `date` est une Date construite avec succès (pas de Invalid Date). */
export function isValidDate(date: Date): boolean {
  return date instanceof Date && !Number.isNaN(date.getTime());
}

/** Parse une chaîne de date de façon sûre : renvoie null plutôt qu'une Invalid Date. */
export function safeDate(dateIso: string | null | undefined): Date | null {
  if (!dateIso) return null;
  const date = new Date(dateIso);
  return isValidDate(date) ? date : null;
}

/**
 * Calcule si un document est disponible pour un élève selon son mode de
 * distribution : immédiat (toujours dispo), déblocage manuel (dispo
 * seulement si présent dans manualUnlocks), ou déblocage automatique
 * (dispo à partir de startDate + (level - 1) * unlockAfterWeeks
 * semaines). Ex: niveau 1/unlockAfterWeeks=2 → dispo semaine 1, niveau 2 →
 * semaine 3, niveau 3 → semaine 5.
 *
 * Robuste aux données mockées incomplètes : si startDate est vide/mal
 * formée (ou si le calcul produit malgré tout une date invalide), le
 * document est traité comme disponible plutôt que de faire planter la
 * page — on ne peut pas bloquer un élève sur un palier qu'on ne sait pas
 * calculer, et toISOString() n'est jamais appelé sur une Invalid Date.
 */
export function computeDocumentAvailability(
  student: { startDate: string },
  document: AdminDocument,
  manualUnlocks: StudentDocumentUnlock[],
  reference: Date = currentDate(),
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
  if (document.distributionMode === "deblocage-date") {
    const unlockAt = safeDate(document.unlockAt);
    if (!unlockAt) {
      return { available: true, unlockDate: null, manuallyUnlocked: false };
    }
    const available = reference.getTime() >= unlockAt.getTime();
    return { available, unlockDate: available ? null : unlockAt.toISOString().slice(0, 10), manuallyUnlocked: false };
  }

  const startDate = safeDate(student.startDate);
  if (!startDate) {
    return { available: true, unlockDate: null, manuallyUnlocked: false };
  }

  const level = Number.isFinite(document.level) ? document.level : 1;
  const unlockAfterWeeks = Number.isFinite(document.unlockAfterWeeks) ? document.unlockAfterWeeks : 0;
  const unlockOffsetWeeks = Math.max(0, level - 1) * unlockAfterWeeks;

  const unlockDate = new Date(startDate);
  unlockDate.setDate(unlockDate.getDate() + unlockOffsetWeeks * 7);

  if (!isValidDate(unlockDate)) {
    return { available: true, unlockDate: null, manuallyUnlocked: false };
  }

  const available = reference.getTime() >= unlockDate.getTime();
  return {
    available,
    unlockDate: available || !isValidDate(unlockDate) ? null : unlockDate.toISOString().slice(0, 10),
    manuallyUnlocked: false,
  };
}

/* ─── Banque d'exercices ─── */

export const exerciseCategoryLabels: Record<ExerciseCategory, string> = {
  Force: "Force",
  Hypertrophie: "Hypertrophie",
  "Mobilité": "Mobilité",
  Cardio: "Cardio",
  Gainage: "Gainage",
  "Plyométrie": "Plyométrie",
  "Échauffement": "Échauffement",
  "Réathlétisation": "Réathlétisation",
  Technique: "Technique",
};

export const exerciseEquipmentLabels: Record<ExerciseEquipment, string> = {
  Aucun: "Aucun",
  "Haltères": "Haltères",
  Barre: "Barre",
  Machine: "Machine",
  Poulie: "Poulie",
  "Élastique": "Élastique",
  Kettlebell: "Kettlebell",
  "Smith machine": "Smith machine",
  TRX: "TRX",
  "Médecine ball": "Médecine ball",
  "Cardio machine": "Cardio machine",
  Autre: "Autre",
};

export const exerciseLevelLabels: Record<ExerciseLevel, string> = {
  débutant: "Débutant",
  intermédiaire: "Intermédiaire",
  avancé: "Avancé",
};

export function matchesExerciseSearch(item: ExerciseLibraryItem, query: string): boolean {
  if (!query.trim()) return true;
  // Le pattern est cherchable par sa CLÉ et par son LIBELLÉ : le coach tape
  // « charnière » ou « charniere_de_hanche », les deux doivent répondre.
  const haystack = [
    item.name,
    item.muscleGroup,
    item.equipment,
    item.category,
    item.movementPattern ?? "",
    item.movementPattern ? movementPatternLabels[item.movementPattern] : "",
    ...item.tags,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

/* ─── Calendrier / rendez-vous ─── */

export const appointmentStatusLabels: Record<AppointmentStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmé",
  cancelled: "Annulé",
  completed: "Terminé",
  no_show: "Absence",
};

export function appointmentStatusTone(status: AppointmentStatus): "green" | "amber" | "muted" | "red" | "primary" {
  if (status === "confirmed") return "green";
  if (status === "pending") return "amber";
  if (status === "cancelled" || status === "no_show") return "red";
  return "muted";
}

/* ─── Coachs ─── */

export const coachRoleLabels: Record<CoachRole, string> = {
  admin: "Admin",
  assistant: "Assistant",
};

export const coachStatusLabels: Record<CoachAccountStatus, string> = {
  actif: "Actif",
  inactif: "Inactif",
};
