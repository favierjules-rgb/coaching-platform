"use client";

import { useEffect, useState } from "react";

/**
 * `prefers-reduced-motion: reduce`, réactif aux changements en direct.
 *
 * Valeur initiale calculée par lazy initializer (au rendu, pas dans un
 * effet) : évite un setState synchrone en effet et un flash de contenu
 * animé avant la première mise à jour. Garde `typeof window` : composants
 * "use client" toujours rendus côté serveur une première fois par le App
 * Router, avant hydratation.
 *
 * Extrait pour être partagé entre `MethodStorytelling` et `SethStarsIntro`
 * (chantier storytelling scroll « 4 piliers SETH », juillet 2026).
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
