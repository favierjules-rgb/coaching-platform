import { FEEDBACK_VIDEO_MIME_TYPES, type FeedbackVideoMime } from "@/lib/feedback-video";
import type { Annotation } from "@/lib/video-annotations";

/**
 * F5 — RÉPONSE VIDÉO DU COACH : les décisions PURES.
 *
 * Même rôle que `lib/feedback-video.ts` pour l'élève : ni réseau, ni DOM, ni
 * Supabase. Uniquement ce qui doit être VRAI, et donc testable sans
 * navigateur.
 *
 * ────────────────────────────────────────────────────────────────────────
 * CE QUI EST REPRIS DE F4, ET CE QUI DIFFÈRE
 * ────────────────────────────────────────────────────────────────────────
 * REPRIS TEL QUEL : les trois conteneurs acceptés, la forme du chemin, la
 * normalisation du type MIME. Ce sont les mêmes contraintes techniques —
 * dupliquer les listes n'apporterait qu'une occasion de divergence, donc on
 * les IMPORTE.
 *
 * DIFFÉRENT :
 *   • 120 s au lieu de 20 — le coach explique, l'élève montre ;
 *   • 200 Mo au lieu de 50, en conséquence directe ;
 *   • 3 jours de rétention au lieu de 30 — un conseil se regarde vite ;
 *   • le premier segment du chemin est l'élève DESTINATAIRE, pas l'auteur.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI 3 JOURS, ET CE QUE ÇA VEUT DIRE
 * ────────────────────────────────────────────────────────────────────────
 * Décision produit : la réponse du coach est un rendez-vous, pas une
 * archive. L'élève a trois jours pour la regarder.
 *
 * Le compte à rebours part du DÉPÔT, pas de la première ouverture — sans
 * quoi une vidéo jamais ouverte ne s'effacerait jamais. L'âge réel vient de
 * `storage.objects.created_at`, comme en F4.1 : `coach_reply_video_uploaded_at`
 * sert à l'affichage, pas à la purge.
 *
 * Le balayage étant quotidien, une vidéo devient éligible à J+3 et part
 * généralement au passage suivant. Elle peut donc rester quelques heures de
 * plus — jamais moins. C'est le bon sens de l'imprécision : on ne retire
 * jamais un conseil avant l'heure annoncée.
 */

/**
 * CE QU'EST UNE RÉPONSE DE COACH, DÉSORMAIS.
 *
 * Trois faces d'une même chose, posées ENSEMBLE en une écriture : sans quoi
 * il existerait un instant où le retour porte une vidéo sans son calque —
 * et l'élève peut ouvrir son historique pendant cet instant-là.
 *
 * Le texte reste OBLIGATOIRE dans le type mais peut être vide : le coach a le
 * droit de ne répondre qu'en vidéo. Ce qui est refusé, c'est une réponse
 * entièrement vide, et c'est l'écran qui le dit — pas ce type.
 */
export interface ReponseCoach {
  texte: string;
  /** `null` retire la vidéo ; `undefined` la laisse telle quelle. */
  videoPath?: string | null;
  annotations?: readonly Annotation[] | null;
}

/** Bucket dédié — le sens de lecture est inversé, voir 20260827090000. */
export const COACH_REPLY_VIDEO_BUCKET = "coach-reply-videos";

/** Miroir exact de `file_size_limit` (200 Mo). */
export const COACH_REPLY_VIDEO_MAX_BYTES = 209_715_200;

/** Le coach explique ; deux minutes suffisent, et bornent l'attente à l'envoi. */
export const COACH_REPLY_VIDEO_MAX_SECONDS = 120;

/** Rétention, en jours, à compter du dépôt. */
export const COACH_REPLY_VIDEO_RETENTION_DAYS = 3;

/** Les mêmes conteneurs que l'élève : mêmes navigateurs, mêmes contraintes. */
export const COACH_REPLY_VIDEO_MIME_TYPES = FEEDBACK_VIDEO_MIME_TYPES;
export type CoachReplyVideoMime = FeedbackVideoMime;

/**
 * Forme du chemin : `<student_id>/<uuid>.<mp4|mov|webm>`.
 *
 * Miroir de la contrainte SQL `workout_feedback_coach_reply_video_path_shape`.
 * Le premier segment est l'élève DESTINATAIRE — même quand c'est le coach qui
 * dépose. Ce qui cloisonne, c'est à qui la vidéo est destinée : un
 * changement de coach ne doit jamais faire basculer la visibilité d'un
 * fichier déjà déposé.
 */
