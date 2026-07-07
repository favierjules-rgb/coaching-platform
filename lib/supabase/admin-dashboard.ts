import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminWorkoutFeedbackList } from "@/lib/supabase/workout-feedback";
import { getFullAdminStudent, getStudents, updateStudentFields } from "@/lib/supabase/students";
import type { AdminStudent, StudentAccountStatus } from "@/types";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

export interface AdminDashboardStats {
  totalStudents: number;
  activeStudents: number;
  pausedStudents: number;
  feedbackToTreat: number;
}

/**
 * Compteurs réels du dashboard /admin, dérivés des élèves et retours
 * entraînement Supabase déjà migrés — pas de comptage sur programmes,
 * nutrition ou documents, ces contenus n'étant pas encore migrés (voir
 * docs/supabase-student-model.md et la tâche supabase-admin-real-actions).
 */
export async function getAdminDashboardStats(supabase: TypedSupabaseClient): Promise<AdminDashboardStats> {
  const [students, feedback] = await Promise.all([getStudents(supabase), getAdminWorkoutFeedbackList(supabase)]);
  return {
    totalStudents: students.length,
    activeStudents: students.filter((s) => s.status === "actif").length,
    pausedStudents: students.filter((s) => s.status === "pause").length,
    feedbackToTreat: feedback.filter((f) => f.status === "a-traiter" || f.status === "important").length,
  };
}

export async function getAdminStudents(supabase: TypedSupabaseClient): Promise<AdminStudent[]> {
  return getStudents(supabase);
}

export async function getAdminStudentById(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminStudent | null> {
  return getFullAdminStudent(supabase, studentId);
}

export async function updateAdminStudentProfile(
  supabase: TypedSupabaseClient,
  studentId: string,
  payload: Partial<AdminStudent>,
): Promise<boolean> {
  return updateStudentFields(supabase, studentId, payload);
}

export async function updateAdminStudentStatus(
  supabase: TypedSupabaseClient,
  studentId: string,
  status: StudentAccountStatus,
): Promise<boolean> {
  return updateStudentFields(supabase, studentId, { status });
}
