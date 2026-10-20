import type { ConfirmationServeur } from "@/lib/push/etat";

/**
 * LE PARCOURS D'ACTIVATION — ORCHESTRÉ ICI, DÉPENDANCES INJECTÉES.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI LES DÉPENDANCES SONT DES PARAMÈTRES
 * ════════════════════════════════════════════════════════════════════════
 * Ce parcours touche quatre surfaces de navigateur (`Notification`,
 * `serviceWorker`, `pushManager`, `fetch`) et une variable d'environnement.
 * Tant qu'il vivait dans un `useCallback`, la seule façon de l'exécuter était
 * de lancer un navigateur — ce que ce dépôt ne peut faire que pour une suite
 * Playwright. Les cinq cas qui comptent (permission `default`, `denied`,
 * abonnement manquant, serveur qui refuse, panne réseau) n'étaient donc
 * jamais joués.
 *
 * En les injectant, la SÉQUENCE devient exécutable telle quelle, et c'est la
 * séquence qui porte toutes les règles.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LES RÈGLES, DANS L'ORDRE OÙ ELLES S'APPLIQUENT
 * ════════════════════════════════════════════════════════════════════════
 * 1. LA PERMISSION NE SE DEMANDE QU'AU CLIC. Ce module n'est appelé que
 *    depuis un gestionnaire d'évènement ; il ne s'exécute jamais au montage.
 * 2. UN `denied` NE SE REDEMANDE JAMAIS. On sort avant toute demande : une
 *    boucle de demandes ne produit rien et grille la confiance.
 * 3. AUCUN SECOND ABONNEMENT. On réutilise `getSubscription()` si un
 *    abonnement existe ; `subscribe()` n'est appelé que s'il n'y en a aucun.
 * 4. LE SUCCÈS VIENT DU SERVEUR, PAS DU NAVIGATEUR. Tant que
 *    `/api/push/subscribe` n'a pas confirmé, rien n'est « activé ».
 * 5. AUCUN DÉTAIL TECHNIQUE NE REMONTE À L'ÉCRAN.
 */

/** Ce qu'un abonnement doit savoir faire, et rien de plus. */
export interface AbonnementNavigateur {
  readonly endpoint: string;
  toJSON: () => unknown;
}

export interface DependancesActivation {
  /** `Notification.permission` au moment du clic. */
  readonly permissionActuelle: () => NotificationPermission;
  /** `Notification.requestPermission()` — appelée AU PLUS une fois. */
  readonly demanderPermission: () => Promise<NotificationPermission>;
  /** La clé publique VAPID. `null` = serveur non configuré. */
  readonly clePublique: string | null;
  /** L'abonnement déjà présent, ou `null`. */
  readonly abonnementExistant: () => Promise<AbonnementNavigateur | null>;
  /** Crée un abonnement — appelée UNIQUEMENT s'il n'en existe aucun. */
  readonly creerAbonnement: (clePublique: string) => Promise<AbonnementNavigateur>;
  /** POST `/api/push/subscribe`. `true` = le serveur a confirmé. */
  readonly enregistrerAuServeur: (abonnement: AbonnementNavigateur) => Promise<boolean>;
}

export type ResultatActivation =
  | { readonly issue: "active"; readonly endpoint: string }
  /** Permission refusée maintenant, ou déjà refusée avant l'appel. */
  | { readonly issue: "refuse" }
  /** L'élève a fermé la demande sans répondre : on reste en `default`. */
  | { readonly issue: "sans_reponse" }
  | { readonly issue: "non_configure" }
  | { readonly issue: "echec_serveur" }
  | { readonly issue: "echec_technique" };

/**
 * Exécute le parcours. Rend TOUJOURS un résultat, ne lève jamais.
 *
 * ⚠️ `creerAbonnement` N'EST APPELÉE QUE SI `abonnementExistant()` REND
 * `null`. C'est ce qui garantit qu'on ne crée pas un second abonnement à côté
 * d'un abonnement valide — un appareil en aurait alors deux, le serveur
 * deux lignes, et l'élève deux notifications pour chaque rappel.
 */
export async function activerNotifications(
  deps: DependancesActivation,
): Promise<ResultatActivation> {
  // Règle 2 : un refus ne se rediscute pas, et surtout pas en boucle.
  if (deps.permissionActuelle() === "denied") {
    return { issue: "refuse" };
  }

  if (!deps.clePublique) {
    return { issue: "non_configure" };
  }

  try {
    // Règle 1 : la demande part d'ici, donc d'un clic — et une seule fois.
    let permission = deps.permissionActuelle();
    if (permission !== "granted") {
      permission = await deps.demanderPermission();
    }
    if (permission === "denied") {
      return { issue: "refuse" };
    }
    if (permission !== "granted") {
      // `default` : la demande a été fermée sans réponse. Rien n'est perdu,
      // rien n'est acquis — et surtout, on ne redemande pas tout de suite.
      return { issue: "sans_reponse" };
    }

    // Règle 3 : réutiliser avant de créer.
    const abonnement =
      (await deps.abonnementExistant()) ?? (await deps.creerAbonnement(deps.clePublique));

    // Règle 4 : c'est le serveur qui décide si c'est activé.
    const confirme = await deps.enregistrerAuServeur(abonnement);
    if (!confirme) {
      return { issue: "echec_serveur" };
    }
    return { issue: "active", endpoint: abonnement.endpoint };
  } catch {
    // Règle 5 : la cause réelle reste dans la console du navigateur.
    return { issue: "echec_technique" };
  }
}

/** Message affichable pour chaque issue qui n'est pas un succès. */
export function messageActivation(resultat: ResultatActivation): string | null {
  switch (resultat.issue) {
    case "active":
      return null;
    case "refuse":
      return "Les notifications sont bloquées pour ce site. Ouvre les réglages de ton navigateur pour les autoriser à nouveau.";
    case "sans_reponse":
      return "La demande d'autorisation a été fermée. Réessaie quand tu veux.";
    case "non_configure":
      return "Les notifications ne sont pas configurées sur ce serveur.";
    case "echec_serveur":
      return "Le serveur n'a pas pu enregistrer cet appareil. Les notifications ne sont pas encore actives.";
    case "echec_technique":
      return "L'activation n'a pas abouti. Vérifie ta connexion, puis réessaie.";
  }
}

/**
 * Interprète la réponse de `/api/push/status`.
 *
 * ⚠️ UNE RÉPONSE ILLISIBLE REND `inconnu`, PAS `absent`. Confondre les deux
 * ferait afficher « à réactiver » à chaque coupure réseau, et pousserait
 * l'élève à refaire une démarche dont il n'a pas besoin.
 */
export function lireStatutServeur(brut: unknown): ConfirmationServeur {
  if (!brut || typeof brut !== "object") return "inconnu";
  const objet = brut as { connu?: unknown; actif?: unknown };
  if (typeof objet.connu !== "boolean" || typeof objet.actif !== "boolean") return "inconnu";
  if (!objet.connu) return "absent";
  return objet.actif ? "actif" : "desactive";
}
