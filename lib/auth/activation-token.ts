/**
 * Jeton d'activation reçu par e-mail — logique pure, sans React ni réseau.
 *
 * ---------------------------------------------------------------------
 * Pourquoi ce module existe
 * ---------------------------------------------------------------------
 * Incident du 27/07/2026 : le jeton d'invitation d'un acheteur a été vérifié
 * avec succès 8 secondes après l'envoi de l'e-mail, sans qu'aucune session
 * ne soit créée ; son clic réel, 1 min 43 plus tard, a reçu un 403. Un agent
 * automatique — relais de sécurité, aperçu de lien, préchargement — avait
 * suivi le lien avant lui et brûlé le jeton à usage unique.
 *
 * La règle qui en découle est simple à énoncer et facile à casser par
 * inadvertance : **charger la page ne doit rien vérifier.** Elle est donc
 * isolée ici, en fonctions pures, pour être testée sans DOM ni serveur, et
 * pour qu'une régression se voie immédiatement.
 *
 * Ce module ne journalise jamais rien : il ne voit que des valeurs
 * sensibles.
 */

/**
 * Seuls ces deux types transitent par un lien e-mail dans ce projet :
 * `invite` (création de compte — public-program-provisioning.ts,
 * coach-student-provisioning.ts, coach-account-provisioning.ts) et
 * `recovery` (mot de passe oublié — app/api/public/password-reset).
 *
 * La liste est volontairement restreinte : accepter `magiclink` ou `signup`
 * reviendrait à honorer des jetons qu'aucun de nos parcours n'émet.
 */
export const TYPES_ACTIVATION_AUTORISES = ["invite", "recovery"] as const;

export type TypeActivation = (typeof TYPES_ACTIVATION_AUTORISES)[number];

export interface JetonActivation {
  tokenHash: string;
  type: TypeActivation;
}

export function estTypeActivationAutorise(valeur: string | null | undefined): valeur is TypeActivation {
  return typeof valeur === "string" && (TYPES_ACTIVATION_AUTORISES as readonly string[]).includes(valeur);
}

/**
 * Extrait le jeton des paramètres d'URL, ou `null` si rien d'exploitable.
 *
 * Prend une fonction de lecture plutôt qu'un objet, pour accepter aussi bien
 * `URLSearchParams` que le `ReadonlyURLSearchParams` de Next.js — et pour
 * rester testable sans navigateur.
 */
export function lireJetonActivation(lire: (cle: string) => string | null): JetonActivation | null {
  const tokenHash = lire("token_hash");
  const type = lire("type");
  if (!tokenHash || tokenHash.trim().length === 0) return null;
  if (!estTypeActivationAutorise(type)) return null;
  return { tokenHash, type };
}

/** Issue d'une tentative de vérification, du point de vue de l'interface. */
export type IssueVerification =
  | { etat: "session"; userId: string }
  /** Le lien a déjà été ouvert — le cas de l'incident. */
  | { etat: "consomme" }
  /** Aucun jeton exploitable, ou jeton expiré/refusé. */
  | { etat: "invalide" }
  /** Une tentative a déjà eu lieu sur cette instance : rien n'est rejoué. */
  | { etat: "ignore" };

/**
 * Distingue « déjà ouvert » de « expiré », à partir du message de GoTrue.
 *
 * L'utilisateur n'a pas à connaître le détail technique, mais les deux
 * situations n'appellent pas la même phrase : « déjà ouvert » lui explique
 * ce qui s'est passé, « expiré » l'invite simplement à recommencer. Dans les
 * deux cas, la réponse ne révèle jamais si une adresse existe en base.
 */
export function classerEchecVerification(message: string | undefined): "consomme" | "invalide" {
  if (!message) return "consomme";
  return /expired|expir/i.test(message) ? "invalide" : "consomme";
}

export interface DependancesVerificateur {
  /** Échange le jeton contre une session. Un seul appel sera jamais émis. */
  verifierJeton: (jeton: JetonActivation) => Promise<{
    userId?: string;
    messageErreur?: string;
  }>;
}

export interface Verificateur {
  /**
   * Échange le jeton — À N'APPELER QUE depuis un gestionnaire d'événement
   * déclenché par l'utilisateur. Jamais depuis un effet, un rendu ou une
   * hydratation : c'est précisément ce qui a causé l'incident.
   */
  tenter: () => Promise<IssueVerification>;
  /** Vrai tant qu'aucune tentative n'a eu lieu. */
  disponible: () => boolean;
}

/**
 * Fabrique un vérificateur à usage unique.
 *
 * Le drapeau est posé AVANT le premier `await` : deux clics rapprochés, un
 * double-tap mobile ou un rerender ne peuvent pas produire deux appels
 * réseau. Une fois la tentative faite, le jeton est oublié — même en cas
 * d'échec, puisqu'il n'est de toute façon plus valide.
 */
export function creerVerificateurActivation(
  jetonInitial: JetonActivation | null,
  deps: DependancesVerificateur,
): Verificateur {
  let jeton = jetonInitial;
  let tentative = false;

  return {
    disponible: () => !tentative && jeton !== null,

    async tenter(): Promise<IssueVerification> {
      if (tentative) return { etat: "ignore" };
      tentative = true;

      const courant = jeton;
      jeton = null;
      if (!courant) return { etat: "invalide" };

      const resultat = await deps.verifierJeton(courant);
      if (resultat.userId) return { etat: "session", userId: resultat.userId };
      return { etat: classerEchecVerification(resultat.messageErreur) };
    },
  };
}

/**
 * Retire `token_hash` et `type` d'une URL, en préservant le reste.
 *
 * Appelée dès le premier rendu côté navigateur : le jeton disparaît de la
 * barre d'adresse avant toute vérification. Il ne part donc plus dans un
 * `Referer`, ne reste pas dans l'historique et ne peut plus être rejoué
 * depuis une URL partagée.
 */
export function urlSansJeton(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  return url.pathname + url.search;
}

/** Vrai si l'URL porte encore un paramètre de jeton. */
export function urlPorteUnJeton(href: string): boolean {
  const url = new URL(href);
  return url.searchParams.has("token_hash") || url.searchParams.has("type");
}
