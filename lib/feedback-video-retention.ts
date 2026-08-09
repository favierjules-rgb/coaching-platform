import { FEEDBACK_VIDEO_PATH_SHAPE, FEEDBACK_VIDEO_RETENTION_DAYS } from "@/lib/feedback-video";

/**
 * F4.1 — RÉTENTION DES VIDÉOS DE TECHNIQUE : les décisions PURES.
 *
 * Ce module ne parle ni à Supabase, ni au réseau. Il répond à une seule
 * question, pour un seul objet : « faut-il le supprimer, le garder, ou le
 * signaler ? » — et il y répond à partir de données déjà collectées, ce qui
 * la rend testable sans rien simuler.
 *
 * ────────────────────────────────────────────────────────────────────────
 * L'ÂGE VIENT DE STORAGE, JAMAIS DE `video_uploaded_at`
 * ────────────────────────────────────────────────────────────────────────
 * `exercise_feedback.video_uploaded_at` est reposé à CHAQUE resoumission du
 * retour : la ligne est supprimée puis recréée, donc le trigger redate. Un
 * élève qui rouvre son retour tous les 29 jours garderait sa vidéo
 * indéfiniment — la rétention ne serait qu'un affichage.
 *
 * `storage.objects.created_at`, lui, date le FICHIER. Il ne bouge jamais :
 * un nouveau dépôt crée un nouvel objet, sous un uuid neuf. C'est donc lui
 * qui fait autorité ici, et `video_uploaded_at` ne sert qu'à l'affichage et
 * à la cohérence de la colonne.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI 24 HEURES DE GRÂCE POUR UN ORPHELIN
 * ────────────────────────────────────────────────────────────────────────
 * Une vidéo est déposée AVANT que le retour ne soit envoyé : entre les deux,
 * elle n'est référencée par rien. Sans délai, la purge effacerait le fichier
 * d'un élève en train de remplir sa séance. Vingt-quatre heures couvrent
 * aussi le remplacement (V1 abandonnée au profit de V2), le retrait avant
 * envoi, et l'onglet fermé en cours de route.
 */

/**
 * Un objet ne survit pas au-delà de 30 jours d'existence RÉELLE.
 *
 * ⚠️ C'est un seuil d'ÉLIGIBILITÉ, pas une horloge.
 *
 * Une vidéo devient éligible à J+30. En fonctionnement nominal, le cron
 * quotidien (03:00 UTC, voir vercel.json) la traite au passage suivant,
 * généralement entre J+30 et J+31.
 *
 * « Généralement », et non « au plus tard » : un échec Storage, un nouvel
 * essai, le plafond de suppressions par exécution ou un arriéré peuvent
 * repousser le traitement de plusieurs passages. Annoncer une borne haute
 * ferme serait une promesse que rien ne tient.
 */
export const FEEDBACK_VIDEO_RETENTION_MS = FEEDBACK_VIDEO_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** Délai de grâce d'un objet que rien ne référence encore. */
export const FEEDBACK_VIDEO_ORPHAN_GRACE_HOURS = 24;
export const FEEDBACK_VIDEO_ORPHAN_GRACE_MS = FEEDBACK_VIDEO_ORPHAN_GRACE_HOURS * 60 * 60 * 1000;

/**
 * Plafond de suppressions par exécution. GÉNÉRIQUE : il ne dépend pas du
 * bucket, mais du temps qu'une route serveur a le droit de prendre.
 *
 * Une route serveur a un temps d'exécution borné ; un bucket qui aurait
 * accumulé des dizaines de milliers d'objets ferait expirer la requête, donc
 * échouer la purge ENTIÈRE, donc ne rien nettoyer du tout. On borne, et le
 * reliquat part au passage suivant : la purge est quotidienne, un retard de
 * quelques jours ne perd rien. Les candidats sont traités du PLUS ANCIEN au
 * plus récent, pour que le backlog se draine par le bon bout.
 */
export const PURGE_VIDEO_MAX_PAR_EXECUTION = 500;

/**
 * Âge minimal d'un rattachement avant qu'on ose le déclarer CASSÉ.
 *
 * La réconciliation compare des références lues MAINTENANT à un inventaire
 * Storage pris au DÉBUT du passage. Une vidéo déposée et rattachée entre les
 * deux serait donc « absente de l'inventaire » sans avoir jamais disparu —
 * et on effacerait la référence d'un élève qui vient tout juste d'envoyer sa
 * séance. Une heure couvre très largement la durée d'un passage.
 *
 * C'est le SEUL usage légitime de la date de rattachement dans la purge :
 * elle ne dit pas l'âge du fichier — une resoumission la redate — mais elle
 * dit fidèlement depuis quand CETTE ligne pointe vers CE chemin, ce qui est
 * exactement la question posée ici.
 *
 * GÉNÉRIQUE, comme le plafond : ce délai borne la durée d'un PASSAGE, pas
 * la rétention d'un bucket.
 */
