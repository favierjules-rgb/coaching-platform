"use client";

import { RappelNotificationsPush } from "@/components/student/RappelNotificationsPush";
import { useSessionRappelPush } from "@/components/student/SessionRappelPushProvider";
import { useNotificationsPush } from "@/hooks/useNotificationsPush";
import { rappelPushVisible } from "@/lib/push/rappel-session";

/**
 * LE RAPPEL PUSH, SANS LE BLOC DE RÉGLAGES — POUR LE TABLEAU DE BORD.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN SECOND POINT DE MONTAGE, ET PAS UN DÉPLACEMENT
 * ════════════════════════════════════════════════════════════════════════
 * Le rappel n'existait que sur `/profil`, monté par `NotificationsSection` —
 * l'onglet où l'on va justement le moins souvent. Un élève qui ne l'ouvre
 * jamais ne voyait donc jamais la demande, et ne recevait plus rien.
 *
 * On ne DÉPLACE pas le rappel pour autant : sur le profil, il doit rester
 * collé au bloc « Notifications », qui porte les boutons et le message de
 * confirmation après activation. Les deux points de montage servent deux
 * moments différents — « on te le signale en arrivant » et « voilà le réglage
 * que tu cherchais ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ UNE SEULE INSTANCE DU HOOK PAR PAGE, ET C'EST LA RÈGLE À NE PAS CASSER
 * ════════════════════════════════════════════════════════════════════════
 * `NotificationsSection` documente pourquoi elle tient l'unique
 * `useNotificationsPush` de `/profil` : deux appels produiraient deux états
 * indépendants, deux interrogations du serveur, et la possibilité qu'ils se
 * contredisent — la fenêtre disant « réactive » pendant que le bloc dit
 * « actif ».
 *
 * Ce composant est donc monté sur le TABLEAU DE BORD, où `NotificationsSection`
 * n'existe pas. Les deux ne cohabitent sur aucune page, et un test le vérifie.
 * Le monter dans le layout élève aurait recréé exactement le doublon que
 * `NotificationsSection` interdit, sur `/profil`.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LE RESTE EST REPRIS TEL QUEL
 * ════════════════════════════════════════════════════════════════════════
 * Même composant de fenêtre, même parcours d'activation, même règle
 * d'affichage dérivée (`doitProposerRappel`), même « Plus tard » qui n'écrit
 * rien. Il n'y a pas un second mécanisme de notifications dans l'application,
 * et il n'y en aura pas.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ « PLUS TARD » SE RETIENT POUR LA SESSION, PAS POUR LE COMPOSANT
 * ════════════════════════════════════════════════════════════════════════
 * Le report vivait dans un `useState` local. Or ce composant est démonté à
 * chaque changement de route : aller voir sa nutrition puis revenir au tableau
 * de bord rouvrait la même fenêtre, déjà refusée. Une demande légitime
 * devenait du harcèlement.
 *
 * Il est donc lu dans `useSessionRappelPush`, un contexte monté par le layout
 * élève — qui, lui, n'est pas remonté d'une route à l'autre. Le report survit
 * à la navigation et disparaît au rechargement de la page, c'est-à-dire à la
 * réouverture réelle de l'application.
 *
 * ⚠️ TOUJOURS RIEN D'ÉCRIT : ni Supabase, ni `localStorage`, ni
 * `sessionStorage`, ni cookie. Un verrou persistant ferait taire le rappel
 * définitivement au premier « Plus tard » — alors que « plus tard » veut dire
 * plus tard, pas « non ».
 */
export function RappelPushAutonome() {
  const { etat, message, enCours, activer } = useNotificationsPush();
  const { session, reporter } = useSessionRappelPush();

  /* Dérivé, jamais stocké : aucun cycle « ouvrir / fermer » à boucler, et
     aucun `setState` dans un effet pour le synchroniser. Une activation
     réussie fait passer `etat` à `active`, et la fenêtre disparaît d'elle-même.
     `rappelPushVisible` porte aussi la garde `chargement` : rien ne s'affiche
     par-dessus un écran d'attente. */
  if (!rappelPushVisible(etat, session)) return null;

  return (
    <RappelNotificationsPush
      etat={etat}
      message={message}
      enCours={enCours}
      onReactiver={() => void activer()}
      // Fermer ne désactive rien : aucune préférence écrite, aucun abonnement
      // retiré, aucun appel réseau. Le report est seulement retenu par la
      // session, et disparaîtra à la prochaine ouverture de l'application.
      onFermer={reporter}
    />
  );
}
