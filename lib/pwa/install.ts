/**
 * INSTALLATION DE L'APPLICATION — la partie qu'on peut prouver.
 *
 * Ce module ne touche à rien : pas de `window`, pas d'écouteur, pas de
 * rendu. Il répond à une seule question, à partir de valeurs qu'on lui
 * passe : « qu'est-ce qu'on propose à CET utilisateur ? ». C'est ce qui
 * permet de le vérifier dans Node sur de vraies chaînes de navigateur, au
 * lieu de croire sur parole une cascade de `if` enfouie dans un composant.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI IL FAUT DISTINGUER LES CAS
 * ────────────────────────────────────────────────────────────────────────
 * Il n'existe pas de « bouton installer » universel. Chrome (Android,
 * bureau) émet `beforeinstallprompt`, qu'on capte pour ouvrir la vraie
 * boîte de dialogue système. Safari sur iOS n'émet RIEN — la documentation
 * Next.js le dit noir sur blanc — et n'expose aucune API : l'installation
 * passe obligatoirement par « Partager → Sur l'écran d'accueil », à la
 * main. Afficher un bouton mort à un élève sur iPhone serait le pire des
 * deux mondes : il cliquerait, rien ne se passerait, et il conclurait que
 * ça ne marche pas.
 *
 * Pire encore sur iOS : Chrome, Firefox et Edge y sont des habillages de
 * WebKit et ne savent PAS ajouter à l'écran d'accueil. Leur donner les
 * instructions de Safari les enverrait chercher un menu qui n'existe pas.
 */

/** Ce qu'on peut réellement proposer à cet utilisateur, ici et maintenant. */
export type CanalInstallation =
  /** Déjà lancée depuis l'écran d'accueil : il n'y a plus rien à installer. */
  | "deja-installee"
  /** Le navigateur nous a confié son invite : un vrai bouton. */
  | "invite-native"
  /** iOS + Safari : instructions « Partager → Sur l'écran d'accueil ». */
  | "ios-safari"
  /** iOS + un autre navigateur : seul Safari sait installer. */
  | "ios-autre-navigateur"
  /** Tout le reste : le menu du navigateur, sans promettre où il se trouve. */
  | "manuel";

export interface ContexteInstallation {
  userAgent: string;
  /**
   * `navigator.maxTouchPoints`. Indispensable : depuis iPadOS 13, un iPad se
   * déclare « Macintosh » dans son user agent. Sans ce chiffre, un iPad est
   * indiscernable d'un Mac — et recevrait des instructions de bureau
   * inutilisables.
   */
  maxTouchPoints: number;
  /** `display-mode: standalone`, ou `navigator.standalone` sur iOS. */
  affichageApplication: boolean;
  /** Un événement `beforeinstallprompt` a été capté et n'a pas encore servi. */
  inviteNativeDisponible: boolean;
}

/** iPhone, iPad ou iPod — iPadOS 13+ compris. */
export function estIOS(userAgent: string, maxTouchPoints: number): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) {
    return true;
  }
  // iPadOS 13+ en mode « site pour ordinateur » (le défaut) : user agent de
  // Mac. Un vrai Mac ne rapporte aucun point de contact, même avec un
  // trackpad — c'est ce qui les sépare.
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/**
 * Sur iOS, tous les navigateurs affichent du WebKit, mais un seul sait
 * ajouter à l'écran d'accueil : Safari. Les autres se signalent par un
 * jeton bien à eux dans leur user agent.
 */
export function estSafariIOS(userAgent: string): boolean {
  return !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo|GSA/i.test(userAgent);
}

export function detecterCanalInstallation(contexte: ContexteInstallation): CanalInstallation {
  // Testé EN PREMIER, avant toute question de plateforme : une application
  // déjà ouverte depuis l'écran d'accueil n'a rien à proposer, quel que soit
  // le téléphone.
  if (contexte.affichageApplication) {
    return "deja-installee";
  }

  // L'invite native passe avant la détection de plateforme : quand le
  // navigateur nous donne sa boîte de dialogue, elle est toujours meilleure
  // que n'importe quelle explication qu'on pourrait écrire.
  if (contexte.inviteNativeDisponible) {
    return "invite-native";
  }

  if (estIOS(contexte.userAgent, contexte.maxTouchPoints)) {
    return estSafariIOS(contexte.userAgent) ? "ios-safari" : "ios-autre-navigateur";
  }

  return "manuel";
}
