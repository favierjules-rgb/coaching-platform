import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

/**
 * Upload de la photo de banniere/couverture d'un programme d'entrainement
 * (chantier training-builder-v2, tache #55). Bucket dedie "program-covers",
 * public en lecture (image decorative, faible sensibilite -- evite d'avoir a
 * generer une URL signee cote eleve pour un simple visuel de programme).
 * L'ecriture (upload/suppression) reste reservee aux coachs/admins via la
 * policy RLS `program_covers_bucket_manage_staff` (voir migration
 * program_covers_bucket).
 */
export const PROGRAM_COVERS_BUCKET = "program-covers";

type TypedSupabaseClient = SupabaseClient<Database>;

const MAX_SIZE_MB = 5;

/** Valide un fichier avant upload : doit etre une image, sous la limite de taille. Renvoie un message d'erreur clair ou `null`. */
export function validateCoverImageFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "Ce champ attend une image (jpg, png, webp...).";
  }
  const limitBytes = MAX_SIZE_MB * 1024 * 1024;
  if (file.size > limitBytes) {
    return `Image trop lourde (${(file.size / 1024 / 1024).toFixed(1)} Mo) -- maximum ${MAX_SIZE_MB} Mo.`;
  }
  return null;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
}

export interface UploadedCoverImage {
  publicUrl: string;
  error?: string;
}

/** Upload une photo de banniere dans `covers/<timestamp>-<nom>` du bucket "program-covers", et renvoie son URL publique. */
export async function uploadProgramCoverImage(
  supabase: TypedSupabaseClient,
  file: File,
): Promise<UploadedCoverImage> {
  const validationError = validateCoverImageFile(file);
  if (validationError) {
    return { publicUrl: "", error: validationError };
  }
  const path = `covers/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage.from(PROGRAM_COVERS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    return { publicUrl: "", error: "Echec de l'envoi de l'image." };
  }
  const { data } = supabase.storage.from(PROGRAM_COVERS_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl };
}
