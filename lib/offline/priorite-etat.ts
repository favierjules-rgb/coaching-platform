import type { AdminStudentFeedback } from "@/types";

/**
 * QUI GAGNE — LE BROUILLON LOCAL, OU LE SERVEUR ?
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA QUESTION SE POSE À CHAQUE OUVERTURE
 * ════════════════════════════════════════════════════════════════════════
 * Trois sources peuvent prétendre remplir le formulaire :
 *
 *   • le BROUILLON local — ce que l'élève a saisi, peut-être hier ;
 *   • l'OPÉRATION EN ATTENTE — un retour validé qui n'est jamais parti ;
 *   • le FEEDBACK SERVEUR — la vérité, quand on a pu la lire.
 *
 * Les faire cohabiter au hasard produit les deux pannes symétriques :
 * un vieux brouillon qui écrase un retour fraîchement corrigé côté serveur,
 * ou un serveur qui écrase une saisie que l'élève vient de faire en avion.
 * Les deux sont silencieuses.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA RÈGLE, EN TROIS CAS
 * ════════════════════════════════════════════════════════════════════════
 *   A. HORS LIGNE, brouillon présent
 *      → LE BROUILLON GAGNE. C'est la seule saisie récente disponible, et
 *        le serveur n'a de toute façon rien à dire ici.
 *
 *   B. EN LIGNE, une opération EN ATTENTE existe
 *      → LE BROUILLON GAGNE ENCORE. Le serveur ne connaît, au mieux, que la
 *        révision précédente : afficher sa version ferait disparaître de
 *        l'écran une correction qui attend justement de partir.
 *
 *   C. EN LIGNE, aucune opération en attente, feedback serveur chargé
 *      → LE SERVEUR EST LA RÉFÉRENCE. Un brouillon local survivant est un
 *        résidu — d'une session précédente, d'un autre appareil, d'un envoi
 *        déjà acquitté. Le laisser gagner réécrirait par-dessus la vérité.
 *
 * Le reste découle : sans rien à restaurer, le formulaire est vierge.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUE CE MODULE NE DÉCIDE PAS
 * ════════════════════════════════════════════════════════════════════════
 * Il ne lit rien, n'écrit rien, ne purge rien. Il répond à une question et
 * rend une origine. La purge du brouillon après un envoi réussi appartient
 * à l'appelant — et ne doit jamais conditionner le succès de cet envoi.
 */

export type OrigineFormulaire =
  /** Restaurer la saisie locale. */
  | "brouillon"
  /** Préremplir depuis le retour enregistré côté serveur. */
  | "serveur"
  /** Rien à restaurer : formulaire neuf. */
  | "vierge";

export interface EntreePriorite {
  /** `true` quand la source est `offline`. */
  horsLigne: boolean;
  /** Le brouillon local de CE compte et de CETTE séance, ou `null`. */
  brouillon: { revision: number; payload: unknown } | null;
  /** L'opération en file d'attente pour cette séance, ou `null`. */
  operationEnAttente: { revision: number } | null;
  /** Le retour connu du serveur (chargé en ligne, ou figé dans le snapshot). */
  feedbackServeur: AdminStudentFeedback | null;
}

export interface DecisionPriorite {
  origine: OrigineFormulaire;
  /** Le payload à injecter quand `origine === "brouillon"`. */
  payload: unknown | null;
  /** Motif — pour le diagnostic, jamais affiché à l'élève. */
  motif: string;
}

export function choisirOrigineFormulaire(entree: EntreePriorite): DecisionPriorite {
  // ── CAS A ─────────────────────────────────────────────────────────
  if (entree.horsLigne && entree.brouillon) {
    return {
      origine: "brouillon",
      payload: entree.brouillon.payload,
      motif: "hors ligne : la saisie locale est la seule récente",
    };
  }

  // ── CAS B ─────────────────────────────────────────────────────────
  if (entree.operationEnAttente && entree.brouillon) {
    return {
      origine: "brouillon",
      payload: entree.brouillon.payload,
      motif: "une opération attend d'être envoyée : le serveur est en retard d'une révision",
    };
  }

  // ── CAS C ─────────────────────────────────────────────────────────
  if (!entree.operationEnAttente && entree.feedbackServeur) {
    return {
      origine: "serveur",
      payload: null,
      motif: "aucune opération en attente : le serveur fait foi",
    };
  }

  // Rien côté serveur, rien en attente : un brouillon local est tout ce
  // qu'on a, et il n'écrase personne.
  if (entree.brouillon) {
    return {
      origine: "brouillon",
      payload: entree.brouillon.payload,
      motif: "aucun retour serveur : la saisie locale est la seule source",
    };
  }

  return { origine: "vierge", payload: null, motif: "rien à restaurer" };
}

/**
 * Après un envoi EN LIGNE réussi, que faire du brouillon local ?
 *
 * Il est devenu un résidu : le serveur porte désormais l'état de référence,
 * et le laisser tel quel ferait gagner le cas C à la prochaine ouverture
 * avec une version périmée.
 *
 * On répond `true` — mais l'appelant doit traiter l'échec de cette purge
 * comme un non-événement. Un `DELETE` local qui échoue après un POST réussi
 * ne transforme pas un enregistrement en erreur.
 */
export function purgerBrouillonApresEnvoi(): boolean {
  return true;
}
