"use client";

import { useEffect } from "react";

import { demarrerCaptureInstallation } from "@/lib/pwa/invite-installation";

/**
 * ENREGISTREMENT DU SERVICE WORKER.
 *
 * Monté une fois dans le layout racine. Il ne rend rien : son seul rôle est
 * de déclarer `/sw.js` au navigateur.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI À LA RACINE, ET PAS DANS L'ESPACE ÉLÈVE
 * ────────────────────────────────────────────────────────────────────────
 * Un navigateur ne propose l'installation que si un service worker est
 * DÉJÀ actif au moment où l'utilisateur est sur la page. Le bouton
 * d'installation vit sur /profil ; si l'enregistrement n'avait lieu que là,
 * le bouton serait inerte à la première visite et fonctionnel à la seconde.
 *
 * ────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS EN DÉVELOPPEMENT
 * ────────────────────────────────────────────────────────────────────────
 * `/_next/static/` ne porte d'empreinte de contenu qu'après un build : en
 * développement, les mêmes URL servent un contenu qui change à chaque
 * sauvegarde. Le service worker les mettrait en cache pour toujours et
 * servirait du code mort — on croirait à un bogue du code, ce serait un
 * bogue du cache. Pour l'essayer en local : `npm run build && npm start`.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    // AVANT le garde-fou de production : la capture de `beforeinstallprompt`
    // n'a rien à voir avec le cache, et l'événement arrive tôt, sur la
    // première page chargée — jamais sur /profil, où l'élève arrive par une
    // navigation interne. Attendre d'être sur le profil pour écouter, ce
    // serait n'entendre jamais rien.
    demarrerCaptureInstallation();

    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker
      // `updateViaCache: "none"` : le fichier `/sw.js` lui-même n'est jamais
      // relu depuis le cache HTTP. Sans cela, un service worker corrigé
      // pourrait rester ignoré pendant 24 h — et un service worker fautif
      // est précisément ce qu'on veut pouvoir remplacer vite.
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((erreur: unknown) => {
        // Un échec d'enregistrement ne casse rien : le site fonctionne sans.
        // Mais il doit se voir, sinon on chercherait longtemps pourquoi
        // l'installation n'est jamais proposée.
        console.warn("[PWA] Service worker non enregistré :", erreur);
      });
  }, []);

  return null;
}
