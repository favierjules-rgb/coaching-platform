"use client";

import { useCallback, useSyncExternalStore } from "react";

import {
  adminCoachSettings,
  adminDocuments,
  adminFeedback,
  adminNutritionPlans,
  adminPrograms,
  adminStudents,
} from "@/data/admin";
import { generateId } from "@/lib/admin";
import type {
  AdminAssignment,
  AdminCoachSettings,
  AdminDocument,
  AdminNutritionPlan,
  AdminProgram,
  AdminStudent,
  AdminStudentFeedback,
  AssignableContentType,
  CoachNote,
  FeedbackStatus,
} from "@/types";

/**
 * État complet de l'espace admin (élèves, programmes, plans, documents,
 * retours, paramètres), tenu comme un seul objet en localStorage — même
 * principe que useStudentProfile côté élève : une seule source de vérité
 * pour que toutes les pages /admin lisent et modifient les mêmes données.
 */
export interface AdminDataState {
  students: AdminStudent[];
  programs: AdminProgram[];
  nutritionPlans: AdminNutritionPlan[];
  documents: AdminDocument[];
  feedback: AdminStudentFeedback[];
  coachSettings: AdminCoachSettings;
}

const STORAGE_KEY = "seth-admin-data";
const CHANGE_EVENT = "seth-admin-data:change";

const seed: AdminDataState = {
  students: adminStudents,
  programs: adminPrograms,
  nutritionPlans: adminNutritionPlans,
  documents: adminDocuments,
  feedback: adminFeedback,
  coachSettings: adminCoachSettings,
};

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseState(raw: string | null): AdminDataState | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AdminDataState;
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
    setFeedbackStatus,
    addCoachReply,
    updateCoachSettings,
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
