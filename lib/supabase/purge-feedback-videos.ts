import type { SupabaseClient } from "@supabase/supabase-js";

import { FEEDBACK_VIDEO_BUCKET } from "@/lib/feedback-video";
import { SEUILS_FEEDBACK_VIDEO } from "@/lib/feedback-video-retention";
import {
  purgerBucketVideo,
  type BilanPurge,
  type ProfilPurgeVideo,
  type ReferenceVideo,
} from "@/lib/supabase/purge-video-bucket";
import type { Database } from "@/types/supabase";

/**
 * F4.1 — LA PURGE DE RÉTENTION DES VIDÉOS DE TECHNIQUE.
 *
 * Appelée une fois par jour par `app/api/cron/purge-feedback-videos`. Elle ne
 * s'exécute qu'avec le client service role, jamais depuis un navigateur.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE FICHIER NE PORTE PLUS L'ALGORITHME, ET C'EST VOULU (F5)
 * ────────────────────────────────────────────────────────────────────────
 * L'ordre des opérations, la course entre PostgreSQL et Storage, les deux
 * filets et la réconciliation vivent désormais dans
 * `lib/supabase/purge-video-bucket.ts`, parce qu'un second bucket vidéo
 * (`coach-reply-videos`, F5) se purge exactement de la même façon. Recopier
 * trois cents lignes durcies deux fois, c'était garantir qu'une correction
 * future ne serait appliquée qu'à l'un des deux.
 *
 * Ce qui reste ICI est ce qui n'appartient qu'aux vidéos d'élève : le
 * bucket, les seuils, et la table qui porte les références.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'ÂGE VIENT DE STORAGE, JAMAIS DE `video_uploaded_at`
 * ────────────────────────────────────────────────────────────────────────
 * `exercise_feedback.video_uploaded_at` est reposé à CHAQUE resoumission du
 * retour : la ligne est supprimée puis recréée, donc le trigger redate. Un
 * élève qui rouvre son retour tous les 29 jours garderait sa vidéo
 * indéfiniment. `storage.objects.created_at`, lui, date le FICHIER et ne
 * bouge jamais — c'est lui qui fait autorité.
 *
 * La seule chose que `video_uploaded_at` sait dire de vrai, c'est depuis
 * quand CETTE ligne pointe vers CE chemin : la réconciliation s'en sert pour
 * ne pas déclarer cassé un rattachement plus récent que l'inventaire.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUE « 30 JOURS » VEUT DIRE EXACTEMENT
 * ────────────────────────────────────────────────────────────────────────
 * Une vidéo devient éligible à J+30. En fonctionnement nominal, le cron
 * quotidien (03:00 UTC) la traite au passage suivant, généralement entre
 * J+30 et J+31.
 *
 * « Généralement » n'est pas une coquetterie : un échec Storage, un nouvel
 * essai, le plafond de suppressions par exécution ou un arriéré peuvent
 * repousser le traitement de plusieurs passages. Il n'y a donc pas de borne
 * haute garantie, et ce paragraphe existe pour qu'on n'en promette pas une.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

const PREFIXE_LOG = "[purge-feedback-videos]";

export const PROFIL_PURGE_FEEDBACK_VIDEOS: ProfilPurgeVideo = {
  bucket: FEEDBACK_VIDEO_BUCKET,
  prefixeLog: PREFIXE_LOG,
  seuils: SEUILS_FEEDBACK_VIDEO,

  /** Toutes les références actuelles, paginées — la table peut être longue. */
  async lireReferences(supabase: TypedSupabaseClient) {
    const lignes: ReferenceVideo[] = [];
    const taille = 1000;
    for (let page = 0; page < 1000; page += 1) {
      const { data, error } = await supabase
        .from("exercise_feedback")
        .select("video_path, video_uploaded_at")
        .range(page * taille, page * taille + taille - 1);
      if (error) {
        console.error(`${PREFIXE_LOG} lecture des références : ${error.message}`);
        return { lignes, complet: false };
      }
      if (!data || data.length === 0) break;
      for (const ligne of data) {
        if (ligne.video_path) {
          lignes.push({ videoPath: ligne.video_path, videoUploadedAt: ligne.video_uploaded_at });
        }
      }
      if (data.length < taille) break;
    }
    return { lignes, complet: true };
  },

  async estReference(supabase: TypedSupabaseClient, path: string) {
    const { data, error } = await supabase
      .from("exercise_feedback")
      .select("id")
      .eq("video_path", path)
      .limit(1);
    if (error) return { erreur: error.message };
    return { presente: (data ?? []).length > 0 };
  },

  /**
   * `video_uploaded_at` n'est PAS envoyé — le type `Update` de la table ne
   * l'expose même pas, et c'est voulu : le gardien
   * `enforce_exercise_feedback_write` le DÉRIVE, et le remet à NULL dès que
   * `video_path` passe à NULL. La purge n'a donc rien à dire là-dessus, et
   * ne peut pas se tromper.
   */
  async leverReference(supabase: TypedSupabaseClient, path: string) {
    const { data, error } = await supabase
      .from("exercise_feedback")
      .update({ video_path: null })
      .eq("video_path", path)
      .select("id");
    if (error) return { erreur: error.message };
    return { lignes: (data ?? []).length };
  },
};

export async function purgeFeedbackVideos(
  supabase: TypedSupabaseClient,
  options: { maintenant?: number; maximumParExecution?: number } = {},
): Promise<BilanPurge> {
  return purgerBucketVideo(supabase, PROFIL_PURGE_FEEDBACK_VIDEOS, options);
}

export type { BilanPurge, EchecPurge, SuppressionJournalisee } from "@/lib/supabase/purge-video-bucket";
