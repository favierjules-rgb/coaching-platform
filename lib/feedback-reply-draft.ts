/**
 * Brouillon de « Réponse coach » (modale de détail d'un retour élève).
 *
 * Contrat (correction bloquante 25/07/2026) :
 *  - la réponse existante est chargée UNE seule fois lorsque le retour
 *    sélectionné change (comparaison par id) ;
 *  - tant que l'id ne change pas, la saisie en cours n'est JAMAIS écrasée,
 *    même si l'objet feedback est re-créé par un rechargement de liste.
 *
 * Logique pure, testée dans scripts/tests/feedback-reply-draft.mts.
 */

export interface ReplyDraftState {
  /** Id du retour dont provient le brouillon courant. */
  feedbackId: string;
  /** Texte en cours de saisie. */
  draft: string;
}

/** Le brouillon doit-il être (ré)initialisé depuis la réponse enregistrée ? */
export function shouldLoadReply(state: ReplyDraftState | null, feedbackId: string): boolean {
  return state === null || state.feedbackId !== feedbackId;
}

/**
 * Transition d'état à chaque rendu « le retour sélectionné est X » :
 * recharge la réponse enregistrée seulement si l'id change, sinon renvoie
 * l'état STRICTEMENT identique (aucun re-render, aucune perte de saisie).
 */
export function syncReplyDraft(
  state: ReplyDraftState | null,
  feedbackId: string,
  savedCoachReply: string,
): ReplyDraftState {
  if (!shouldLoadReply(state, feedbackId)) return state as ReplyDraftState;
  return { feedbackId, draft: savedCoachReply };
}

/** Transition d'état à chaque frappe : ne fait que mettre à jour le texte. */
export function typeIntoDraft(state: ReplyDraftState, nextText: string): ReplyDraftState {
  return { feedbackId: state.feedbackId, draft: nextText };
}
