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
 * `documents_bucket_select_accessible`, donc un élève ne peut obtenir un lien
 * que pour un document qu'il a le droit de lire.
 *
 * ⚠️ CONVENTION DE CHEMIN DEPUIS 20261023090000 :
 *
 *     <fiche_coach>/<document_id>/<horodatage>-<nom de fichier>
 *
 * Le premier segment porte le PROPRIÉTAIRE, et c'est lui qui protège les
 * fichiers orphelins (ligne `documents` supprimée). L'ancienne forme
 * `<document_id>/<nom>` reste lue : la policy cherche l'identifiant du
 * document dans n'importe quel segment. Aucun fichier existant n'est déplacé.
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
  /**
   * `null` QUAND LE MIME EST INCONNU, JAMAIS `""` (B).
   *
   * `uploadDocumentFile` renvoie toujours une valeur (au pire
   * `"application/octet-stream"`, le marqueur « MIME inconnu » reconnu par
   * `documentKind`). Mais ce type sert AUSSI à décrire un fichier DÉJÀ
   * en base, relu à l'édition : là, `documents.file_mime_type` peut être nul
   * (7 des 17 lignes actuelles), et le ramener à `""` réécrivait une absence
   * en chaîne vide à chaque enregistrement.
   */
  fileMimeType: string | null;
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

/**
 * Fiche staff de l'appelant, telle que la BASE la connaît.
 *
 * ⚠️ RÉSOLUE PAR LA BASE, PAS DÉDUITE ICI. `public.current_staff_id()` est
 * SECURITY DEFINER et ne rend que la fiche de l'appelant : c'est la seule
 * valeur qu'on puisse mettre dans un chemin de stockage sans mentir. Un
 * identifiant choisi côté navigateur serait une déclaration, et la policy
 * Storage la refuserait de toute façon — autant échouer tôt et clairement.
 */
async function ficheStaffDeLAppelant(supabase: TypedSupabaseClient): Promise<string | null> {
  try {
    const { data } = await supabase.rpc("current_staff_id");
    const brut: unknown = Array.isArray(data) ? data[0] : data;
    return typeof brut === "string" && brut.length > 0 ? brut : null;
  } catch {
    return null;
  }
}

/**
 * Uploade un fichier dans `<fiche_coach>/<documentId>/<timestamp>-<nom>`.
 *
 * ⚠️ LE PREMIER SEGMENT EST LE PROPRIÉTAIRE, ET C'EST CE QUI PROTÈGE LES
 * ORPHELINS. Avant, le chemin était `<documentId>/<nom>` : il ne disait rien
 * du propriétaire, et la policy Storage devait donc laisser passer l'écriture
 * quand AUCUNE ligne `documents` ne correspondait — sans quoi le premier
 * téléversement, qui précède la création de la ligne, aurait été impossible.
 * Un fichier dont la ligne avait été supprimée retombait dans cette brèche et
 * redevenait manipulable par tout le staff.
 *
 * Désormais la policy compare ce premier segment à `current_staff_id()`
 * résolu EN BASE : le premier téléversement passe sans ligne, et un coach qui
 * forge le préfixe d'un autre est refusé.
 *
 * ⚠️ L'ANCIENNE CONVENTION RESTE LISIBLE : la policy cherche l'identifiant du
 * document dans n'importe quel segment du chemin, donc les fichiers déjà en
 * place et les téléchargements élèves ne bougent pas. Aucun fichier n'est
 * déplacé par ce lot.
 */
export async function uploadDocumentFile(
  supabase: TypedSupabaseClient,
  documentId: string,
  file: File,
): Promise<UploadedDocumentFile | { error: string }> {
  const fiche = await ficheStaffDeLAppelant(supabase);
  if (!fiche) {
    return {
      error:
        "Aucune fiche coach n'est rattachée à ce compte : le fichier n'a pas de propriétaire possible. Contacte l'administrateur.",
    };
  }
  const path = `${fiche}/${documentId}/${Date.now()}-${sanitizeFileName(file.name)}`;
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
