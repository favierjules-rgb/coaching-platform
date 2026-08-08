/**
 * F4 — VIDÉO DE TECHNIQUE DE L'ÉLÈVE : les décisions PURES.
 *
 * Ce module ne touche ni au réseau, ni au DOM, ni à Supabase. Il ne contient
 * que ce qui doit être VRAI, et donc testable sans navigateur : les plafonds,
 * les types acceptés, la forme du chemin, et les refus — avec leur texte.
 *
 * MIROIR DE LA BASE. Chaque constante ci-dessous a un jumeau dans
 * `supabase/migrations/20260826090000_student_feedback_video.sql`, et
 * `scripts/tests/student-feedback-video.mts` relit la migration pour vérifier
 * qu'ils ne divergent pas. Deux vérités qui se contredisent, c'est une
 * validation navigateur qui promet ce que la base refuse — l'élève filme,
 * attend, et se fait jeter à l'envoi.
 *
 * CE QUE LA BASE TIENT, ET CE QU'ELLE NE PEUT PAS TENIR
 *   - la TAILLE et le TYPE : `file_size_limit` et `allowed_mime_types` du
 *     bucket. Contourner la validation d'ici ne sert à rien, Storage refuse ;
 *   - le PROPRIÉTAIRE : la RLS du bucket et le trigger de la colonne ;
 *   - la DURÉE : personne. PostgreSQL ne sait pas combien de temps dure un
 *     fichier. Les 20 secondes ne sont donc tenues QUE par le navigateur —
 *     bornées à la source pour une capture, mesurées avant envoi pour un
 *     import. C'est une limite assumée, écrite ici pour ne pas être oubliée.
 */

/** Bucket privé et cloisonné par élève — jamais `videos`, ouvert à tout compte connecté. */
export const FEEDBACK_VIDEO_BUCKET = "feedback-videos";

/** Miroir exact de `file_size_limit` (50 Mo). */
export const FEEDBACK_VIDEO_MAX_BYTES = 52_428_800;

/** Durée maximale d'une vidéo de technique. Tenue par le navigateur seul. */
export const FEEDBACK_VIDEO_MAX_SECONDS = 20;

/**
 * Objectif de rétention, en jours. ⚠️ IL N'EST PAS ENCORE TENU : la purge
 * automatique arrive avec F4.1. Tant qu'elle n'existe pas, ce nombre ne doit
 * apparaître dans AUCUN texte visible par l'élève ou le coach — promettre
 * une suppression qui n'a lieu nulle part est pire que de ne rien promettre.
 * Il sert de valeur de référence au code de purge à venir, et à lui seul.
 */
export const FEEDBACK_VIDEO_RETENTION_DAYS = 30;

/** Miroir exact de `allowed_mime_types`. */
export const FEEDBACK_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export type FeedbackVideoMime = (typeof FEEDBACK_VIDEO_MIME_TYPES)[number];

/**
 * Extension de fichier par type. Elle n'est pas cosmétique : la contrainte
 * SQL `exercise_feedback_video_path_shape` n'accepte que ces trois-là, donc
 * un chemin bâti avec une autre extension serait refusé à l'écriture de la
 * ligne — après l'envoi du fichier.
 */
export const FEEDBACK_VIDEO_EXTENSIONS: Record<FeedbackVideoMime, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/**
 * Forme du chemin : `<student_id>/<uuid>.<mp4|mov|webm>`.
 *
 * Miroir EXACT de la contrainte SQL du même nom. Deux segments seulement :
 * une resoumission de retour supprime puis recrée les lignes
 * `exercise_feedback`, donc un chemin qui nommerait la ligne rendrait la
 * vidéo orpheline à la première correction. Le chemin ne porte que ce qui ne
 * bouge jamais — à qui appartient ce fichier.
 */
export const FEEDBACK_VIDEO_PATH_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(mp4|mov|webm)$/;

/**
 * Ramène un type MIME de navigateur au type CANONIQUE du bucket.
 *
 * `MediaRecorder` ne rend jamais un type nu : Chrome produit
 * `video/webm;codecs=vp8,opus`, Safari `video/mp4;codecs=avc1`. Envoyé tel
 * quel, ce type ne figure pas dans `allowed_mime_types` et Storage refuse le
 * fichier — sans que rien, côté écran, n'explique pourquoi. On coupe donc les
 * paramètres et on compare au vocabulaire, exactement comme le fait
 * `normalizeMovementPattern` pour les patterns : on VÉRIFIE l'appartenance,
 * on ne caste jamais à l'aveugle.
 *
 * Rend `null` pour tout ce qui n'est pas l'un des trois types acceptés.
 */
