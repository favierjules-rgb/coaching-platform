"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  activerNotifications,
  lireStatutServeur,
  messageActivation,
  type AbonnementNavigateur,
} from "@/lib/push/activation";
import {
  deciderEtatPush,
  type ConfirmationServeur,
  type EtatNotifications,
} from "@/lib/push/etat";

/**
 * L'ACTIVATION DES NOTIFICATIONS, VUE DE L'ÉLÈVE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * LA PERMISSION N'EST JAMAIS DEMANDÉE TOUTE SEULE
 * ════════════════════════════════════════════════════════════════════════
 * `Notification.requestPermission()` n'est appelé QUE depuis `activer()`,
 * c'est-à-dire depuis un clic. Une demande spontanée au chargement est
 * refusée d'office par Safari, et — plus grave — un refus est DÉFINITIF :
 * l'élève devrait aller le rétablir dans les réglages iOS. On ne dépense
 * cette cartouche que lorsqu'il l'a demandée.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE HOOK NE DÉCIDE PLUS RIEN LUI-MÊME
 * ════════════════════════════════════════════════════════════════════════
 * Il COLLECTE quatre faits — support, permission, abonnement local, et ce que
 * le serveur en dit — puis applique `deciderEtatPush`. Le parcours
 * d'activation, lui, est orchestré par `activerNotifications`. Les deux sont
 * des fonctions pures ou à dépendances injectées, donc exécutables sans
 * navigateur : voir `scripts/tests/profil-rappel-push.mts`. Tant que cette
 * logique vivait dans les effets, elle n'était vérifiable que par Playwright,
 * et sa table de vérité ne l'était nulle part.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ LE SERVEUR EST INTERROGÉ, ET C'EST LE CŒUR DU CORRECTIF
 * ════════════════════════════════════════════════════════════════════════
 * Avant, `active` se déduisait de la seule présence d'un `PushSubscription`
 * dans le navigateur. Ce fait est LOCAL. Il diverge du serveur dès qu'un
 * envoi a reçu 404/410 (`desactiverAbonnement` pose `disabled_at`), qu'un
 * abonnement a été renouvelé par le service push, ou que la clé VAPID a
 * changé au déploiement. Le profil affichait alors « activé » pendant que
 * plus rien n'arrivait. `/api/push/status` tranche désormais.
 */

export type { EtatNotifications } from "@/lib/push/etat";

export interface ResultatNotifications {
  etat: EtatNotifications;
  message: string | null;
  /** Une écriture est en cours : empêche le double clic. */
  enCours: boolean;
  activer: () => Promise<void>;
  desactiver: () => Promise<void>;
  /** Relit les quatre faits — au retour sur le profil, après activation. */
  revalider: () => Promise<void>;
}

/** base64url → Uint8Array, ce qu'attend `applicationServerKey`. */
function versOctets(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const brut = atob(base64);
  // `ArrayBuffer` explicite : `applicationServerKey` refuse une vue dont le
  // tampon pourrait être partagé (`SharedArrayBuffer`).
  const octets = new Uint8Array(new ArrayBuffer(brut.length));
  for (let i = 0; i < brut.length; i += 1) {
    octets[i] = brut.charCodeAt(i);
  }
  return octets;
}

/**
 * Assez long pour qu'un enregistrement normal (premier chargement de la
 * PWA) arrive largement avant, assez court pour qu'un élève ne reste pas
 * devant un bloc absent. Dépassé, l'état est provisoire : il est corrigé
 * dès que `ready` répond.
 */
const DELAI_ENREGISTREMENT_MS = 3000;

/**
 * L'interrogation du serveur a son propre plafond, plus court.
 *
 * ⚠️ ELLE NE DOIT PAS RETENIR LE VERDICT LOCAL. Si le serveur ne répond pas,
 * on conclut `inconnu` et l'état reste celui du navigateur : un réseau lent
 * ne doit pas laisser le bloc Notifications invisible.
 */
const DELAI_STATUT_MS = 4000;

