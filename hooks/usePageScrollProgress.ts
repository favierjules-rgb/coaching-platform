"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Progression de scroll normalisée (0 → 1) mesurée depuis le tout début
 * de la page (`window.scrollY`), PAS depuis la position d'un élément
 * précis. Sert à l'intro du storytelling scroll (étoiles superposées au
 * Hero, visibles dès le chargement, sans zone morte à scroller avant de
 * les voir) — à la différence de `useSectionScrollProgress`, qui mesure
 * la traversée d'un élément plus bas dans la page (scènes suivantes,
 * Groupes 2+).
 *
 * `heightMultiplier` : distance de scroll nécessaire pour atteindre 1,
 * en multiples de `window.innerHeight` (ex. 1.6 → 1.6x la hauteur du
 * viewport). Un seul écouteur scroll + resize, passifs, regroupés
 * derrière un unique `requestAnimationFrame`, cleanup complet.
 */
export function usePageScrollProgress(heightMultiplier: number) {
  const [progress, setProgress] = useState(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const compute = () => {
      rafId.current = null;
      const threshold = window.innerHeight * heightMultiplier;
      const raw = threshold > 0 ? window.scrollY / threshold : 0;
      setProgress(Math.min(1, Math.max(0, raw)));
    };

    const onScrollOrResize = () => {
      if (rafId.current !== null) return;
      rafId.current = requestAnimationFrame(compute);
    };

    compute();
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize, { passive: true });

    return () => {
      window.removeEventListener("scroll", onScrollOrResize);
      window.removeEventListener("resize", onScrollOrResize);
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
      }
    };
  }, [heightMultiplier]);

  return progress;
}
