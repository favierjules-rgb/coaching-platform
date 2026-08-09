import type { SupabaseClient } from "@supabase/supabase-js";

import { COACH_REPLY_VIDEO_BUCKET } from "@/lib/coach-reply-video";
import { SEUILS_COACH_REPLY_VIDEO } from "@/lib/coach-reply-video-retention";
import {
  purgerBucketVideo,
  type BilanPurge,
  type ProfilPurgeVideo,
  type ReferenceVideo,
} from "@/lib/supabase/purge-video-bucket";
import type { Database } from "@/types/supabase";

/**
 * F5 — LA PURGE DE RÉTENTION DES RÉPONSES VIDÉO DU COACH.
 *
 * Même balayeur que les vidéos d'élève (`purgerBucketVideo`), même ordre,
 * mêmes filets. Ce fichier ne porte que les trois choses qui diffèrent : le
 * bucket, les seuils (3 jours au lieu de 30), et la table de référence
 * (`workout_feedback` au lieu de `exercise_feedback`).
 *
 * ────────────────────────────────────────────────────────────────────────
 * LE CLOISONNEMENT N'EST PAS AFFAIBLI PAR LE PARTAGE
 * ────────────────────────────────────────────────────────────────────────
 * Le balayeur ne connaît que le bucket qu'on lui donne, et ce profil n'en
 * nomme qu'un. Les deux purges tournent l'une après l'autre, chacune sur son
 * bucket et sa table : aucune ne peut voir les objets de l'autre, et un
 * échec sur l'une ne fait pas taire l'autre.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LEVER LA RÉFÉRENCE EMPORTE LE CALQUE — MAIS PAS D'ICI
 * ────────────────────────────────────────────────────────────────────────
 * `coach_reply_video_annotations` n'a aucun sens sans la vidéo qu'il
 * recouvre, et la contrainte
 * `workout_feedback_coach_reply_video_annotations_sans_video` l'interdit en
 * base. C'est le GARDIEN qui remet le calque à NULL sur la transition du
 * chemin vers NULL (20260827090000), donc cette purge n'envoie que le
 * chemin — exactement comme celle des vidéos d'élève n'envoie que
 * `video_path`.
 *
 * Une première version envoyait aussi la colonne du calque, « par sécurité ».
 * Le test l'a démentie : la muter n'a fait échouer aucun contrôle, parce que
 * la règle était déjà tenue ailleurs. Une ligne que rien n'exerce n'est pas
 * une protection, c'est une seconde vérité qui attend de diverger. La règle
 * vit en base, et c'est la checklist SQL (H1) qui la prouve.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUE « 3 JOURS » VEUT DIRE EXACTEMENT
 * ────────────────────────────────────────────────────────────────────────
 * Une vidéo devient éligible à J+3. En fonctionnement nominal, le cron
 * quotidien (03:00 UTC) la traite au passage suivant, généralement entre
 * J+3 et J+4.
 *
 * « Généralement » n'est pas une coquetterie : un échec Storage, un nouvel
 * essai, le plafond de suppressions par exécution ou un arriéré peuvent
 * repousser le traitement de plusieurs passages. Il n'y a pas de borne haute
 * garantie — et dans ce sens-là, l'imprécision est la bonne : on peut
 * laisser un conseil quelques heures de plus, jamais le retirer avant
 * l'heure annoncée à l'élève.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

const PREFIXE_LOG = "[purge-coach-reply-videos]";

export const PROFIL_PURGE_COACH_REPLY_VIDEOS: ProfilPurgeVideo = {
  bucket: COACH_REPLY_VIDEO_BUCKET,
  prefixeLog: PREFIXE_LOG,
  seuils: SEUILS_COACH_REPLY_VIDEO,

  /**
   * Une réponse vidéo par retour : la table est donc plus courte que celle
   * des exercices, mais on pagine quand même — le jour où elle ne l'est plus,
   * personne ne pensera à revenir ici.
   */
  async lireReferences(supabase: TypedSupabaseClient) {
    const lignes: ReferenceVideo[] = [];
    const taille = 1000;
    for (let page = 0; page < 1000; page += 1) {
      const { data, error } = await supabase
        .from("workout_feedback")
        .select("coach_reply_video_path, coach_reply_video_uploaded_at")
        .range(page * taille, page * taille + taille - 1);
      if (error) {
        console.error(`${PREFIXE_LOG} lecture des références : ${error.message}`);
        return { lignes, complet: false };
      }
      if (!data || data.length === 0) break;
      for (const ligne of data) {
        if (ligne.coach_reply_video_path) {
          lignes.push({
            videoPath: ligne.coach_reply_video_path,
            videoUploadedAt: ligne.coach_reply_video_uploaded_at,
          });
        }
      }
      if (data.length < taille) break;
    }
    return { lignes, complet: true };
  },

  async estReference(supabase: TypedSupabaseClient, path: string) {
    const { data, error } = await supabase
      .from("workout_feedback")
      .select("id")
      .eq("coach_reply_video_path", path)
      .limit(1);
    if (error) return { erreur: error.message };
    return { presente: (data ?? []).length > 0 };
  },

  /**
   * On n'envoie QUE le chemin. `coach_reply_video_uploaded_at` n'apparaît même
   * pas dans le type `Update` de la table, et le calque est remis à NULL par
   * le gardien `enforce_workout_feedback_write` — voir l'en-tête. La purge
   * n'a donc rien à dire sur ces deux colonnes, et ne peut pas se tromper.
   */
  async leverReference(supabase: TypedSupabaseClient, path: string) {
    const { data, error } = await supabase
      .from("workout_feedback")
      .update({ coach_reply_video_path: null })
      .eq("coach_reply_video_path", path)
      .select("id");
    if (error) return { erreur: error.message };
    return { lignes: (data ?? []).length };
  },
};

export async function purgeCoachReplyVideos(
  supabase: TypedSupabaseClient,
  options: { maintenant?: number; maximumParExecution?: number } = {},
): Promise<BilanPurge> {
  return purgerBucketVideo(supabase, PROFIL_PURGE_COACH_REPLY_VIDEOS, options);
}
