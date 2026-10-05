import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import {
  deleteProgressPhotoFile,
  getSignedProgressPhotoUrl,
  uploadProgressPhotoFile,
} from "@/lib/supabase/storage-progress-photos";
import type { ProgressPhoto, ProgressPhotoAngle, ProgressPhotoType } from "@/types";
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
  /**
   * RÔLE de la photo (`progress_photos.type`) — « mensuelle » par défaut.
   *
   * ⚠️ DISTINCT DE `photoType`, QUI EST L'ANGLE. P3A : l'ancien formulaire de
   * `/profil` et de la fiche coach fait choisir ce rôle (avant / actuelle /
   * objectif / mensuelle) et c'est lui que `ProgressPhotos` lit pour composer
   * ses trois vignettes « Avant / Actuelle / Objectif ». Le brancher sur cet
   * upload sans transporter le rôle l'aurait forcé à « mensuelle » et aurait
   * vidé ces trois vignettes.
   */
  type?: ProgressPhotoType;
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
      type: input.type ?? "mensuelle",
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

/**
 * LE CHEMIN STORAGE SE RELIT EN BASE, IL NE SE FAIT PLUS PASSER (P2).
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT CORRIGÉ
 * ════════════════════════════════════════════════════════════════════════
 * `storagePath` arrivait de l'appelant, et `useProgressPhotosGallery` le
 * prenait dans son ÉTAT REACT (`photos.find(p => p.id === photoId)`). Une
 * liste pas encore chargée, un identifiant venu d'ailleurs, et l'argument
 * valait `null` : la ligne partait, le fichier restait, et rien ne le
 * signalait. La seule source fiable est la ligne elle-même.
 *
 * ⚠️ LE TROISIÈME PARAMÈTRE A ÉTÉ SUPPRIMÉ, PAS RÉTROGRADÉ EN REPLI. Un
 * `storage_path` relu en base PUIS rattrapé par `?? cheminConnu` laisse
 * revenir l'état React par la porte de service : il suffit que la base
 * réponde NULL — photo base64, lecture refusée par la RLS — pour que la
 * valeur de l'appelant reprenne la main et désigne un fichier qui peut
 * appartenir à une AUTRE photo (liste périmée, identifiant réutilisé).
 * Supprimer le fichier d'une photo qu'on ne supprimait pas est un défaut
 * pire que celui qu'on corrige. Les trois appelants
 * (`useProgressPhotosGallery`, `deleteProgressPhotoSupabase`, et par lui les
 * deux hooks élève/coach) ne passaient déjà que `(supabase, photoId)` : la
 * signature a donc été réduite à ce qu'elle doit être.
 *
 * `storage_path` à NULL en base ⇒ AUCUN appel Storage. Ce n'est pas un
 * abandon silencieux : une photo sans `storage_path` est une photo dont le
 * fichier n'est pas dans le bucket (les 8 lignes base64 historiques, P3B).
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ORDRE DES OPÉRATIONS N'EST PAS INVERSÉ, ET C'EST DÉLIBÉRÉ
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ LIRE → SUPPRIMER LA LIGNE → SUPPRIMER LE FICHIER. Jamais l'inverse.
 *
 * Il n'existe aucune transaction couvrant Postgres ET Storage : l'un des deux
 * échecs partiels est inévitable, et les deux ne coûtent pas la même chose.
 *
 *   · fichier supprimé, ligne conservée → une ligne qui pointe vers un
 *     fichier mort : image cassée définitive, donnée PERDUE côté élève ;
 *   · ligne supprimée, fichier conservé → un orphelin : quelques octets
 *     facturés, invisible, et RATTRAPABLE par un nettoyage ultérieur.
 *
 * On garde donc l'ordre qui, en cas d'échec, perd de l'espace disque plutôt
 * que des photos. Fermer complètement la fenêtre demanderait une file de
 * suppressions différées (table + tâche de purge) : c'est une architecture
 * supplémentaire, pas une correction de ce lot, et elle est signalée comme
 * telle plutôt qu'improvisée ici.
 */
export async function deleteProgressPhotoPermanently(
  supabase: TypedSupabaseClient,
  photoId: string,
): Promise<boolean> {
  // 1. LIRE avant de supprimer : après le DELETE, la ligne n'existe plus.
  const { data: ligne, error: lectureError } = await supabase
    .from("progress_photos")
    .select("storage_path")
    .eq("id", photoId)
    .maybeSingle();
  devWarn("deleteProgressPhotoPermanently (lecture storage_path)", lectureError);
  // SEULE SOURCE DE VÉRITÉ. Pas de `??` après ce point : `storage_path` à NULL
  // en base signifie « aucun fichier à supprimer », pas « demander ailleurs ».
  const chemin = (ligne as { storage_path: string | null } | null)?.storage_path ?? null;

  // 2. SUPPRIMER LA LIGNE.
  const { error } = await supabase.from("progress_photos").delete().eq("id", photoId);
  devWarn("deleteProgressPhotoPermanently", error);
  if (error) {
    // ⚠️ AUCUN FICHIER N'EST TOUCHÉ. Supprimer l'image d'une ligne toujours
    // présente la transformerait en vignette cassée irréparable.
    return false;
  }

  // 3. SUPPRIMER LE FICHIER — best-effort, comme avant.
  if (chemin) {
    await deleteProgressPhotoFile(supabase, chemin);
  }
  return true;
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
