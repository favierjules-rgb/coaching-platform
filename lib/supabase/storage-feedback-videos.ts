import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FEEDBACK_VIDEO_BUCKET,
  buildFeedbackVideoPath,
  isOwnFeedbackVideoPath,
  validateFeedbackVideoFile,
  type FeedbackVideoMime,
} from "@/lib/feedback-video";
import {
  signerUrlVideo,
  signerUrlsVideo,
  viderDossierVideoEleve,
} from "@/lib/supabase/storage-video-buckets";
import type { Database } from "@/types/supabase";

/**
 * F4 — VIDÉO DE TECHNIQUE : le Storage.
 *
 * Même forme que les quatre modules `lib/supabase/storage-*.ts` déjà en
 * place : une constante de bucket, des fonctions qui rendent soit un
 * résultat, soit `{ error }`, et une suppression toujours best-effort.
 *
 * CE QUI EST À MOI, ET CE QUI EST PARTAGÉ (depuis F5)
 *   Ce module garde ce qui est PROPRE à `feedback-videos` : son bucket, et
 *   les validations qui décident ce qui a le droit d'y entrer. Les trois
 *   gestes rigoureusement identiques d'un bucket vidéo à l'autre — vider un
 *   dossier, signer une URL, en signer un lot — vivent dans
 *   `storage-video-buckets.ts` et sont appelés d'ici. Les recopier pour
 *   `coach-reply-videos` aurait donné deux versions qui divergent au premier
 *   correctif appliqué d'un seul côté.
 *
 * CE MODULE NE SUPPRIME JAMAIS UN OBJET DEPUIS L'ÉCRAN D'UN ÉLÈVE
 *   Première version : remplacer une vidéo envoyait la nouvelle puis
 *   effaçait l'ancienne dans la foulée. C'était une référence cassée en
 *   puissance — la BASE, elle, ne connaît le nouveau chemin qu'à l'envoi du
 *   retour. Un élève qui remplaçait sa vidéo puis fermait l'onglet laissait
 *   la base pointer, définitivement, vers un fichier effacé.
 *
 *   Règle désormais : l'écran ne fait qu'AJOUTER. Remplacer, c'est envoyer
 *   un nouveau fichier et changer l'état local ; retirer, c'est vider l'état
 *   local. L'ancien objet devient un orphelin ordinaire, que la purge de
 *   rétention (F4.1) ramassera après 24 h sans référence. Le pire cas admis
 *   est donc un fichier de trop, jamais une vidéo manquante.
 *
 *   La seule suppression qui subsiste est celle du DOSSIER ENTIER d'un élève
 *   supprimé (RGPD) — voir `removeAllStudentFeedbackVideos`.
 *
 * QUAND LE FICHIER PART, ET POURQUOI PAS PLUS TARD
 *   La vidéo est envoyée dès que l'élève la choisit, pas à l'envoi du
 *   retour : le chemin ne dépend que de l'identifiant de l'élève, qui existe
 *   déjà. C'est ce qui permet l'aperçu immédiat, et ce qui évite d'attendre
 *   40 Mo de téléversement au moment où l'élève valide sa séance. Rançon
 *   assumée : un élève qui choisit une vidéo puis ferme l'onglet laisse un
 *   orphelin, que la purge de rétention ramassera.
 *
 * AUCUNE URL N'EST STOCKÉE. La colonne porte un CHEMIN ; l'URL signée est
 * fabriquée à la lecture, avec sa durée de validité. Stocker une URL signée
 * en base, c'est stocker un jeton d'accès qui périme.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(contexte: string, erreur: { message: string } | null): void {
  if (erreur && process.env.NODE_ENV === "development") {
    console.warn(`[Supabase] ${contexte} :`, erreur.message);
  }
}

export interface FeedbackVideoUploaded {
  /** Chemin à écrire dans `exercise_feedback.video_path`. */
  path: string;
}

