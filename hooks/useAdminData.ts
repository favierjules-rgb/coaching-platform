"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  adminAppearanceSettings,
  adminCoachSettings,
  adminCoaches,
  adminDocuments,
  adminExerciseLibrary,
  adminFeedback,
  adminManualDocumentUnlocks,
  adminNutritionPlans,
  adminPrograms,
  adminSecuritySettings,
  adminStudents,
} from "@/data/admin";
import { generateId } from "@/lib/admin";
import type {
  AdminAppearanceSettings,
  AdminAssignment,
  AdminCoach,
  AdminCoachSettings,
  AdminDocument,
  AdminNutritionPlan,
  AdminProgram,
  AdminSecuritySettings,
  AdminStudent,
  AdminStudentFeedback,
  AssignableContentType,
  CoachNote,
  ExerciseLibraryItem,
  FeedbackStatus,
  StudentDocumentUnlock,
} from "@/types";

/**
 * État complet de l'espace admin (élèves, programmes, plans, documents,
 * retours, banque d'exercices, coachs, paramètres), tenu comme un seul
 * objet en localStorage — même principe que useStudentProfile côté élève :
 * une seule source de vérité pour que toutes les pages /admin lisent et
 * modifient les mêmes données.
 */
export interface AdminDataState {
  students: AdminStudent[];
  programs: AdminProgram[];
  nutritionPlans: AdminNutritionPlan[];
  documents: AdminDocument[];
  feedback: AdminStudentFeedback[];
  exerciseLibrary: ExerciseLibraryItem[];
  manualDocumentUnlocks: StudentDocumentUnlock[];
  coaches: AdminCoach[];
  coachSettings: AdminCoachSettings;
  appearanceSettings: AdminAppearanceSettings;
  securitySettings: AdminSecuritySettings;
}

const STORAGE_KEY = "seth-admin-data";
const CHANGE_EVENT = "seth-admin-data:change";

const seed: AdminDataState = {
  students: adminStudents,
  programs: adminPrograms,
  nutritionPlans: adminNutritionPlans,
  documents: adminDocuments,
  feedback: adminFeedback,
  exerciseLibrary: adminExerciseLibrary,
  manualDocumentUnlocks: adminManualDocumentUnlocks,
  coaches: adminCoaches,
  coachSettings: adminCoachSettings,
  appearanceSettings: adminAppearanceSettings,
  securitySettings: adminSecuritySettings,
};

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Fusionne un état lu depuis localStorage avec les valeurs par défaut (seed)
 * pour toute clé manquante ou partielle — migration douce pour les anciennes
 * versions du state (avant l'ajout de exerciseLibrary/coaches/appearance-
 * Settings/securitySettings/manualDocumentUnlocks) qui plantaient sinon en
 * lisant des champs undefined (ex : state.appearanceSettings.accentColor).
 * Prépare aussi le terrain pour une future migration Supabase.
 */
function normalizeState(parsed: Partial<AdminDataState> | null | undefined): AdminDataState {
  return {
    students: parsed?.students ?? seed.students,
    programs: parsed?.programs ?? seed.programs,
    nutritionPlans: parsed?.nutritionPlans ?? seed.nutritionPlans,
    documents: parsed?.documents ?? seed.documents,
    feedback: parsed?.feedback ?? seed.feedback,
    exerciseLibrary: parsed?.exerciseLibrary ?? seed.exerciseLibrary,
    manualDocumentUnlocks: parsed?.manualDocumentUnlocks ?? seed.manualDocumentUnlocks,
    coaches: parsed?.coaches ?? seed.coaches,
    coachSettings: { ...seed.coachSettings, ...parsed?.coachSettings },
    appearanceSettings: { ...seed.appearanceSettings, ...parsed?.appearanceSettings },
    securitySettings: { ...seed.securitySettings, ...parsed?.securitySettings },
  };
}

function parseState(raw: string | null): AdminDataState | null {
  if (!raw) return null;
  try {
    return normalizeState(JSON.parse(raw) as Partial<AdminDataState>);
  } catch {
    return null;
  }
}

