import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

/**
 * Upload Storage pour les photos bannière de programmes/séances (chantier
 * module Programmation, étape 4), modelé sur
 * lib/supabase/storage-progress-photos.ts. Le bucket "banners" est PUBLIC
 * (voir supabase/migrations/20260716_training_v3_programmation_banners.sql) :
 * contrairement aux autres buckets du projet, on stocke directement l'URL
 * publique (`banner_url`) plutôt qu'un `storage_path` + résolution d'URL
 * signée — ces images doivent être affichables sans authentification (élève
 * ET, à terme, page d'accueil publique pour les programmes en paiement
 * unique, étape 6).
 *
 * Convention de chemin : `<kind>/<entityId>/<timestamp>-<nom-fichier>`, avec
 * kind = "programs" | "sessions" — voir policies `banners_bucket_*` (écriture
 * réservée coach/admin, aucune contrainte de premier segment côté RLS
 * puisque la lecture est publique).
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export const BANNERS_BUCKET = "banners";

const ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_MB = 8;

export type BannerKind = "programs" | "sessions";

function devWarn(context: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}`);
  }
}

/** Retourne un message d'erreur explicite si le fichier n'est pas acceptable, sinon null. */
export function validateBannerFile(file: File): string | null {
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

/** Upload le fichier et renvoie directement son URL publique (bucket "banners" public), ou une erreur explicite. */
export async function uploadBannerFile(
  supabase: TypedSupabaseClient,
  kind: BannerKind,
  entityId: string,
  file: File,
): Promise<{ publicUrl: string } | { error: string }> {
  const validationError = validateBannerFile(file);
  if (validationError) {
    return { error: validationError };
  }
  const path = `${kind}/${entityId}/${Date.now()}-${sanitizeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(BANNERS_BUCKET)
    .upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) {
    return { error: error.message };
  }
  const { data } = supabase.storage.from(BANNERS_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl };
}

/** Best-effort — n'échoue jamais l'action appelante. Déduit le chemin Storage depuis l'URL publique. */
export async function deleteBannerFileByPublicUrl(supabase: TypedSupabaseClient, publicUrl: string): Promise<void> {
  const marker = `/object/public/${BANNERS_BUCKET}/`;
  const index = publicUrl.indexOf(marker);
  if (index === -1) return;
  const path = decodeURIComponent(publicUrl.slice(index + marker.length));
  const { error } = await supabase.storage.from(BANNERS_BUCKET).remove([path]);
  devWarn("deleteBannerFileByPublicUrl", error);
}
