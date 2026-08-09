"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/**
 * LA PAGE ÉLÈVE DIT SON URL AU SERVICE WORKER.
 *
 * Ne rend rien. Monté dans `app/(student)/layout.tsx`, donc présent sur
 * toutes les pages de l'espace élève, et sur aucune autre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE COMPOSANT EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * Le service worker mettait en cache la coquille des pages élève depuis son
 * gestionnaire de NAVIGATION. Sur un vrai téléphone, ce gestionnaire ne
 * s'exécute presque jamais :
 *
 *   • le tout premier document part avant que `register()` n'ait tourné —
 *     aucun service worker ne l'intercepte, et `clients.claim()` arrive
 *     trop tard pour cette requête-là ;
 *   • ensuite, le routeur de Next.js ne recharge plus le document : il va
 *     chercher la charge RSC en `fetch`, que le service worker laisse
 *     passer sans y toucher.
 *
 * Résultat observé le 09/08/2026 sur iPhone : après une session entière
 * passée dans l'application, le cache de coquilles était VIDE, et le
 * lancement en mode avion tombait sur « Pas de connexion ».
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI EST ENVOYÉ, ET CE QUI NE L'EST PAS
 * ════════════════════════════════════════════════════════════════════════
 * Uniquement l'URL de la page ouverte. Aucune donnée, aucun identifiant,
 * aucun jeton : le service worker refera lui-même la requête avec les
 * cookies de la session, et c'est le SERVEUR qui décidera si la réponse est
 * gardable. Une URL hors liste blanche ou d'une autre origine est ignorée.
 */
export function PreparationCoquille() {
  // Le routeur de Next.js ne remonte pas le layout entre deux pages : sans
  // cette dépendance, le message ne partirait qu'une fois, pour la première
  // page ouverte, et la séance ne serait jamais préparée.
  const chemin = usePathname();

  useEffect(() => {
    // Même garde que l'enregistrement : en développement, `/_next/static/`
    // ne porte pas d'empreinte de contenu et rien ne doit être mis en cache.
    if (process.env.NODE_ENV !== "production") {
      return;
    }
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    let annule = false;
    void (async () => {
      try {
        // `ready` attend qu'un service worker soit ACTIF pour cette portée —
        // y compris au tout premier lancement, où il vient d'être installé.
        const enregistrement = await navigator.serviceWorker.ready;
        if (annule || !enregistrement.active) {
          return;
        }
        enregistrement.active.postMessage({
          type: "coquille-eleve",
          url: window.location.href,
        });
      } catch {
        // Pas de service worker, ou portée indisponible : le site fonctionne
        // exactement comme avant. Rien à signaler à l'élève.
      }
    })();
    return () => {
      annule = true;
    };
  }, [chemin]);

  return null;
}