export function normalizeFeedbackVideoMime(raw: string | null | undefined): FeedbackVideoMime | null {
  if (typeof raw !== "string") return null;
  const nu = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  return (FEEDBACK_VIDEO_MIME_TYPES as readonly string[]).includes(nu)
    ? (nu as FeedbackVideoMime)
    : null;
}

/** Mégaoctets, arrondis à un chiffre — pour écrire des refus lisibles. */
function mo(octets: number): string {
  return (octets / 1_048_576).toFixed(octets >= 10_485_760 ? 0 : 1).replace(".", ",");
}

/**
 * Valide un fichier AVANT tout envoi. Rend `null` si tout va bien, sinon le
 * message à afficher — en français, et qui dit quoi faire, pas seulement que
 * c'est refusé.
 */
export function validateFeedbackVideoFile(fichier: { type: string; size: number }): string | null {
  if (normalizeFeedbackVideoMime(fichier.type) === null) {
    return "Format non accepté. Envoie une vidéo MP4, MOV (iPhone) ou WebM.";
  }
  if (fichier.size > FEEDBACK_VIDEO_MAX_BYTES) {
    return `Vidéo trop lourde (${mo(fichier.size)} Mo pour ${mo(FEEDBACK_VIDEO_MAX_BYTES)} Mo maximum). Filme en 720p plutôt qu'en 4K, ou recoupe la séquence.`;
  }
  if (fichier.size === 0) {
    return "Le fichier est vide. Recommence l'enregistrement.";
  }
  return null;
}

/**
 * Valide la durée mesurée dans le navigateur.
 *
 * `null` en entrée = durée ILLISIBLE. Certains conteneurs WebM produits par
 * `MediaRecorder` n'écrivent pas leur durée dans l'en-tête et rendent
 * `Infinity`. On ACCEPTE dans ce cas plutôt que de refuser une vidéo
 * parfaitement valide : le plafond de taille reste, lui, opposable. Le trou
 * est réel — une vidéo longue à faible débit peut passer — et il est nommé
 * ici plutôt que masqué.
 */
export function validateFeedbackVideoDuration(secondes: number | null): string | null {
  if (secondes === null || !Number.isFinite(secondes) || secondes <= 0) return null;
  if (secondes > FEEDBACK_VIDEO_MAX_SECONDS + 0.5) {
    return `Vidéo trop longue (${secondes.toFixed(0)} s pour ${FEEDBACK_VIDEO_MAX_SECONDS} s maximum). Recoupe-la dans ton application Photos, ou filme une seule série.`;
  }
  return null;
}

/**
 * Construit le chemin d'une NOUVELLE vidéo. Un uuid neuf à chaque dépôt :
 * jamais d'écrasement en place, donc jamais une vidéo servie depuis un cache
 * alors qu'elle a changé.
 *
 * `identifiant` est injecté pour que les tests n'aient pas besoin de
 * `crypto.randomUUID` et puissent affirmer sur un chemin exact.
 */
export function buildFeedbackVideoPath(
  studentId: string,
  mime: FeedbackVideoMime,
  identifiant: string,
): string {
  return `${studentId}/${identifiant}.${FEEDBACK_VIDEO_EXTENSIONS[mime]}`;
}

/**
 * Ce chemin appartient-il bien à CET élève ? Miroir applicatif du contrôle
 * que fait le trigger `enforce_exercise_feedback_write()`. On ne s'en remet
 * pas à lui pour la sécurité — c'est lui qui fait autorité — mais l'écran ne
 * doit jamais proposer d'écrire un chemin que la base refusera.
 */
export function isOwnFeedbackVideoPath(chemin: string, studentId: string): boolean {
  if (!FEEDBACK_VIDEO_PATH_SHAPE.test(chemin)) return false;
  return chemin.split("/")[0] === studentId;
}

/**
 * Mention affichée sous le champ. Elle ne dit QUE ce qui est vrai aujourd'hui.
 *
 * Elle annonçait « Conservée 30 jours, visible par toi et ton coach
 * uniquement ». Deux mensonges en une phrase : rien n'efface encore les
 * vidéos au bout de 30 jours (F4.1), et l'administrateur les voit aussi. On
 * décrit donc la PORTÉE — qui, elle, est tenue par la RLS et prouvée par la
 * checklist — et le seul geste dont l'élève dispose réellement : retirer.
 * La mention de la durée reviendra le jour où la purge existera.
 */
export const FEEDBACK_VIDEO_VISIBILITY_LABEL =
  "Visible par toi, ton coach et l'administrateur. Tu peux la retirer quand tu veux.";
