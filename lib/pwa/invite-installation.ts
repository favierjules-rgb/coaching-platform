import type { ContexteInstallation } from "@/lib/pwa/install";

/**
 * LE MAGASIN D'INSTALLATION — parce que l'événement arrive AVANT l'écran.
 *
 * ────────────────────────────────────────────────────────────────────────
 * LE PROBLÈME QUE CE FICHIER RÉSOUT
 * ────────────────────────────────────────────────────────────────────────
 * Chrome émet `beforeinstallprompt` UNE fois, tôt, sur la première page
 * chargée — le tableau de bord, en général. Le bouton d'installation, lui,
 * vit sur /profil, où l'élève arrive plus tard par une navigation interne
 * qui ne recharge rien. Un écouteur posé dans le composant du profil
 * arriverait donc systématiquement après la bataille : l'événement serait
 * déjà passé, aucun bouton ne s'afficherait jamais sur Android, et la seule
 * façon de s'en apercevoir serait d'essayer sur un vrai téléphone.
 *
 * La capture est donc démarrée depuis le layout racine
 * (`ServiceWorkerRegistrar`), c'est-à-dire dès la première page, et
 * l'événement attend ici que quelqu'un vienne le chercher.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI UN « MAGASIN EXTERNE » ET PAS UN useState
 * ────────────────────────────────────────────────────────────────────────
 * Ce qu'on observe (un événement du navigateur, un media query) vit en
 * dehors de React et existe avant lui. C'est exactement le cas d'usage de
 * `useSyncExternalStore` : React s'abonne, et le rendu serveur reçoit
 * `null` — il n'a aucun moyen de savoir sur quel appareil lit l'élève, et
 * inventer une réponse produirait une divergence d'hydratation.
 *
 * L'instantané n'est reconstruit QUE lorsqu'une valeur change réellement :
 * `useSyncExternalStore` compare les instantanés par référence et
 * boucherait à l'infini si on en fabriquait un neuf à chaque lecture.
 */

/**
 * `beforeinstallprompt` n'est pas un standard : il n'existe pas dans les
 * types du DOM, et seuls les navigateurs Chromium l'émettent. On décrit la
 * portion qu'on utilise plutôt que de forcer un `any`.
 */
export interface EvenementInviteInstallation extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface EtatInstallation {
  contexte: ContexteInstallation;
  /** L'invite native retenue, prête à être déclenchée. */
  invite: EvenementInviteInstallation | null;
  /** L'installation vient d'aboutir pendant cette visite. */
  venonsDInstaller: boolean;
}

let invite: EvenementInviteInstallation | null = null;
let venonsDInstaller = false;
let capteurDemarre = false;
let instantane: EtatInstallation | null = null;

const abonnes = new Set<() => void>();

/** Lancée depuis l'écran d'accueil ? Les deux façons de le savoir. */
function lireAffichageApplication(): boolean {
  // Standard, compris par Chrome/Edge/Firefox et Safari récent.
  if (window.matchMedia?.("(display-mode: standalone)").matches) {
    return true;
  }
  // Propriétaire Apple, seule source fiable sur les iOS plus anciens.
  return (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function reconstruireInstantane(): void {
  instantane = {
    contexte: {
      userAgent: window.navigator.userAgent,
      maxTouchPoints: window.navigator.maxTouchPoints ?? 0,
      affichageApplication: lireAffichageApplication(),
      inviteNativeDisponible: invite !== null,
    },
    invite,
    venonsDInstaller,
  };
}

function notifier(): void {
  reconstruireInstantane();
  for (const abonne of abonnes) {
    abonne();
  }
}

/**
 * Démarre l'écoute. Idempotent : appelé par le layout racine (au plus tôt)
 * ET par chaque abonnement, pour qu'un composant monté seul continue de
 * fonctionner.
 */
export function demarrerCaptureInstallation(): void {
  if (capteurDemarre || typeof window === "undefined") {
    return;
  }
  capteurDemarre = true;

  window.addEventListener("beforeinstallprompt", (evenement) => {
    // Sans ce `preventDefault`, Chrome affiche sa propre bannière en bas de
    // l'écran, au moment qu'il choisit. On garde l'invite pour la déclencher
    // depuis le profil, là où l'élève l'a demandée.
    evenement.preventDefault();
    invite = evenement as EvenementInviteInstallation;
    notifier();
  });

  window.addEventListener("appinstalled", () => {
    invite = null;
    venonsDInstaller = true;
    notifier();
  });

  // L'élève peut installer puis revenir : l'affichage passe de « onglet » à
  // « application » sans rechargement.
  //
  // `addEventListener` est optionnel à dessein : avant Safari 14, un
  // `MediaQueryList` n'en avait pas (seulement `addListener`, déprécié).
  // Cette fonction est appelée depuis le layout RACINE, sur chaque page —
  // une exception ici casserait le site entier pour un vieux navigateur,
  // et pour la seule fonctionnalité dont il n'a de toute façon pas besoin.
  const mediaApplication = window.matchMedia?.("(display-mode: standalone)");
  mediaApplication?.addEventListener?.("change", notifier);

  reconstruireInstantane();
}

export function souscrireInstallation(rappel: () => void): () => void {
  demarrerCaptureInstallation();
  abonnes.add(rappel);
  return () => {
    abonnes.delete(rappel);
  };
}

export function lireEtatInstallation(): EtatInstallation | null {
  if (typeof window === "undefined") {
    return null;
  }
  if (!instantane) {
    reconstruireInstantane();
  }
  return instantane;
}

/**
 * Instantané du rendu serveur. Constante figée : `useSyncExternalStore`
 * compare par référence, et une valeur neuve à chaque appel provoquerait
 * une boucle de rendu.
 */
export function lireEtatInstallationServeur(): EtatInstallation | null {
  return null;
}

/**
 * L'invite a servi. Une invite ne se rejoue pas : le navigateur en
 * réémettra une plus tard s'il le juge bon. On l'oublie donc dans les deux
 * cas — un bouton qui ne ferait plus rien au deuxième clic serait pire que
 * pas de bouton du tout.
 */
export function oublierInvite(installee: boolean): void {
  invite = null;
  if (installee) {
    venonsDInstaller = true;
  }
  notifier();
}
