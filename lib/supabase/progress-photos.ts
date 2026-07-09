import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import {
  deleteProgressPhotoFile,
  getSignedProgressPhotoUrl,
  uploadProgressPhotoFile,
} from "@/lib/supabase/storage-progress-photos";
import type { ProgressPhoto, ProgressPhotoAngle } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'écriture/lecture "riche" pour les photos de progression
 * (chantier "supabase-progress-photos-before-after-export") : upload
 * Storage réel, métadonnées étendues, sélection avant/après, archive/
 * suppression. Distincte de addProgressPhotoSupabase/deleteProgressPhotoSupabase
 * (lib/supabase/students.ts), laissées intactes pour l'ajout rapide déjà en
 * place sur /admin/eleves/[studentId] (colonnes historiques uniquement) —
 * voir docs/supabase-progress-photos-before-after-export-model.md.
 *
 * `student_id` est toujours l'id de la table `students` (jamais profiles.id
 * ni auth.users.id), passé explicitement par l'appelant.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type ProgressPhotoRow = Database["public"]["Tables"]["progress_photos"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function mapProgressPhotoRow(row: ProgressPhotoRow): ProgressPhoto {
  return {
    id: row.id,
    studentId: row.student_id,
    type: row.type,
    date: row.date,
    weightKg: row.weight_kg,
    note: row.note ?? "",
    imageUrl: row.image_url,
    storagePath: row.storage_path,
    pending: row.pending,
    photoType: row.photo_type as ProgressPhotoAngle,
    uploadedBy: row.uploaded_by,
    fileName: row.file_name,
    fileSizeBytes: row.file_size_bytes,
    fileMimeType: row.file_mime_type,
    isBeforeCandidate: row.is_before_candidate,
    isAfterCandidate: row.is_after_candidate,
    status: row.status as "active" | "archived",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProgressPhotoListOptions {
  /** false par défaut : n'inclut pas les photos archivées. */
  includeArchived?: boolean;
}

/** Liste triée par date (la plus récente en premier) — vue "riche" utilisée par la galerie. */
export async function listProgressPhotos(
  supabase: TypedSupabaseClient,
  studentId: string,
  options: ProgressPhotoListOptions = {},
): Promise<ProgressPhoto[]> {
  let query = supabase.from("progress_photos").select("*").eq("student_id", studentId);
  if (!options.includeArchived) {
    query = query.eq("status", "active");
  }
  const { data, error } = await query.order("date", { ascending: false });
  devWarn("listProgressPhotos", error);
  return (data ?? []).map(mapProgressPhotoRow);
}

/** Même liste, avec `imageUrl` résolu en URL signée à courte durée pour chaque photo ayant un `storagePath` (bucket privé). */
export async function listProgressPhotosWithSignedUrls(
  supabase: TypedSupabaseClient,
  studentId: string,
  options: ProgressPhotoListOptions = {},
): Promise<ProgressPhoto[]> {
  const photos = await listProgressPhotos(supabase, studentId, options);
  return Promise.all(
    photos.map(async (photo) => {
      if (!photo.storagePath) return photo;
      const signedUrl = await getSignedProgressPhotoUrl(supabase, photo.storagePath);
      return signedUrl ? { ...photo, imageUrl: signedUrl } : photo;
    }),
  );
}

export interface CreateProgressPhotoInput {
  photoType: ProgressPhotoAngle;
  date: string;
  weightKg: number | null;
  note: string;
  uploadedBy: string | null;
  /** "student" pour un upload depuis /progression, "coach" pour un upload depuis /admin/eleves/[studentId]/progression. */
  actorType: "student" | "coach";
}

/** Upload Storage + insertion de la ligne + journal d'activité (best-effort). */
export async function createProgressPhotoWithUpload(
  supabase: TypedSupabaseClient,
  studentId: string,
  file: File,
  input: CreateProgressPhotoInput,
): Promise<ProgressPhoto | { error: string }> {
  const uploaded = await uploadProgressPhotoFile(supabase, studentId, input.photoType, file);
  if ("error" in uploaded) {
    return uploaded;
  }

  const { data, error } = await supabase
    .from("progress_photos")
    .insert({
      student_id: studentId,
      type: "mensuelle",
      date: input.date,
      weight_kg: input.weightKg,
      note: input.note,
      image_url: null,
      storage_path: uploaded.storagePath,
      pending: false,
      photo_type: input.photoType,
      uploaded_by: input.uploadedBy,
      file_name: uploaded.fileName,
      file_size_bytes: uploaded.fileSizeBytes,
      file_mime_type: uploaded.fileMimeType,
    })
    .select("*")
    .single();

  if (error || !data) {
    devWarn("createProgressPhotoWithUpload (insert)", error);
    await deleteProgressPhotoFile(supabase, uploaded.storagePath);
    return { error: error?.message ?? "Échec de l'enregistrement de la photo." };
  }

  await logActivityEvent(supabase, {
    studentId,
    actorType: input.actorType,
    eventType: "progress_photo_uploaded",
    title: "Nouvelle photo de progression",
    description: `Photo (${input.photoType}) ajoutée le ${input.date}.`,
    metadata: buildStudentActivityLink(studentId),
  });

  return mapProgressPhotoRow(data);
}

export interface UpdateProgressPhotoMetaInput {
  photoType?: ProgressPhotoAngle;
  date?: string;
  weightKg?: number | null;
  note?: string;
}

export async function updateProgressPhotoMeta(
  supabase: TypedSupabaseClient,
  photoId: string,
  input: UpdateProgressPhotoMetaInput,
): Promise<boolean> {
  const payload: Database["public"]["Tables"]["progress_photos"]["Update"] = {};
  if (input.photoType !== undefined) payload.photo_type = input.photoType;
  if (input.date !== undefined) payload.date = input.date;
  if (input.weightKg !== undefined) payload.weight_kg = input.weightKg;
  if (input.note !== undefined) payload.note = input.note;
  const { error } = await supabase.from("progress_photos").update(payload).eq("id", photoId);
  devWarn("updateProgressPhotoMeta", error);
  return !error;
}

export async function archiveProgressPhoto(supabase: TypedSupabaseClient, photoId: string): Promise<boolean> {
  const { error } = await supabase
    .from("progress_photos")
    .update({ status: "archived", is_before_candidate: false, is_after_candidate: false })
    .eq("id", photoId);
  devWarn("archiveProgressPhoto", error);
  return !error;
}

export async function restoreProgressPhoto(supabase: TypedSupabaseClient, photoId: string): Promise<boolean> {
  const { error } = await supabase.from("progress_photos").update({ status: "active" }).eq("id", photoId);
  devWarn("restoreProgressPhoto", error);
  return !error;
}

/** Supprime la ligne et le fichier Storage associé (best-effort sur le fichier). */
export async function deleteProgressPhotoPermanently(
  supabase: TypedSupabaseClient,
  photoId: string,
  storagePath: string | null,
): Promise<boolean> {
  const { error } = await supabase.from("progress_photos").delete().eq("id", photoId);
  devWarn("deleteProgressPhotoPermanently", error);
  if (!error && storagePath) {
    await deleteProgressPhotoFile(supabase, storagePath);
  }
  return !error;
}

/** Ne garde qu'une seule photo "avant" à la fois pour l'élève : désélectionne les autres avant de sélectionner celle-ci. */
export async function setBeforeCandidate(supabase: TypedSupabaseClient, studentId: string, photoId: string): Promise<boolean> {
  const { error: clearError } = await supabase
    .from("progress_photos")
    .update({ is_before_candidate: false })
    .eq("student_id", studentId)
    .eq("is_before_candidate", true);
  devWarn("setBeforeCandidate (clear)", clearError);
  const { error } = await supabase.from("progress_photos").update({ is_before_candidate: true }).eq("id", photoId);
  devWarn("setBeforeCandidate", error);
  return !error;
}

/** Même principe pour la photo "après". */
export async function setAfterCandidate(supabase: TypedSupabaseClient, studentId: string, photoId: string): Promise<boolean> {
  const { error: clearError } = await supabase
    .from("progress_photos")
    .update({ is_after_candidate: false })
    .eq("student_id", studentId)
    .eq("is_after_candidate", true);
  devWarn("setAfterCandidate (clear)", clearError);
  const { error } = await supabase.from("progress_photos").update({ is_after_candidate: true }).eq("id", photoId);
  devWarn("setAfterCandidate", error);
  return !error;
}