export const COACH_REPLY_VIDEO_PATH_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$/;

export const COACH_REPLY_VIDEO_EXTENSIONS: Record<CoachReplyVideoMime, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

function mo(octets: number): string {
  return (octets / 1_048_576).toFixed(0);
}

/** Valide un fichier AVANT tout envoi. `null` si tout va bien. */
export function validateCoachReplyVideoFile(fichier: { type: string; size: number }): string | null {
  const nu = fichier.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!(COACH_REPLY_VIDEO_MIME_TYPES as readonly string[]).includes(nu)) {
    return "Format non accepté. Envoie une vidéo MP4, MOV ou WebM.";
  }
  if (fichier.size > COACH_REPLY_VIDEO_MAX_BYTES) {
    return `Vidéo trop lourde (${mo(fichier.size)} Mo pour ${mo(COACH_REPLY_VIDEO_MAX_BYTES)} Mo maximum). Filme en 720p, ou raccourcis.`;
  }
  if (fichier.size === 0) return "Le fichier est vide. Recommence l'enregistrement.";
  return null;
}

/**
 * Valide la durée mesurée dans le navigateur.
 *
 * `null` en entrée = durée illisible (certains WebM de `MediaRecorder` n'en
 * portent pas). On ACCEPTE dans ce cas : le plafond de taille reste, lui,
 * opposable. Le trou est le même qu'en F4, et il est nommé ici aussi plutôt
 * que masqué.
 */
export function validateCoachReplyVideoDuration(secondes: number | null): string | null {
  if (secondes === null || !Number.isFinite(secondes) || secondes <= 0) return null;
  if (secondes > COACH_REPLY_VIDEO_MAX_SECONDS + 0.5) {
    return `Vidéo trop longue (${secondes.toFixed(0)} s pour ${COACH_REPLY_VIDEO_MAX_SECONDS} s maximum). Découpe-la avant d'envoyer.`;
  }
  return null;
}

/** Construit le chemin d'une NOUVELLE réponse. Un uuid neuf à chaque dépôt. */
export function buildCoachReplyVideoPath(
  studentId: string,
  mime: CoachReplyVideoMime,
  identifiant: string,
): string {
  return `${studentId}/${identifiant}.${COACH_REPLY_VIDEO_EXTENSIONS[mime]}`;
}

/** Ce chemin désigne-t-il bien l'élève de ce retour ? Miroir du gardien. */
export function isCoachReplyVideoPathFor(chemin: string, studentId: string): boolean {
  if (!COACH_REPLY_VIDEO_PATH_SHAPE.test(chemin)) return false;
  return chemin.split("/")[0] === studentId;
}

/* ════════════════════════════════════════════════════════════════════════
 * LE COMPTE À REBOURS — ce que l'élève lit
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Combien de jours pleins restent à l'élève pour regarder.
 *
 * Rend `0` le dernier jour, et un nombre négatif quand le délai est dépassé
 * (la vidéo est alors en attente du prochain passage du balayeur). L'appelant
 * décide quoi en dire — ce module ne fabrique pas de phrase, il compte.
 */
export function joursRestantsAvantPurge(deposeLe: string | null, maintenant: number): number | null {
  if (!deposeLe) return null;
  const depot = Date.parse(deposeLe);
  if (!Number.isFinite(depot)) return null;
  const echeance = depot + COACH_REPLY_VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return Math.floor((echeance - maintenant) / (24 * 60 * 60 * 1000));
}

/**
 * La mention affichée à l'élève.
 *
 * Elle ne promet PAS une suppression à la seconde : le balayage est
 * quotidien, donc la vidéo peut rester quelques heures de plus — jamais
 * moins. On annonce donc un plancher (« encore 2 jours »), jamais une
 * échéance à l'heure près, et on dit ce qui se passe ensuite.
 */
export function mentionDelaiCoachReplyVideo(deposeLe: string | null, maintenant: number): string | null {
  const jours = joursRestantsAvantPurge(deposeLe, maintenant);
  if (jours === null) return null;
  if (jours <= 0) return "Dernier jour pour la regarder : elle sera effacée au prochain nettoyage.";
  if (jours === 1) return "Encore 1 jour pour la regarder.";
  return `Encore ${jours} jours pour la regarder.`;
}

/** Mention posée à côté du champ, côté coach. */
export const COACH_REPLY_VIDEO_LABEL = `${COACH_REPLY_VIDEO_MAX_SECONDS} s maximum. Ton élève a ${COACH_REPLY_VIDEO_RETENTION_DAYS} jours pour la regarder, ensuite elle est effacée.`;
