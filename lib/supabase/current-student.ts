import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addProgressPhotoSupabase,
  getFullAdminStudent,
  updateStudentFields,
  upsertBodyMeasurements,
  upsertCustomMeasurement,
} from "@/lib/supabase/students";
import type { CustomMeasurementInput } from "@/components/student/UpdateMeasurementsModal";
import type { AdminStudent, BodyMeasurementType, ProgressPhoto } from "@/types";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Fonctions élève-side pour /profil : contrairement à lib/supabase/students.ts
 * (identifié par studentId, utilisé côté admin), celles-ci partent de
 * l'utilisateur Supabase Auth actuellement connecté (`auth.getUser()`,
 * utilisable aussi bien depuis un Client Component que via le client
 * serveur) et retrouvent sa fiche `students` via `user_id`. `null` si
 * personne n'est connecté ou si le compte n'a pas encore de fiche élève
 * (cas normal tant que le coach ne l'a pas créée) — jamais d'erreur
 * bloquante, l'appelant retombe sur le mock/localStorage (voir
 * hooks/useSupabaseStudentProfile.ts).
 */
export async function getCurrentStudentProfile(supabase: TypedSupabaseClient): Promise<AdminStudent | null> {
  const studentId = await getCurrentStudentId(supabase);
  if (!studentId) {
    return null;
  }
  return getFullAdminStudent(supabase, studentId);
}

/**
 * Version légère de getCurrentStudentProfile : ne renvoie que l'id `students`
 * du compte connecté, sans charger mensurations/photos/paiement — utilisée
 * là où seul l'identifiant est nécessaire (ex : soumission d'un retour de
 * séance, voir hooks/useSupabaseWorkoutFeedback.ts).
 */
export async function getCurrentStudentId(supabase: TypedSupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  const { data: studentRow, error: studentError } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (studentError || !studentRow) {
    return null;
  }
  return studentRow.id;
}

export async function updateCurrentStudentWeight(
  supabase: TypedSupabaseClient,
  studentId: string,
  weightKg: number,
): Promise<boolean> {
  return updateStudentFields(supabase, studentId, { currentWeightKg: weightKg });
}

export async function addCurrentStudentMeasurement(
  supabase: TypedSupabaseClient,
  studentId: string,
  values: Partial<Record<BodyMeasurementType, number>>,
  date: string,
  note: string,
  custom: CustomMeasurementInput | null,
): Promise<void> {
  await upsertBodyMeasurements(supabase, studentId, values, date, note);
  if (custom) {
    await upsertCustomMeasurement(supabase, studentId, custom, date);
  }
}

export async function addCurrentStudentProgressPhoto(
  supabase: TypedSupabaseClient,
  studentId: string,
  photo: Omit<ProgressPhoto, "id" | "studentId">,
): Promise<ProgressPhoto | null> {
  return addProgressPhotoSupabase(supabase, studentId, photo);
}