export const RECONCILIATION_GRACE_MS = 60 * 60 * 1000;

export type RaisonSuppression = "expired_reference" | "orphan";

export type VerdictPurge =
  | { action: "supprimer"; raison: RaisonSuppression }
  | { action: "garder"; raison: "referencee_non_expiree" | "delai_de_grace" }
  /** Ni supprimé ni ignoré en silence : un objet difforme se SIGNALE. */
  | { action: "signaler"; raison: "chemin_malforme" };

export interface ObjetVideo {
  /** Chemin complet dans le bucket, `<student_id>/<uuid>.<ext>`. */
  path: string;
  /** `storage.objects.created_at`, en millisecondes. */
  creeLe: number;
}

/**
 * Ce qui change d'un bucket vidéo à l'autre, et RIEN d'autre.
 *
 * Les deux buckets — `feedback-videos` (30 jours) et `coach-reply-videos`
 * (3 jours) — se purgent selon exactement la même logique : c'est le SEUIL
 * qui diffère, pas le raisonnement. Isoler ces trois valeurs permet de
 * partager la décision sans partager les chiffres, et surtout d'éviter
 * qu'une correction de la logique ne soit appliquée qu'à un seul des deux.
 */
export interface SeuilsRetentionVideo {
  formeChemin: RegExp;
  retentionMs: number;
  graceOrphelinMs: number;
}

/**
 * Le verdict pour UN objet, quel que soit le bucket.
 *
 * La forme est vérifiée EN PREMIER, avant toute question d'âge ou de
 * référence : un chemin qu'on ne sait pas lire ne doit jamais tomber dans la
 * branche « supprimer ». Le bucket ne devrait contenir que des chemins
 * conformes — la RLS les impose à l'écriture — mais une purge est du code
 * qui efface : elle vérifie ce qu'elle croit savoir.
 */
export function classerObjetVideo(
  objet: ObjetVideo,
  contexte: { estReference: boolean; maintenant: number },
  seuils: SeuilsRetentionVideo,
): VerdictPurge {
  if (!seuils.formeChemin.test(objet.path)) {
    return { action: "signaler", raison: "chemin_malforme" };
  }

  const age = contexte.maintenant - objet.creeLe;

  if (contexte.estReference) {
    return age > seuils.retentionMs
      ? { action: "supprimer", raison: "expired_reference" }
      : { action: "garder", raison: "referencee_non_expiree" };
  }

  return age > seuils.graceOrphelinMs
    ? { action: "supprimer", raison: "orphan" }
    : { action: "garder", raison: "delai_de_grace" };
}

/** Les seuils du bucket des vidéos d'élève. */
export const SEUILS_FEEDBACK_VIDEO: SeuilsRetentionVideo = {
  formeChemin: FEEDBACK_VIDEO_PATH_SHAPE,
  retentionMs: FEEDBACK_VIDEO_RETENTION_MS,
  graceOrphelinMs: FEEDBACK_VIDEO_ORPHAN_GRACE_MS,
};

export function classerObjetFeedbackVideo(
  objet: ObjetVideo,
  contexte: { estReference: boolean; maintenant: number },
): VerdictPurge {
  return classerObjetVideo(objet, contexte, SEUILS_FEEDBACK_VIDEO);
}

/**
 * Trie et borne les candidats à la suppression.
 *
 * Du plus ancien au plus récent : si le plafond mord, ce sont les objets les
 * plus vieux qui partent — ceux dont la rétention est le plus dépassée.
 */
export function bornerCandidats<T extends ObjetVideo>(
  candidats: T[],
  maximum = PURGE_VIDEO_MAX_PAR_EXECUTION,
): { retenus: T[]; reportes: number } {
  const tries = [...candidats].sort((a, b) => a.creeLe - b.creeLe);
  return { retenus: tries.slice(0, maximum), reportes: Math.max(0, tries.length - maximum) };
}

/**
 * Le statut HTTP que doit rendre le cron.
 *
 * Un cron systématiquement vert n'apprend rien à personne : si une purge a
 * réellement échoué sur un objet, Vercel doit le marquer en échec, sinon la
 * seule façon de s'en apercevoir est de relire les journaux ligne à ligne.
 *
 * Les chemins NON TRAITÉS (forme invalide, fichier à la racine, sous-dossier
 * inattendu) ne comptent PAS : rien n'a été tenté sur eux, rien n'a raté.
 * Ce sont des avertissements d'hygiène, remontés dans le bilan et en
 * `console.warn`. Les faire échouer le cron reviendrait à le laisser rouge
 * en permanence pour un fichier oublié une fois dans le tableau de bord —
 * et un cron toujours rouge ne se lit plus.
 */
export function statutHttpPurge(bilan: { echecs: readonly unknown[] }): 200 | 500 {
  return bilan.echecs.length > 0 ? 500 : 200;
}
