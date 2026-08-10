"use client";

import { useCallback, useEffect, useState } from "react";

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
 * CINQ ÉTATS, PARCE QU'ILS APPELLENT CINQ RÉPONSES
 * ════════════════════════════════════════════════════════════════════════
 *   non_supporte  navigateur sans Push, ou iOS hors PWA installée
 *   inactif       supporté, jamais demandé
 *   active        abonné, cet appareil recevra
 *   refuse        l'utilisateur a dit non — seul iOS peut revenir dessus
 *   erreur        le reste : réseau, serveur, clé absente
 */

export type EtatNotifications = "chargement" | "non_supporte" | "inactif" | "active" | "refuse" | "erreur";

export interface ResultatNotifications {
  etat: EtatNotifications;
  message: string | null;
  activer: () => Promise<void>;
  desactiver: () => Promise<void>;
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

function supporte(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function useNotificationsPush(): ResultatNotifications {
  const [etat, setEtat] = useState<EtatNotifications>("chargement");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    void (async () => {
      if (!supporte()) {
        if (!annule) setEtat("non_supporte");
        return;
      }
      if (Notification.permission === "denied") {
        if (!annule) setEtat("refuse");
        return;
      }
      try {
        const enregistrement = await navigator.serviceWorker.ready;
        const abonnement = await enregistrement.pushManager.getSubscription();
        if (!annule) setEtat(abonnement ? "active" : "inactif");
      } catch {
        if (!annule) setEtat("erreur");
      }
    })();
    return () => {
      annule = true;
    };
  }, []);

  const activer = useCallback(async () => {
    setMessage(null);
    const cle = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!cle) {
      setEtat("erreur");
      setMessage("Les notifications ne sont pas configurées sur ce serveur.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setEtat(permission === "denied" ? "refuse" : "inactif");
        return;
      }
      const enregistrement = await navigator.serviceWorker.ready;
      const abonnement =
        (await enregistrement.pushManager.getSubscription()) ??
        (await enregistrement.pushManager.subscribe({
          // Sans ce drapeau, aucun navigateur n'accepte l'abonnement : il
          // interdit les notifications silencieuses.
          userVisibleOnly: true,
          applicationServerKey: versOctets(cle),
        }));

      const reponse = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subscription: abonnement.toJSON() }),
      });
      if (!reponse.ok) {
        setEtat("erreur");
        setMessage("Le serveur n'a pas pu enregistrer cet appareil.");
        return;
      }
      setEtat("active");
    } catch {
      setEtat("erreur");
      setMessage("L'activation n'a pas abouti. Réessaie dans un instant.");
    }
  }, []);

  const desactiver = useCallback(async () => {
    setMessage(null);
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
      setEtat("inactif");
    } catch {
      setEtat("erreur");
      setMessage("La désactivation n'a pas abouti.");
    }
  }, []);

  return { etat, message, activer, desactiver };
}
