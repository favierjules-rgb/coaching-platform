import type { EtatNotifications } from "@/lib/push/etat";
import { doitProposerRappel } from "@/lib/push/etat";

/**
 * ════════════════════════════════════════════════════════════════════════════
 * « PLUS TARD » POUR LA DURÉE DE LA SESSION — ET PAS UNE SECONDE DE PLUS
 * ════════════════════════════════════════════════════════════════════════════
 * Le rappel Push du tableau de bord se fermait sans rien retenir : son `ferme`
 * vivait dans le composant. Or le composant est démonté à chaque changement de
 * route. Aller voir sa nutrition puis revenir au tableau de bord rouvrait donc
 * la même fenêtre, déjà refusée — ce qui transforme une demande légitime en
 * harcèlement.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LA DURÉE EXACTE QU'IL FAUT RETENIR, ET POURQUOI
 * ════════════════════════════════════════════════════════════════════════════
 * Trois durées étaient possibles, et deux sont fausses :
 *
 *   · LE COMPOSANT — ce qu'on avait. Trop court : la fenêtre revient à chaque
 *     navigation.
 *   · `localStorage` — trop long, et c'est le piège qui paraît le plus
 *     raisonnable. « Plus tard » veut dire plus tard, pas « non ». Un verrou
 *     persistant ferait taire le rappel DÉFINITIVEMENT au premier report, et
 *     l'élève ne recevrait plus rien sans jamais comprendre pourquoi.
 *   · LA SESSION D'APPLICATION — la bonne. On n'insiste plus de la journée,
 *     et la prochaine ouverture repose la question si les notifications sont
 *     toujours éteintes.
 *
 * ⚠️ « SESSION » EST ICI UNE DURÉE DE VIE REACT, PAS UN STOCKAGE. L'état vit
 * dans un contexte monté par le layout élève : il survit aux changements de
 * route, qui ne remontent pas le layout, et disparaît au rechargement de la
 * page — c'est-à-dire à la réouverture réelle de l'application. Rien n'est
 * écrit nulle part : ni Supabase, ni `localStorage`, ni `sessionStorage`, ni
 * cookie. Il n'y a donc rien à purger, rien à faire expirer, et rien qui
 * puisse rester coincé.
 *
 * ⚠️ REPORTER N'EST PAS REFUSER. Cet état ne touche jamais à l'état RÉEL des
 * notifications : aucune préférence écrite, aucun abonnement retiré, aucun
 * appel réseau. `deciderEtatPush` continue de décider seul si les
 * notifications sont actives ou non.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * POURQUOI LA DÉCISION EST ICI, ET PAS DANS LE COMPOSANT
 * ════════════════════════════════════════════════════════════════════════════
 * Parce qu'elle est éprouvable. Ce dépôt n'a ni jsdom ni navigateur pour cette
 * suite : une règle écrite dans un rendu React ne se vérifierait qu'en cliquant
 * pour de vrai. Sortie du composant, la séquence complète — arrivée, report,
 * navigation, retour, nouvelle session — se rejoue sans DOM.
 */

/** Ce que la session retient du rappel Push. Rien d'autre n'y entre. */
export interface SessionRappelPush {
  /** L'utilisateur a demandé « plus tard » depuis l'ouverture de l'application. */
  readonly reporte: boolean;
}

/**
 * L'état d'une session qui commence.
 *
 * ⚠️ UNE CONSTANTE, DONC UNE NOUVELLE SESSION EST UN NOUVEL OBJET POSÉ À
 * PARTIR D'ELLE. C'est exactement ce que fait le montage du contexte au
 * chargement de la page.
 */
export const SESSION_RAPPEL_INITIALE: SessionRappelPush = { reporte: false };

/** Enregistre un « Plus tard ». Rend un nouvel objet : rien n'est muté. */
export function reporterRappel(session: SessionRappelPush): SessionRappelPush {
  return session.reporte ? session : { reporte: true };
}

/**
 * Le rappel doit-il être à l'écran ?
 *
 * ⚠️ LA RÈGLE D'ÉTAT N'EST PAS RÉÉCRITE ICI. On délègue à
 * `doitProposerRappel`, qui décide déjà quels états méritent un rappel — c'est
 * la même fonction que le profil. Cette couche n'ajoute qu'UNE chose : le
 * report de la session. Dupliquer la table des états aurait signé sa
 * divergence au premier état ajouté.
 */
export function rappelPushVisible(
  etat: EtatNotifications,
  session: SessionRappelPush,
): boolean {
  if (etat === "chargement") return false;
  return doitProposerRappel(etat, false, session.reporte);
}