function supporte(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * Demande au serveur ce qu'il sait de CET endpoint.
 *
 * Rend toujours une valeur : `inconnu` couvre réseau coupé, 503, 401 et
 * réponse illisible. Jamais d'exception, jamais de verdict inventé.
 */
async function interrogerServeur(endpoint: string): Promise<ConfirmationServeur> {
  const abandon = new AbortController();
  const minuteur = setTimeout(() => abandon.abort(), DELAI_STATUT_MS);
  try {
    const reponse = await fetch("/api/push/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ endpoint }),
      signal: abandon.signal,
    });
    if (!reponse.ok) {
      return "inconnu";
    }
    return lireStatutServeur(await reponse.json());
  } catch {
    return "inconnu";
  } finally {
    clearTimeout(minuteur);
  }
}

export function useNotificationsPush(): ResultatNotifications {
  const [etat, setEtat] = useState<EtatNotifications>("chargement");
  const [message, setMessage] = useState<string | null>(null);
  const [enCours, setEnCours] = useState(false);
  /** Vrai entre le montage et le démontage : aucune écriture d'état après. */
  const monte = useRef(true);
  /** Empêche deux parcours d'activation simultanés (double clic, double tap). */
  const enVol = useRef(false);

  /**
   * COLLECTE LES QUATRE FAITS, PUIS APPLIQUE LA DÉCISION.
   *
   * ⚠️ `navigator.serviceWorker.ready` PEUT NE JAMAIS SE RÉSOUDRE.
   *
   * Ce n'est pas une hypothèse : tant qu'aucun service worker n'est
   * enregistré et actif pour cette portée — Safari hors PWA installée,
   * `next dev`, un enregistrement qui a échoué — la promesse reste en attente
   * indéfiniment. Elle ne rejette pas. Elle ne s'arme d'aucun délai. Il
   * n'existe aucun moyen de l'annuler. L'appelant borne donc l'attente.
   */
  const collecter = useCallback(async (): Promise<EtatNotifications> => {
    if (!supporte()) {
      return "non_supporte";
    }
    if (Notification.permission === "denied") {
      return "refuse";
    }
    const enregistrement = await navigator.serviceWorker.ready;
    const abonnement = await enregistrement.pushManager.getSubscription();
    const serveur: ConfirmationServeur = abonnement
      ? await interrogerServeur(abonnement.endpoint)
      : "absent";
    return deciderEtatPush({
      supporte: true,
      permission: Notification.permission,
      abonnementPresent: Boolean(abonnement),
      serveur,
    });
  }, []);

  /**
   * Relit tout. Appelée au montage, au retour sur l'onglet, et après une
   * activation — c'est elle qui garde le rappel et le bloc « Notifications »
   * sur le même état, puisqu'ils partagent cette instance de hook.
   */
  const revalider = useCallback(async () => {
    try {
      const prochain = await collecter();
      if (monte.current) setEtat(prochain);
    } catch {
      if (monte.current) setEtat("erreur");
    }
  }, [collecter]);

  useEffect(() => {
    monte.current = true;
    let tranche = false;

    // …et on CORRIGE si l'enregistrement finit par arriver : un délai
    // dépassé décrit une lenteur, pas un verdict.
    const minuteur = setTimeout(() => {
      if (monte.current && !tranche) setEtat("non_supporte");
    }, DELAI_ENREGISTREMENT_MS);

    void (async () => {
      try {
        const prochain = await collecter();
        tranche = true;
        clearTimeout(minuteur);
        if (monte.current) setEtat(prochain);
      } catch {
        tranche = true;
        clearTimeout(minuteur);
        if (monte.current) setEtat("erreur");
      }
    })();

    /**
     * RELECTURE AU RETOUR SUR L'ONGLET.
     *
     * ⚠️ C'EST CE QUI DÉTECTE LA PERTE « APRÈS UNE MISE À JOUR » SANS
     * RECHARGEMENT. Un service worker remplacé, un abonnement renouvelé ou
     * une ligne désactivée pendant que l'onglet dormait se voient au retour.
     * `visibilitychange` seulement : pas de sondage périodique, pas de
     * requête quand l'onglet n'est pas regardé.
     */
    function auRetour() {
      if (document.visibilityState === "visible") void revalider();
    }
    document.addEventListener("visibilitychange", auRetour);

    return () => {
      monte.current = false;
      clearTimeout(minuteur);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [collecter, revalider]);

  const activer = useCallback(async () => {
    // ⚠️ VERROU SYNCHRONE, PAS UN ÉTAT REACT. Deux clics rapides arrivent
    // avant le prochain rendu : un `if (enCours) return` sur l'état laisserait
    // passer le second, et deux `subscribe()` concurrents créeraient deux
    // abonnements.
    if (enVol.current) return;
    enVol.current = true;
    setMessage(null);
    setEnCours(true);

    try {
      const resultat = await activerNotifications({
        permissionActuelle: () => (supporte() ? Notification.permission : "denied"),
        demanderPermission: () => Notification.requestPermission(),
        clePublique: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
        abonnementExistant: async () => {
          const enregistrement = await navigator.serviceWorker.ready;
          return (await enregistrement.pushManager.getSubscription()) as AbonnementNavigateur | null;
        },
        creerAbonnement: async (cle) => {
          const enregistrement = await navigator.serviceWorker.ready;
          return (await enregistrement.pushManager.subscribe({
            // Sans ce drapeau, aucun navigateur n'accepte l'abonnement : il
            // interdit les notifications silencieuses.
            userVisibleOnly: true,
            applicationServerKey: versOctets(cle),
          })) as unknown as AbonnementNavigateur;
        },
        enregistrerAuServeur: async (abonnement) => {
          const reponse = await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ subscription: abonnement.toJSON() }),
          });
          return reponse.ok;
        },
      });

      if (!monte.current) return;
      setMessage(messageActivation(resultat));

      if (resultat.issue === "active") {
        /*
         * ⚠️ ON NE POSE PAS `active` DE NOTRE PROPRE AUTORITÉ. On RELIT, donc
         * on repasse par `/api/push/status`. C'est la seule façon de ne pas
         * reproduire le défaut qu'on corrige : annoncer un succès que le
         * serveur n'a pas confirmé. `activerNotifications` a déjà exigé un
         * `response.ok` ; cette relecture le vérifie une seconde fois, et
         * synchronise du même coup le bloc « Notifications ».
         */
        await revalider();
        return;
      }
      if (resultat.issue === "refuse") {
        setEtat("refuse");
        return;
      }
      if (resultat.issue === "non_configure") {
        setEtat("erreur");
        return;
      }
      if (resultat.issue === "sans_reponse") {
        // Toujours pas de décision : l'état ne change pas, le message explique.
        return;
      }
      // `echec_serveur` et `echec_technique` : surtout ne rien affirmer.
      setEtat("erreur");
    } finally {
      enVol.current = false;
      if (monte.current) setEnCours(false);
    }
  }, [revalider]);

  const desactiver = useCallback(async () => {
    if (enVol.current) return;
    enVol.current = true;
    setMessage(null);
    setEnCours(true);
    try {
      const enregistrement = await navigator.serviceWorker.ready;
      const abonnement = await enregistrement.pushManager.getSubscription();
      if (abonnement) {
        // Serveur D'ABORD : si le désabonnement navigateur réussit et que
        // l'appel échoue, le serveur garderait un endpoint mort et l'élève
        // ne pourrait plus le retirer.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: abonnement.endpoint }),
        });
        await abonnement.unsubscribe();
      }
      if (monte.current) setEtat("inactif");
    } catch {
      if (monte.current) {
        setEtat("erreur");
        setMessage("La désactivation n'a pas abouti.");
      }
    } finally {
      enVol.current = false;
      if (monte.current) setEnCours(false);
    }
  }, []);

  return { etat, message, enCours, activer, desactiver, revalider };
}
