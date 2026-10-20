/**
 * L'ÉTAT DES NOTIFICATIONS PUSH — DÉCIDÉ ICI, EN FONCTIONS PURES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE MODULE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * La décision vivait à l'intérieur d'un `useEffect`. Elle n'était donc
 * exécutable que dans un navigateur, et ce dépôt n'a de moteur de navigateur
 * que pour une seule suite (`profil-push-render`, Playwright). Résultat : la
 * table de vérité — six situations, six réponses — n'était vérifiée nulle
 * part.
 *
 * Tout ce qui DÉCIDE est donc ici, sans `window`, sans `fetch`, sans React.
 * Le hook ne fait plus que collecter les faits et appliquer ces fonctions.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ `Notification.permission === "granted"` NE PROUVE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Une permission accordée ne dit pas qu'un `PushSubscription` existe, et un
 * `PushSubscription` présent dans le navigateur ne dit pas que le SERVEUR le
 * connaît encore. Les trois faits sont indépendants, et c'est leur
 * divergence qui fait perdre les notifications sans que personne le voie :
 *
 *   · le service push a renouvelé l'abonnement (rotation de clé, mise à
 *     jour) : le navigateur en a un NOUVEAU, le serveur garde l'ANCIEN ;
 *   · un envoi a reçu 404/410 et `desactiverAbonnement` a posé `disabled_at`
 *     côté serveur : le navigateur, lui, a toujours son abonnement ;
 *   · la clé VAPID publique a changé au déploiement : les abonnements
 *     existants ne sont plus signables, les envois échouent, les lignes sont
 *     désactivées — et le profil continuait d'afficher « activé ».
 *
 * D'où `a_reactiver` : un état à part, qui dit « il y a quelque chose à
 * faire, et un clic suffit » — ni « actif », ni « jamais demandé ».
 */

/**
 * Les six situations du cahier des charges, et rien de plus.
 *
 *   chargement    les faits ne sont pas encore collectés
 *   non_supporte  pas de Push dans cet environnement (Safari hors PWA, dev)
 *   inactif       supporté, aucune décision prise (permission `default`)
 *   a_reactiver   permission accordée, mais l'abonnement manque ou le
 *                 serveur ne le connaît plus — UN CLIC SUFFIT
 *   active        abonné ET confirmé par le serveur
 *   refuse        permission `denied` : seuls les réglages peuvent revenir
 *   erreur        le reste : réseau, serveur, clé absente
 */
export type EtatNotifications =
  | "chargement"
  | "non_supporte"
  | "inactif"
  | "a_reactiver"
  | "active"
  | "refuse"
  | "erreur";

/**
 * Ce que le serveur sait de CET appareil.
 *
 * ⚠️ `inconnu` N'EST PAS `false`. Si l'interrogation du serveur échoue
 * (réseau, 503), on ne doit NI prétendre que l'abonnement est actif, NI
 * affirmer qu'il est perdu : on s'en tient au fait local et on n'invente
 * rien. Voir `deciderEtatPush`.
 */
export type ConfirmationServeur = "actif" | "absent" | "desactive" | "inconnu";

export interface FaitsPush {
  /** `serviceWorker` + `PushManager` + `Notification` présents. */
  readonly supporte: boolean;
  /** Valeur brute de `Notification.permission`. */
  readonly permission: NotificationPermission;
  /** `pushManager.getSubscription()` a rendu un abonnement. */
  readonly abonnementPresent: boolean;
  /** Ce que `/api/push/status` a répondu pour cet endpoint. */
  readonly serveur: ConfirmationServeur;
}

/**
 * LA TABLE DE VÉRITÉ, ET SON ORDRE DE PRIORITÉ.
 *
 * L'ordre n'est pas décoratif : un environnement sans Push ne doit pas être
 * jugé sur une permission qu'il n'a pas, et un refus doit court-circuiter
 * tout le reste pour qu'on ne redemande jamais la permission.
 */
