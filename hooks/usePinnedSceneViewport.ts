"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Le viewport peut-il accueillir la scène ancrée des « 4 piliers » sans
 * rogner son contenu ?
 *
 * ---------------------------------------------------------------------
 * Ce que ce hook décide — et ce qu'il ne décide plus
 * ---------------------------------------------------------------------
 * Il arbitre UNIQUEMENT la mise en page : contenu immobilisé dans une
 * hauteur d'écran, ou contenu en flux normal. Il ne conditionne plus
 * l'animation elle-même.
 *
 * Jusqu'au 29/07/2026 il le faisait, et le seuil `(min-height: 700px)`
 * tombait pile entre la hauteur réellement visible d'un iPhone 14 sous
 * Safari (~664px, barres du navigateur comprises) et celle d'un grand
 * iPhone (~740-776px) : le premier n'avait plus aucune animation, le
 * second l'avait. Deux appareils, deux rendus, sans qu'aucune règle ne
 * vise explicitement un modèle. Les étoiles s'écartent désormais dans les
 * deux variantes — voir `components/sections/MethodStorytelling.tsx`.
 *
 * Les seuils ci-dessous décrivent donc une contrainte de PLACE, mesurée
 * sur le contenu réel, jamais une classe d'appareil.
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
 * Le palier en largeur n'est pas un « breakpoint mobile » : il traduit le
 * fait qu'à partir de `lg` la grille passe sur 4 colonnes, donc que le
 * même contenu occupe beaucoup moins de hauteur.
 *
 * Sous ces seuils, le composant retombe sur le rendu en flux normal,
 * entièrement lisible — jamais sur une scène qui couperait le premier ou
 * le dernier pilier.
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
