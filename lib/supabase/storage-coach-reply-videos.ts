import type { SupabaseClient } from "@supabase/supabase-js";

import {
  COACH_REPLY_VIDEO_BUCKET,
  buildCoachReplyVideoPath,
  isCoachReplyVideoPathFor,
  validateCoachReplyVideoFile,
  type CoachReplyVideoMime,
} from "@/lib/coach-reply-video";
import {
  signerUrlVideo,
  signerUrlsVideo,
  viderDossierVideoEleve,
} from "@/lib/supabase/storage-video-buckets";
import type { Database } from "@/types/supabase";

/**
 * F5 — RÉPONSE VIDÉO DU COACH : le Storage.
 *
 * Jumeau de `storage-feedback-videos.ts`, avec une inversion qu'il faut avoir
 * en tête à chaque ligne : ici c'est le COACH qui écrit et l'ÉLÈVE qui lit.
 * La mécanique commune (pagination, signature groupée) vient de
 * `storage-video-buckets.ts` ; ce qui reste ici est ce qui n'appartient qu'à
 * ce bucket.
 *
 * LE PREMIER SEGMENT DU CHEMIN EST L'ÉLÈVE, PAS L'AUTEUR
 *   `<student_id>/<uuid>.<ext>` — le dossier désigne le DESTINATAIRE. C'est
 *   ce qui permet à l'élève de lire, et c'est ce qui fait qu'un changement de
 *   coach ne fait jamais basculer la visibilité d'un fichier déjà déposé. La
 *   RLS du bucket dit qui a le droit d'écrire dans ce dossier ; le gardien de
 *   `workout_feedback` dit, en plus, que le chemin rattaché à une ligne
 *   désigne bien l'élève de CE retour.
 *
 * CE MODULE N'EFFACE JAMAIS UNE RÉPONSE À L'UNITÉ
 *   Même raisonnement qu'en F4, et il vaut d'être refait plutôt que supposé :
 *   la BASE ne connaît le nouveau chemin qu'au moment où le coach ENVOIE sa
 *   réponse. Effacer l'ancien fichier dès le remplacement ferait pointer la
 *   base, définitivement, vers un objet disparu si le coach ferme la modale
 *   sans envoyer. L'écran ne fait donc qu'AJOUTER ; l'ancien objet devient un
 *   orphelin ordinaire, ramassé par le balayeur de rétention. Pire cas
 *   admis : un fichier de trop. Jamais une vidéo manquante.
 *
 *   Seule exception, la même qu'en F4 : le DOSSIER ENTIER d'un élève supprimé
 *   (RGPD). Une réponse de coach est nominative — elle nomme l'élève, montre
 *   sa technique, porte la voix de son coach. Elle part avec lui.
 *
 * AUCUNE URL N'EST STOCKÉE. La colonne porte un CHEMIN ; l'URL signée est
 * fabriquée à la lecture. Stocker une URL signée en base, c'est stocker un
 * jeton d'accès qui périme.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export interface CoachReplyVideoUploaded {
  /** Chemin à écrire dans `workout_feedback.coach_reply_video_path`. */
  path: string;
}

/**
 * Envoie une réponse vidéo dans le dossier de l'ÉLÈVE DESTINATAIRE.
 *
 * `identifiant` est injecté plutôt que tiré de `crypto.randomUUID()` à
 * l'intérieur : les tests peuvent alors affirmer sur un chemin exact sans
 * simuler l'API du navigateur.
 */
export async function uploadCoachReplyVideo(
  supabase: TypedSupabaseClient,
  parametres: {
    /** L'élève à qui la réponse est DESTINÉE — jamais l'identifiant du coach. */
    studentId: string;
    fichier: Blob;
    mime: CoachReplyVideoMime;
    identifiant: string;
  },
): Promise<CoachReplyVideoUploaded | { error: string }> {
  const { studentId, fichier, mime, identifiant } = parametres;

  // On revalide ICI, et pas seulement dans l'écran : ce module est le dernier
  // endroit traversé avant le réseau. Une validation qui ne vit que dans
  // l'interface est une validation qu'un second appelant oubliera.
  const refus = validateCoachReplyVideoFile({ type: mime, size: fichier.size });
  if (refus) return { error: refus };

  const path = buildCoachReplyVideoPath(studentId, mime, identifiant);
  // Ceinture et bretelles : un identifiant d'élève mal formé produirait un
  // chemin que la base refuserait APRÈS l'envoi du fichier. Autant le voir
  // avant de téléverser 200 Mo.
  if (!isCoachReplyVideoPathFor(path, studentId)) {
    return { error: "Chemin de stockage invalide. Recharge la page et réessaie." };
  }

  const { error } = await supabase.storage
    .from(COACH_REPLY_VIDEO_BUCKET)
    .upload(path, fichier, { upsert: false, contentType: mime });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Supabase] uploadCoachReplyVideo :", error.message);
    }
    return { error: "L'envoi de la vidéo a échoué. Vérifie ta connexion et réessaie." };
  }
  return { path };
}

/**
 * Supprime TOUTES les réponses vidéo destinées à un élève. Réservé à la
 * suppression complète d'un élève (RGPD) : c'est le seul endroit du dépôt où
 * un objet de ce bucket est effacé à la demande.
 */
export async function removeAllStudentCoachReplyVideos(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<{ supprimes: number; complet: boolean }> {
  return viderDossierVideoEleve(supabase, COACH_REPLY_VIDEO_BUCKET, studentId);
}

/**
 * URL signée de lecture. `null` quand l'appelant n'a pas le droit de voir ce
 * chemin — la RLS du bucket décide, pas ce module. Ici, « avoir le droit »
 * veut dire : être l'élève destinataire, son coach rattaché, ou l'admin.
 */
export async function getSignedCoachReplyVideoUrl(
  supabase: TypedSupabaseClient,
  path: string | null,
  expiresIn = 3600,
): Promise<string | null> {
  return signerUrlVideo(supabase, COACH_REPLY_VIDEO_BUCKET, path, expiresIn);
}

/**
 * Résout plusieurs chemins en une passe, en gardant la correspondance —
 * une requête pour toute la page de retours, jamais une par ligne.
 */
export async function loadSignedCoachReplyVideoUrls(
  supabase: TypedSupabaseClient,
  chemins: readonly (string | null)[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  return signerUrlsVideo(supabase, COACH_REPLY_VIDEO_BUCKET, chemins, expiresIn);
}
