import {
  COACH_REPLY_VIDEO_PATH_SHAPE,
  COACH_REPLY_VIDEO_RETENTION_DAYS,
} from "@/lib/coach-reply-video";
import {
  FEEDBACK_VIDEO_ORPHAN_GRACE_MS,
  classerObjetVideo,
  type ObjetVideo,
  type SeuilsRetentionVideo,
  type VerdictPurge,
} from "@/lib/feedback-video-retention";

/**
 * F5 — RÉTENTION DES RÉPONSES VIDÉO DU COACH : les seuils, et rien d'autre.
 *
 * Le raisonnement de purge est le MÊME que pour les vidéos d'élève, et il est
 * partagé (`classerObjetVideo`, puis `purgerBucketVideo`). Ce module ne porte
 * que ce qui diffère : la durée.
 *
 * ────────────────────────────────────────────────────────────────────────
 * 3 JOURS, ET CE QUE ÇA VEUT DIRE EXACTEMENT
 * ────────────────────────────────────────────────────────────────────────
 * Une réponse de coach est un rendez-vous, pas une archive. L'élève a trois
 * jours pour la regarder. Le compte à rebours part du DÉPÔT et non de la
 * première ouverture — sans quoi une vidéo jamais ouverte ne s'effacerait
 * jamais.
 *
 * Une vidéo devient éligible à J+3. En fonctionnement nominal, le cron
 * quotidien la traite au passage suivant, généralement entre J+3 et J+4.
 *
 * « Généralement », et non « au plus tard » : un échec Storage, un nouvel
 * essai, le plafond de suppressions par exécution ou un arriéré peuvent
 * repousser le traitement de plusieurs passages. Annoncer une borne haute
 * ferme serait une promesse que rien ne tient. C'est aussi le bon sens de
 * l'imprécision : on peut laisser un conseil quelques heures de plus, jamais
 * le retirer avant l'heure annoncée.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'ÂGE VIENT DE STORAGE, ICI AUSSI
 * ────────────────────────────────────────────────────────────────────────
 * `coach_reply_video_uploaded_at` est reposé par le gardien à chaque fois que
 * le chemin CHANGE. Un coach qui remplacerait sa vidéo repousserait donc
 * l'échéance — ce qui est correct pour une NOUVELLE vidéo, mais ne dit rien
 * de l'âge du FICHIER. `storage.objects.created_at` ne bouge jamais : c'est
 * lui qui fait autorité, exactement comme en F4.1.
 */

/**
 * Le délai de grâce d'un orphelin est le MÊME qu'en F4.1, et pour la même
 * raison : entre le dépôt du fichier et l'envoi de la réponse, rien ne le
 * référence. Vingt-quatre heures couvrent la rédaction, le remplacement, et
 * l'onglet fermé en cours de route. Ce n'est pas la rétention qui est en jeu
 * ici, c'est la durée d'un travail en cours — et elle ne dépend pas de qui
 * filme.
 */
export const COACH_REPLY_VIDEO_ORPHAN_GRACE_MS = FEEDBACK_VIDEO_ORPHAN_GRACE_MS;

/** Seuil d'ÉLIGIBILITÉ, pas une horloge. Voir l'en-tête. */
export const COACH_REPLY_VIDEO_RETENTION_MS =
  COACH_REPLY_VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

export const SEUILS_COACH_REPLY_VIDEO: SeuilsRetentionVideo = {
  formeChemin: COACH_REPLY_VIDEO_PATH_SHAPE,
  retentionMs: COACH_REPLY_VIDEO_RETENTION_MS,
  graceOrphelinMs: COACH_REPLY_VIDEO_ORPHAN_GRACE_MS,
};

export function classerObjetCoachReplyVideo(
  objet: ObjetVideo,
  contexte: { estReference: boolean; maintenant: number },
): VerdictPurge {
  return classerObjetVideo(objet, contexte, SEUILS_COACH_REPLY_VIDEO);
}
