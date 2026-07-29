"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Progression de scroll normalisée (0 → 1) sur la traversée d'une section.
 *
 * Deux façons de mesurer, selon ce que l'élément est :
 *
 * `"pinned"` (défaut, comportement historique) — pour une piste de scène
 * ancrée, plus haute que le viewport. 0 = le haut de l'élément atteint le
 * haut du viewport (la scène sticky vient de s'accrocher). 1 = le bas de
 * l'élément atteint le bas du viewport (la scène se libère et le flux
 * normal reprend).
 *
 * `"traversal"` — pour un élément plus PETIT que le viewport, qui le
 * traverse simplement. 0 = son haut affleure le bas de l'écran (il entre),
 * 1 = son bas franchit le haut de l'écran (il est sorti). Sans cela, un
 * bloc court mesuré en mode `"pinned"` verrait `total <= 0` et sa
 * progression deviendrait binaire : le geste sauterait de 0 à 1 au lieu de
 * se dérouler. C'est le mode du repli en flux de « 4 piliers », où le
 * motif tient dans une bande de quelques centaines de pixels.
 *
 * Un seul écouteur `scroll` (passif) + un seul écouteur `resize` (passif),
 * tous deux regroupés derrière un unique `requestAnimationFrame` pour
 * éviter les recalculs multiples par frame. Cleanup complet au démontage.
 *
 * Chantier storytelling scroll « 4 piliers SETH » (juillet 2026).
 */
export function useSectionScrollProgress<T extends HTMLElement>(
  mode: "pinned" | "traversal" = "pinned",
) {
  const ref = useRef<T | null>(null);
  const [progress, setProgress] = useState(0);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const compute = () => {
      rafId.current = null;
      const rect = node.getBoundingClientRect();
      const viewportHeight = window.innerHeight;

      if (mode === "traversal") {
        // De « le haut entre par le bas de l'écran » à « le bas sort par le
        // haut ». Toujours strictement positif, donc jamais de progression
        // binaire, quelle que soit la hauteur de l'élément.
        const total = rect.height + viewportHeight;
        setProgress(Math.min(1, Math.max(0, (viewportHeight - rect.top) / total)));
        return;
      }

      const total = rect.height - viewportHeight;

      if (total <= 0) {
        // Section plus courte que le viewport : pas de portion "sticky"
        // réelle, on considère la progression comme binaire.
        setProgress(rect.top <= 0 ? 1 : 0);
        return;
      }

      const raw = -rect.top / total;
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
  }, [mode]);

  return { ref, progress };
}