function writeState(state: AdminDataState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage indisponible (navigation privée, quota...) : on continue
    // sans persister, l'état reste au moins cohérent pour l'onglet courant.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

let snapshotCache: { raw: string | null; state: AdminDataState } | null = null;

function getSnapshot(): AdminDataState {
  const raw = readRaw();
  if (snapshotCache && snapshotCache.raw === raw) {
    return snapshotCache.state;
  }
  const state = parseState(raw) ?? seed;
  snapshotCache = { raw, state };
  return state;
}

function getServerSnapshot(): AdminDataState {
  return seed;
}

function subscribe(onStoreChange: () => void) {
  function handleChange(event: Event) {
    if (event instanceof StorageEvent && event.key !== STORAGE_KEY) {
      return;
    }
    onStoreChange();
  }
  window.addEventListener("storage", handleChange);
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => {
    window.removeEventListener("storage", handleChange);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}

export function useAdminData() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const createStudent = useCallback((student: Omit<AdminStudent, "id" | "createdAt" | "updatedAt">) => {
    const current = getSnapshot();
    const now = new Date().toISOString();
    const newStudent: AdminStudent = {
      ...student,
      id: generateId("adm"),
      createdAt: now,
      updatedAt: now,
    };
    writeState({ ...current, students: [...current.students, newStudent] });
    return newStudent.id;
  }, []);

  const updateStudent = useCallback((studentId: string, partial: Partial<AdminStudent>) => {
    const current = getSnapshot();
    writeState({
      ...current,
      students: current.students.map((s) =>
        s.id === studentId
          ? { ...s, ...partial, updatedAt: new Date().toISOString() }
          : s,
      ),
    });
  }, []);

  const addCoachNote = useCallback((studentId: string, text: string) => {
    const current = getSnapshot();
    const note: CoachNote = {
      id: generateId("note"),
      studentId,
      text,
      createdAt: new Date().toISOString(),
    };
    writeState({
      ...current,
      students: current.students.map((s) =>
        s.id === studentId
          ? { ...s, coachNotes: [...s.coachNotes, note], updatedAt: new Date().toISOString() }
          : s,
      ),
    });
  }, []);

  const createProgram = useCallback((program: Omit<AdminProgram, "id" | "createdAt" | "updatedAt">) => {
    const current = getSnapshot();
    const now = new Date().toISOString();
    const newProgram: AdminProgram = { ...program, id: generateId("prog"), createdAt: now, updatedAt: now };
    writeState({ ...current, programs: [...current.programs, newProgram] });
    return newProgram.id;
  }, []);

  const updateProgram = useCallback((programId: string, partial: Partial<AdminProgram>) => {
    const current = getSnapshot();
    writeState({
      ...current,
      programs: current.programs.map((p) =>
        p.id === programId ? { ...p, ...partial, updatedAt: new Date().toISOString() } : p,
      ),
    });
  }, []);

  const createNutritionPlan = useCallback(
    (plan: Omit<AdminNutritionPlan, "id" | "createdAt" | "updatedAt">) => {
      const current = getSnapshot();
      const now = new Date().toISOString();
      const newPlan: AdminNutritionPlan = { ...plan, id: generateId("plan"), createdAt: now, updatedAt: now };
      writeState({ ...current, nutritionPlans: [...current.nutritionPlans, newPlan] });
      return newPlan.id;
    },
    [],
  );

  const updateNutritionPlan = useCallback(
    (planId: string, partial: Partial<AdminNutritionPlan>) => {
      const current = getSnapshot();
      writeState({
        ...current,
        nutritionPlans: current.nutritionPlans.map((p) =>
          p.id === planId ? { ...p, ...partial, updatedAt: new Date().toISOString() } : p,
        ),
      });
    },
    [],
  );

  const createDocument = useCallback((doc: Omit<AdminDocument, "id" | "createdAt" | "updatedAt">) => {
    const current = getSnapshot();
    const now = new Date().toISOString();
    const newDoc: AdminDocument = { ...doc, id: generateId("doc"), createdAt: now, updatedAt: now };
    writeState({ ...current, documents: [...current.documents, newDoc] });
    return newDoc.id;
  }, []);

  const updateDocument = useCallback((documentId: string, partial: Partial<AdminDocument>) => {
    const current = getSnapshot();
    writeState({
      ...current,
      documents: current.documents.map((d) =>
        d.id === documentId ? { ...d, ...partial, updatedAt: new Date().toISOString() } : d,
      ),
    });
  }, []);

  /**
   * Assigne/retire un contenu à un élève en mettant à jour les deux côtés
   * de la relation (assignedStudentIds sur le contenu, assigned*Ids sur
   * l'élève) dans une seule écriture atomique, pour qu'ils ne puissent
   * jamais se désynchroniser.
   */
  const setAssignment = useCallback(
    (studentId: string, contentType: AssignableContentType, contentId: string, assigned: boolean) => {
      const current = getSnapshot();

      function toggle(ids: string[]): string[] {
        if (assigned) {
          return ids.includes(contentId) ? ids : [...ids, contentId];
        }
        return ids.filter((id) => id !== contentId);
      }

      function toggleStudents(ids: string[]): string[] {
        if (assigned) {
          return ids.includes(studentId) ? ids : [...ids, studentId];
        }
        return ids.filter((id) => id !== studentId);
      }

      const students = current.students.map((s) => {
        if (s.id !== studentId) return s;
        const key =
          contentType === "programme"
            ? "assignedProgramIds"
            : contentType === "nutrition"
              ? "assignedNutritionPlanIds"
              : "assignedDocumentIds";
        return { ...s, [key]: toggle(s[key]), updatedAt: new Date().toISOString() };
      });

      let programs = current.programs;
      let nutritionPlans = current.nutritionPlans;
      let documents = current.documents;

      if (contentType === "programme") {
        programs = current.programs.map((p) =>
          p.id === contentId
            ? { ...p, assignedStudentIds: toggleStudents(p.assignedStudentIds), updatedAt: new Date().toISOString() }
            : p,
        );
      } else if (contentType === "nutrition") {
        nutritionPlans = current.nutritionPlans.map((p) =>
          p.id === contentId
            ? { ...p, assignedStudentIds: toggleStudents(p.assignedStudentIds), updatedAt: new Date().toISOString() }
            : p,
        );
      } else {
        documents = current.documents.map((d) =>
          d.id === contentId
            ? { ...d, assignedStudentIds: toggleStudents(d.assignedStudentIds), updatedAt: new Date().toISOString() }
            : d,
        );
      }

      writeState({ ...current, students, programs, nutritionPlans, documents });
    },
    [],
  );

  const addFeedback = useCallback(
    (feedback: Omit<AdminStudentFeedback, "id" | "createdAt" | "updatedAt">) => {
      const current = getSnapshot();
      const now = new Date().toISOString();
      const newFeedback: AdminStudentFeedback = {
        ...feedback,
        id: generateId("fb"),
        createdAt: now,
        updatedAt: now,
      };
      writeState({ ...current, feedback: [...current.feedback, newFeedback] });
      return newFeedback.id;
    },
    [],
  );

  const setFeedbackStatus = useCallback((feedbackId: string, status: FeedbackStatus) => {
    const current = getSnapshot();
    writeState({
      ...current,
      feedback: current.feedback.map((f) =>
        f.id === feedbackId ? { ...f, status, updatedAt: new Date().toISOString() } : f,
      ),
    });
  }, []);

  const addCoachReply = useCallback((feedbackId: string, reply: string) => {
    const current = getSnapshot();
    writeState({
      ...current,
      feedback: current.feedback.map((f) =>
        f.id === feedbackId
          ? { ...f, coachReply: reply, status: "traité", updatedAt: new Date().toISOString() }
          : f,
      ),
    });
  }, []);

  const updateCoachSettings = useCallback((partial: Partial<AdminCoachSettings>) => {
    const current = getSnapshot();
    writeState({ ...current, coachSettings: { ...current.coachSettings, ...partial } });
  }, []);

  const updateAppearanceSettings = useCallback((partial: Partial<AdminAppearanceSettings>) => {
    const current = getSnapshot();
    writeState({ ...current, appearanceSettings: { ...current.appearanceSettings, ...partial } });
  }, []);

  /**
   * AVERTISSEMENT sécurité : mot de passe admin entièrement mocké, stocké
   * en clair dans localStorage. Aucune vérification réelle n'est faite —
   * à remplacer intégralement par Supabase Auth avant toute mise en ligne.
   */
  const setMockAdminPassword = useCallback((password: string) => {
    const current = getSnapshot();
    try {
      window.localStorage.setItem("seth-admin-mock-password", password);
    } catch {
      // localStorage indisponible.
    }
    writeState({
      ...current,
      securitySettings: {
        mockPasswordSet: true,
        mockPasswordHint: password.length > 0 ? `${password.length} caractères` : "",
        updatedAt: new Date().toISOString(),
      },
    });
  }, []);

  const createLibraryExercise = useCallback(
    (item: Omit<ExerciseLibraryItem, "id" | "createdAt" | "updatedAt">) => {
      const current = getSnapshot();
      const now = new Date().toISOString();
      const newItem: ExerciseLibraryItem = { ...item, id: generateId("lib"), createdAt: now, updatedAt: now };
      writeState({ ...current, exerciseLibrary: [...current.exerciseLibrary, newItem] });
      return newItem.id;
    },
    [],
  );

  const updateLibraryExercise = useCallback(
    (itemId: string, partial: Partial<ExerciseLibraryItem>) => {
      const current = getSnapshot();
      writeState({
        ...current,
        exerciseLibrary: current.exerciseLibrary.map((item) =>
          item.id === itemId ? { ...item, ...partial, updatedAt: new Date().toISOString() } : item,
        ),
      });
    },
    [],
  );

  const deleteLibraryExercise = useCallback((itemId: string) => {
    const current = getSnapshot();
    writeState({
      ...current,
      exerciseLibrary: current.exerciseLibrary.filter((item) => item.id !== itemId),
    });
  }, []);

  const createCoach = useCallback((coach: Omit<AdminCoach, "id" | "createdAt" | "updatedAt">) => {
    const current = getSnapshot();
    const now = new Date().toISOString();
    const newCoach: AdminCoach = { ...coach, id: generateId("coach"), createdAt: now, updatedAt: now };
    writeState({ ...current, coaches: [...current.coaches, newCoach] });
    return newCoach.id;
  }, []);

  const updateCoach = useCallback((coachId: string, partial: Partial<AdminCoach>) => {
    const current = getSnapshot();
    writeState({
      ...current,
      coaches: current.coaches.map((c) =>
        c.id === coachId ? { ...c, ...partial, updatedAt: new Date().toISOString() } : c,
      ),
    });
  }, []);

  const unlockDocumentForStudent = useCallback((studentId: string, documentId: string) => {
    const current = getSnapshot();
    const already = current.manualDocumentUnlocks.some(
      (u) => u.studentId === studentId && u.documentId === documentId,
    );
    if (already) return;
    writeState({
      ...current,
      manualDocumentUnlocks: [
        ...current.manualDocumentUnlocks,
        { studentId, documentId, unlockedAt: new Date().toISOString() },
      ],
    });
  }, []);

  const unlockAllDocumentsForStudent = useCallback((studentId: string) => {
    const current = getSnapshot();
    const now = new Date().toISOString();
    const existingIds = new Set(
      current.manualDocumentUnlocks.filter((u) => u.studentId === studentId).map((u) => u.documentId),
    );
    const newUnlocks: StudentDocumentUnlock[] = current.documents
      .filter((d) => d.assignedStudentIds.includes(studentId) && !existingIds.has(d.id))
      .map((d) => ({ studentId, documentId: d.id, unlockedAt: now }));
    if (newUnlocks.length === 0) return;
    writeState({
      ...current,
      manualDocumentUnlocks: [...current.manualDocumentUnlocks, ...newUnlocks],
    });
  }, []);

  const resetAdminData = useCallback(() => {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage indisponible : rien à nettoyer.
    }
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }, []);

  return {
    state,
    createStudent,
    updateStudent,
    addCoachNote,
    createProgram,
    updateProgram,
    createNutritionPlan,
    updateNutritionPlan,
    createDocument,
    updateDocument,
    setAssignment,
    addFeedback,
    setFeedbackStatus,
    addCoachReply,
    updateCoachSettings,
    updateAppearanceSettings,
    setMockAdminPassword,
    createLibraryExercise,
    updateLibraryExercise,
    deleteLibraryExercise,
    createCoach,
    updateCoach,
    unlockDocumentForStudent,
    unlockAllDocumentsForStudent,
    resetAdminData,
  };
}

/** Liste à plat des assignations, dérivée des tableaux assignedStudentIds. */
export function computeAssignments(state: AdminDataState): AdminAssignment[] {
  const assignments: AdminAssignment[] = [];
  for (const p of state.programs) {
    for (const studentId of p.assignedStudentIds) {
      assignments.push({
        id: `a-${p.id}-${studentId}`,
        studentId,
        contentType: "programme",
        contentId: p.id,
        assignedAt: p.updatedAt,
      });
    }
  }
  for (const p of state.nutritionPlans) {
    for (const studentId of p.assignedStudentIds) {
      assignments.push({
        id: `a-${p.id}-${studentId}`,
        studentId,
        contentType: "nutrition",
        contentId: p.id,
        assignedAt: p.updatedAt,
      });
    }
  }
  for (const d of state.documents) {
    for (const studentId of d.assignedStudentIds) {
      assignments.push({
        id: `a-${d.id}-${studentId}`,
        studentId,
        contentType: "document",
        contentId: d.id,
        assignedAt: d.updatedAt,
      });
    }
  }
  return assignments;
}