export function deciderEtatPush(faits: FaitsPush): EtatNotifications {
  // 6. L'environnement d'abord : rien d'autre n'a de sens sans lui.
  if (!faits.supporte) return "non_supporte";

  // 3. Un refus est définitif côté navigateur. On ne le rediscute pas.
  if (faits.permission === "denied") return "refuse";

  /*
   * L'ABONNEMENT AVANT LA PERMISSION, ET CE N'EST PAS UN DÉTAIL D'ORDRE.
   *
   * ⚠️ UN `PushSubscription` NE PEUT PAS EXISTER SANS QU'UNE PERMISSION AIT
   * ÉTÉ ACCORDÉE : `pushManager.subscribe()` la réclame. Lire un abonnement
   * présent alors que `Notification.permission` vaut `default` décrit donc un
   * navigateur dont la permission a été remise à zéro APRÈS coup (réglages
   * remis à neuf, profil Safari, politique d'entreprise) — pas un appareil
   * qui n'a jamais décidé. Le fait le plus fort est l'abonnement : c'est lui
   * qu'on lit d'abord.
   *
   * Tester `default` avant l'abonnement renverrait `inactif` sur un appareil
   * réellement abonné et opérationnel, et ferait proposer une activation dont
   * il n'a pas besoin.
   */
  if (faits.abonnementPresent) {
    // 4b. Abonnement présent, mais le serveur ne le connaît plus ou l'a
    //     désactivé : les notifications ne partent plus. C'est exactement
    //     l'état « plus opérationnel après une mise à jour ».
    if (faits.serveur === "absent" || faits.serveur === "desactive") return "a_reactiver";
    // 5. Abonné, et confirmé par le serveur.
    if (faits.serveur === "actif") return "active";
    // `inconnu` : voir la note en fin de fonction.
    return "active";
  }

  // 4a. Permission accordée, mais AUCUN abonnement : c'est le cas qu'un
  //     simple `permission === "granted"` faisait passer pour actif.
  if (faits.permission === "granted") return "a_reactiver";

  // 2. Aucune décision prise, et rien d'abonné : l'activation est possible,
  //    mais la permission ne sera demandée qu'au clic.
  return "inactif";

}

/*
 * NOTE SUR `serveur === "inconnu"` (lue depuis la branche ci-dessus).
 *
 * ⚠️ ON NE TRANCHE PAS À LA PLACE DU SERVEUR. L'abonnement local existe :
 * afficher « à réactiver » pousserait l'élève à refaire une démarche inutile
 * à chaque coupure réseau, et afficher une erreur serait faux. On garde donc
 * le fait local — abonné — exactement comme avant ce lot. Le rappel, lui, ne
 * s'ouvre jamais sur `active` : on ne dérange personne sur une incertitude.
 */

/**
 * FAUT-IL OUVRIR LE RAPPEL ?
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS CONDITIONS, ET AUCUNE N'EST NÉGOCIABLE
 * ════════════════════════════════════════════════════════════════════════
 * 1. l'état le justifie — JAMAIS quand les notifications sont réellement
 *    actives, jamais pendant le chargement, jamais sur une incertitude ;
 * 2. il n'a pas DÉJÀ été proposé pendant cette visite — c'est ce verrou qui
 *    empêche la boucle : l'état est recalculé à chaque revalidation, et sans
 *    lui la fenêtre se rouvrirait à chaque passe de rendu ;
 * 3. l'élève ne l'a pas fermé pendant cette visite (« Plus tard », la croix,
 *    Échap, le clic sur le fond).
 *
 * ⚠️ « PENDANT CETTE VISITE », PAS « POUR TOUJOURS ». Rien n'est écrit dans
 * `localStorage` : le cahier des charges demande explicitement que le rappel
 * puisse revenir à une prochaine visite tant que les notifications restent
 * désactivées. Un verrou persistant le ferait taire définitivement au
 * premier « Plus tard ».
 */
export function doitProposerRappel(
  etat: EtatNotifications,
  dejaPropose: boolean,
  fermeParLUtilisateur: boolean,
): boolean {
  if (dejaPropose || fermeParLUtilisateur) return false;
  return etat === "a_reactiver" || etat === "inactif" || etat === "refuse";
}

/**
 * Le rappel a-t-il un bouton d'activation utile ?
 *
 * ⚠️ UN REFUS NAVIGATEUR N'EN A PAS. Redemander la permission après un
 * `denied` ne produit rien — aucun navigateur ne repose la question — et
 * afficher un bouton qui ne peut pas aboutir est pire que pas de bouton. On
 * affiche les instructions de réglages à la place. Même règle pour un
 * environnement sans Push.
 */
export function activationPossible(etat: EtatNotifications): boolean {
  return etat === "inactif" || etat === "a_reactiver" || etat === "erreur";
}
