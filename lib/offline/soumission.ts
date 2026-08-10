import type { AdminStudentFeedback, WorkoutFeedbackPayload } from "@/types";

import type { DepotOffline } from "@/lib/offline/depot";

/**
 * LE CLIC SUR « ENREGISTRER MON RETOUR ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST DIT À L'ÉLÈVE DOIT ÊTRE VRAI
 * ════════════════════════════════════════════════════════════════════════
 * Il n'y a que trois choses honnêtes à afficher après ce clic :
 *
 *   • « c'est enregistré »          — le serveur l'a accepté ;
 *   • « synchronisation en attente » — IndexedDB a COMMITÉ la transaction ;
 *   • une erreur                     — et la saisie reste à l'écran.
 *
 * Le deuxième message est le plus délicat : il ne peut être affiché
 * qu'APRÈS le commit, jamais avant, et jamais « en optimiste ». Un
 * « synchronisation en attente » affiché sur une écriture qui a échoué, c'est
 * une séance que l'élève croit à l'abri et qui n'existe nulle part.
 *
 * ════════════════════════════════════════════════════════════════════════
 * INDEXEDDB N'EST PAS UNE DÉPENDANCE DU CHEMIN EN LIGNE
 * ════════════════════════════════════════════════════════════════════════
 * Navigation privée, stockage désactivé, quota atteint : IndexedDB peut
 * simplement ne pas être là. L'application EN LIGNE n'en a jamais eu besoin
 * et ne doit pas commencer maintenant.
 *
 * Concrètement : quand le POST réussit, TOUTE erreur de stockage local est
 * avalée. Elle est rendue à l'appelant dans `cacheLocalIndisponible`, pour
 * un signalement discret — jamais pour bloquer, jamais pour transformer un
 * enregistrement réussi en échec.
 */

export interface Reseau {
  /**
   * Envoie le retour par le chemin serveur EXISTANT.
   *
   * `null` = refus ou panne. La distinction entre les deux appartient à
   * l'appelant, qui connaît le transport ; ici, seule compte la question
   * « le serveur a-t-il enregistré ? ».
   */
  envoyer(payload: WorkoutFeedbackPayload): Promise<AdminStudentFeedback | null>;
}

export interface OptionsSoumission {
  /** Le payload SERVEUR — celui qui part au POST et qui remplit l'outbox. */
  payload: WorkoutFeedbackPayload;
  /**
   * L'état du FORMULAIRE — celui que l'écran saura réafficher.
   *
   * Les deux magasins ne portent plus la même chose : `training_draft`
   * reçoit ceci, `training_outbox` reçoit `payload`. Voir
   * `DepotOffline.validerRetourHorsLigne`.
   */
  etatFormulaire: unknown;
  /** Id Auth — clé du dépôt local. */
  userId: string;
  sessionId: string;
  /** Date métier de la SÉANCE — celle qui figera `businessDate` du brouillon. */
  businessDate: string;
  operationId: string;
  /** `null` quand l'application se sait hors ligne : on ne tente même pas. */
  reseau: Reseau | null;
  depot: DepotOffline;
  maintenant?: () => number;
}

export type ResultatSoumission =
  /** Le serveur a enregistré. C'est fini. */
  | {
      etat: "envoye";
      feedback: AdminStudentFeedback;
      /** Le cache local a échoué — à signaler discrètement, jamais à bloquer. */
      cacheLocalIndisponible: boolean;
    }
  /** COMMIT IndexedDB confirmé : brouillon + outbox, dans une seule transaction. */
  | { etat: "en_attente"; revision: number }
  /** Ni serveur, ni stockage local. On ne prétend RIEN. */
  | { etat: "echec_local"; message: string };

/**
 * Enregistre le retour — serveur d'abord, file d'attente locale ensuite.
 *
 * L'ordre n'est pas négociable : tant qu'il y a du réseau, le serveur reste
 * autoritaire et l'outbox n'a pas lieu d'exister. On ne bascule en file
 * d'attente que lorsque l'envoi n'a pas abouti.
 */
export async function soumettreRetour(options: OptionsSoumission): Promise<ResultatSoumission> {
  const maintenant = options.maintenant ?? (() => Date.now());

  // ── CHEMIN EN LIGNE ─────────────────────────────────────────────────
  if (options.reseau !== null) {
    let feedback: AdminStudentFeedback | null = null;
    try {
      feedback = await options.reseau.envoyer(options.payload);
    } catch {
      // Panne de transport : on retombe sur la file d'attente, plus bas.
      feedback = null;
    }
    if (feedback) {
      // Le retour est enregistré côté serveur. Ce qui suit est du confort,
      // et le confort n'a pas le droit de faire échouer l'essentiel.
      let cacheLocalIndisponible = false;
      try {
        await options.depot.ecrireBrouillon({
          userId: options.userId,
          sessionId: options.sessionId,
          businessDate: options.businessDate,
          // La forme FORMULAIRE, ici aussi : ce magasin n'en accepte plus d'autre.
          payload: options.etatFormulaire,
          maintenant: maintenant(),
          revision: Number.MAX_SAFE_INTEGER,
          syncStatus: "synchronise",
        });
      } catch {
        cacheLocalIndisponible = true;
      }
      return { etat: "envoye", feedback, cacheLocalIndisponible };
    }
  }

  // ── FILE D'ATTENTE LOCALE ───────────────────────────────────────────
  // `validerRetourHorsLigne` écrit le brouillon ET l'opération dans UNE
  // transaction : il n'existe pas d'état intermédiaire où l'un serait là
  // sans l'autre. La révision est calculée dans cette même transaction, à
  // partir des deux magasins.
  try {
    const { revision } = await options.depot.validerRetourHorsLigne({
      userId: options.userId,
      sessionId: options.sessionId,
      businessDate: options.businessDate,
      etatFormulaire: options.etatFormulaire,
      payloadServeur: options.payload,
      operationId: options.operationId,
      maintenant: maintenant(),
    });
    // ET SEULEMENT MAINTENANT l'appelant a le droit d'afficher
    // « Synchronisation en attente ».
    return { etat: "en_attente", revision };
  } catch (erreur) {
    // Ni serveur, ni disque. La saisie reste à l'écran, et on le dit.
    return {
      etat: "echec_local",
      message:
        erreur instanceof Error && erreur.message
          ? erreur.message
          : "Le stockage local est indisponible.",
    };
  }
}
