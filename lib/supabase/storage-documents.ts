import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";
import type { DocumentType } from "@/types";

/**
 * Upload/lecture de fichiers réels pour la bibliothèque de documents —
 * chantier "supabase-documents-storage-upload". Bucket unique "documents"
 * (déjà créé, voir supabase/schema.sql section Storage) : le bucket
 * "videos" provisionné reste inutilisé pour ne pas dupliquer la policy
 * d'accès par document sur deux buckets — un fichier vidéo uploadé passe
 * aussi par "documents".
 *
 * Le bucket reste privé (public: false). Toute lecture passe par une URL
 * signée (`createSignedUrl`), jamais par une URL publique directe — la
 * génération elle-même est soumise à la policy RLS
 * `documents_bucket_select_accessible` (voir schema.sql), donc un élève ne
 * peut obtenir un lien que pour un document qu'il a le droit de lire.
 */

export const DOCUMENTS_BUCKET = "documents";

type TypedSupabaseClient = SupabaseClient<Database>;

const SIZE_LIMITS_MB: Record<"pdf" | "image" | "vidéo" | "autre", number> = {
  pdf: 25,
  image: 10,
  "vidéo": 200,
  autre: 25,
};

export interface UploadedDocumentFile {
  storagePath: string;
  fileName: string;
  fileSizeBytes: number;
  fileMimeType: string;
}

/** Catégorie de validation à partir du type de document — "guide"/"lien"/"texte" passent par "autre" (pas de contrainte MIME). */
function validationCategory(type: DocumentType): "pdf" | "image" | "vidéo" | "autre" {
  if (type === "pdf" || type === "image" || type === "vidéo") return type;
  return "autre";
}

/** Valide un fichier avant upload : type MIME cohérent avec le type de document choisi, taille sous la limite. Renvoie un message d'erreur clair ou `null`. */
export function validateDocumentFile(file: File, type: DocumentType): string | null {
  const category = validationCategory(type);

  if (category === "pdf" && file.type !== "application/pdf") {
    return "Ce champ attend un fichier PDF (application/pdf).";
  }
  if (category === "image" && !file.type.startsWith("image/")) {
    return "Ce champ attend une image (jpg, png, webp...).";
  }
  if (category === "vidéo" && !file.type.startsWith("video/")) {
    return "Ce champ attend un fichier vidéo.";
  }

  const limitMb = SIZE_LIMITS_MB[category];
  const limitBytes = limitMb * 1024 * 1024;
  if (file.size > limitBytes) {
    return `Fichier trop lourd (${(file.size / 1024 / 1024).toFixed(1)} Mo) — maximum ${limitMb} Mo.`;
  }
  return null;
}

/** Avertissement non bloquant (ex : vidéo volumineuse) — distinct d'une erreur de validation. */
export function warnLargeVideo(file: File, type: DocumentType): string | null {
  if (type === "vidéo" && file.size > 50 * 1024 * 1024) {
    return `Vidéo volumineuse (${(file.size / 1024 / 1024).toFixed(0)} Mo) — l'upload peut prendre du temps.`;
  }
  return null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

/** Uploade un fichier dans `<documentId>/<timestamp>-<nom>` du bucket "documents". */
export async function uploadDocumentFile(
  supabase: TypedSupabaseClient,
  documentId: string,
  file: File,
): Promise<UploadedDocumentFile | { error: string }> {
  const path = `${documentId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    return { error: error.message };
  }
  return { storagePath: path, fileName: file.name, fileSizeBytes: file.size, fileMimeType: file.type || "application/octet-stream" };
}

/** Supprime un fichier du bucket (remplacement/suppression) — silencieux en cas d'échec (fichier déjà absent, etc.), jamais bloquant. */
export async function deleteDocumentFile(supabase: TypedSupabaseClient, storagePath: string): Promise<void> {
  await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
}

/**
 * Génère une URL signée temporaire pour ouvrir/télécharger un fichier —
 * échoue (renvoie `null`) si l'utilisateur courant n'a pas accès en lecture
 * à l'objet (policy RLS `documents_bucket_select_accessible`), ce qui
 * empêche un élève d'obtenir un lien vers un fichier qui ne lui est pas
 * accessible.
 */
export async function getSignedDocumentFileUrl(
  supabase: TypedSupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data) {
    return null;
  }
  return data.signedUrl;
}
