"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Progression de scroll normalisée (0 → 1) sur la traversée d'une section.
 *
 * 0 = le haut de l'élément atteint le haut du viewport (la scène sticky
 * vient de s'accrocher). 1 = le bas de l'élément atteint le bas du
 * viewport (la scène est sur le point de se libérer et le flux normal de
 * la page reprend).
 *
 * Un seul écouteur `scroll` (passif) + un seul écouteur `resize` (passif),
 * tous deux regroupés derrière un unique `requestAnimationFrame` pour
 * éviter les recalculs multiples par frame. Cleanup complet au démontage.
 *
 * Chantier storytelling scroll « 4 piliers SETH » (juillet 2026).
 */
export function useSectionScrollProgress<T extends HTMLElement>() {
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
  }, []);

  return { ref, progress };
}
