"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Le viewport peut-il accueillir la scène ancrée des « 4 piliers » sans
 * rogner son contenu ?
 *
 * La scène immobilise le contenu dans une hauteur d'écran : elle n'est
 * tenable que si le titre et les 4 piliers y tiennent réellement. Deux cas,
 * mesurés sur le rendu réel (26/07/2026) :
 *
 *  - à partir de `lg` (1024px), la grille passe sur 4 colonnes et le contenu
 *    ne fait plus que ~485px de haut → 560px de hauteur d'écran suffisent ;
 *  - en dessous, les piliers s'empilent ; avec la densité compacte mobile le
 *    contenu fait ~645px → il faut ~700px de hauteur pour le poser sans le
 *    coller aux bords.
 *
 * Sous ces seuils (iPhone SE et assimilés), le composant retombe sur le
 * rendu en flux normal, entièrement lisible — jamais sur une scène qui
 * couperait le premier ou le dernier pilier.
 *
 * `useSyncExternalStore` plutôt qu'un `useState` + `useEffect` : le serveur
 * ne connaît pas la taille de l'écran, donc son instantané vaut toujours
 * `false` (rendu en flux, lisible sans JavaScript). React sait que
 * l'instantané client peut différer et bascule après l'hydratation SANS
 * déclencher d'erreur « Hydration failed » — ce qu'un simple état initialisé
 * depuis `matchMedia` provoquait.
 */
const PINNED_SCENE_QUERY = "(min-width: 1024px) and (min-height: 560px), (min-height: 700px)";

function getServerSnapshot(): boolean {
  return false;
}

export function usePinnedSceneViewport(): boolean {
  const subscribe = useCallback((onChange: () => void) => {
    const query = window.matchMedia(PINNED_SCENE_QUERY);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const getSnapshot = useCallback(() => window.matchMedia(PINNED_SCENE_QUERY).matches, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
