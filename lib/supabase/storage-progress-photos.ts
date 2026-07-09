import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProgressPhotoAngle } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Upload Storage pour les photos de progression (chantier
 * "supabase-progress-photos-before-after-export"), modelé sur
 * lib/supabase/storage-documents.ts. Le bucket "progress-photos" (privé) et
 * sa policy `progress_photos_bucket_student_or_staff` existaient déjà et
 * imposent exactement la convention de chemin utilisée ici :
 * `{studentId}/...` en premier segment (voir storage.foldername(name)[1]
 * dans supabase/schema.sql) — jamais un autre id en tête de chemin.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export const PROGRESS_PHOTOS_BUCKET = "progress-photos";

const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_MB = 10;

export interface UploadedProgressPhotoFile {
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileMimeType: string;
}

function devWarn(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}`);
  }
}

/** Retourne un message d'erreur explicite si le fichier n'est pas acceptable, sinon null. */
export function validateProgressPhotoFile(file: File): string | null {
  if (!ACCEPTED_MIME_TYPES.includes(file.type)) {
    return "Format non supporté. Utilise une image JPEG, PNG ou WebP.";
  }
  const maxBytes = MAX_SIZE_MB * 1024 * 1024;
  if (file.size > maxBytes) {
    return `Fichier trop volumineux (max ${MAX_SIZE_MB} Mo).`;
  }
  return null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

export async function uploadProgressPhotoFile(
  supabase: TypedSupabaseClient,
  studentId: string,
  photoType: ProgressPhotoAngle,
  file: File,
): Promise<UploadedProgressPhotoFile | { error: string }> {
  const validationError = validateProgressPhotoFile(file);
  if (validationError) {
    return { error: validationError };
  }
  const path = `${studentId}/${Date.now()}-${photoType}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(PROGRESS_PHOTOS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) {
    return { error: error.message };
  }
  return {
    storagePath: path,
    fileName: file.name,
    fileSizeBytes: file.size,
    fileMimeType: file.type || "application/octet-stream",
  };
}

/** Best-effort — n'échoue jamais l'action appelante. */
export async function deleteProgressPhotoFile(supabase: TypedSupabaseClient, storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(PROGRESS_PHOTOS_BUCKET).remove([storagePath]);
  devWarn("deleteProgressPhotoFile", error);
}

/** URL signée de courte durée (bucket privé, soumis à la même RLS que la ligne progress_photos correspondante). */
export async function getSignedProgressPhotoUrl(
  supabase: TypedSupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(PROGRESS_PHOTOS_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  devWarn("getSignedProgressPhotoUrl", error);
  if (error || !data) return null;
  return data.signedUrl;
}