/**
 * Envoie une vidéo dans le dossier de l'élève.
 *
 * `identifiant` est injecté plutôt que tiré de `crypto.randomUUID()` à
 * l'intérieur : les tests peuvent alors affirmer sur un chemin exact sans
 * simuler l'API du navigateur.
 */
export async function uploadFeedbackVideo(
  supabase: TypedSupabaseClient,
  parametres: {
    studentId: string;
    fichier: Blob;
    mime: FeedbackVideoMime;
    identifiant: string;
  },
): Promise<FeedbackVideoUploaded | { error: string }> {
  const { studentId, fichier, mime, identifiant } = parametres;

  // On revalide ICI, et pas seulement dans le composant : ce module est le
  // dernier endroit traversé avant le réseau. Une validation qui ne vit que
  // dans l'écran est une validation qu'un second appelant oubliera.
  const refus = validateFeedbackVideoFile({ type: mime, size: fichier.size });
  if (refus) return { error: refus };

  const path = buildFeedbackVideoPath(studentId, mime, identifiant);
  // Ceinture et bretelles : un identifiant d'élève mal formé produirait un
  // chemin que la base refuserait APRÈS l'envoi du fichier. Autant le voir
  // avant de téléverser 40 Mo.
  if (!isOwnFeedbackVideoPath(path, studentId)) {
    return { error: "Chemin de stockage invalide. Recharge la page et réessaie." };
  }

  const { error } = await supabase.storage
    .from(FEEDBACK_VIDEO_BUCKET)
    .upload(path, fichier, { upsert: false, contentType: mime });

  if (error) {
    devWarn("uploadFeedbackVideo", error);
    return { error: "L'envoi de la vidéo a échoué. Vérifie ta connexion et réessaie." };
  }
  return { path };
}

/**
 * Supprime TOUS les objets du dossier d'un élève. Réservé à la suppression
 * complète d'un élève (RGPD) : c'est le seul endroit du dépôt où un objet de
 * ce bucket est effacé à la demande.
 *
 * On liste par pages : `list()` en rend 100 par défaut, et un élève assidu
 * dépasse ce chiffre. Une purge qui s'arrête à la centième vidéo laisse
 * derrière elle exactement ce qu'elle prétendait effacer.
 *
 * Best-effort : l'échec est journalisé en développement, jamais remonté —
 * mais il est RENDU, pour que l'appelant puisse le dire.
 */
export async function removeAllStudentFeedbackVideos(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<{ supprimes: number; complet: boolean }> {
  return viderDossierVideoEleve(supabase, FEEDBACK_VIDEO_BUCKET, studentId);
}

/**
 * URL signée de lecture. `null` quand l'appelant n'a pas le droit de voir ce
 * chemin — la RLS du bucket décide, pas ce module.
 *
 * Une heure, comme les photos de progression et les documents : assez pour
 * regarder une vidéo, trop peu pour qu'un lien recopié serve longtemps.
 */
export async function getSignedFeedbackVideoUrl(
  supabase: TypedSupabaseClient,
  path: string | null,
  expiresIn = 3600,
): Promise<string | null> {
  return signerUrlVideo(supabase, FEEDBACK_VIDEO_BUCKET, path, expiresIn);
}

/**
 * Résout plusieurs chemins en une passe, en gardant la correspondance.
 * Utilisé par la modale du coach : une séance peut porter une vidéo par
 * exercice, et chacune a besoin de sa propre signature.
 */
export async function loadSignedFeedbackVideoUrls(
  supabase: TypedSupabaseClient,
  chemins: readonly (string | null)[],
  expiresIn = 3600,
): Promise<Map<string, string>> {
  // UNE requête pour toute la page, pas une par vidéo : voir `signerUrlsVideo`.
  return signerUrlsVideo(supabase, FEEDBACK_VIDEO_BUCKET, chemins, expiresIn);
}
