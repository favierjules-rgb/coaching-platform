"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Compteur qui s'anime de 0 vers `target` la PREMIÈRE fois que l'élément
 * entre dans le viewport, puis ne rejoue jamais (chantier « Mon histoire »).
 *
 * Trois exigences dictent l'implémentation :
 *
 * 1. Pas de saut visuel. Le rendu serveur écrit directement la valeur finale
 *    dans le HTML — un visiteur sans JavaScript, un lecteur d'écran ou un
 *    moteur d'indexation voit « 103+ », jamais « 0+ ». Le passage à zéro qui
 *    précède l'animation est fait dans un effet de MISE EN PAGE, donc avant
 *    la première peinture : l'utilisateur ne voit pas le nombre clignoter.
 *
 * 2. Mouvement décéléré, jamais linéaire. La progression passe par une
 *    courbe ease-out cubique : le compteur part vite puis se pose sur sa
 *    valeur finale, ce qui se lit comme un aboutissement plutôt que comme un
 *    défilement mécanique (voir .agents/skills/review-animations/STANDARDS.md,
 *    « entering → ease-out, jamais ease-in »).
 *
 * 3. `prefers-reduced-motion` affiche la valeur finale immédiatement — pas
 *    d'animation dégradée ni de compteur figé à zéro.
 *
 * Le composant n'anime rien tant qu'il n'est pas visible : aucune animation
 * permanente, aucune boucle qui tourne en fond.
 */

/** `useLayoutEffect` côté client, `useEffect` côté serveur (évite l'avertissement SSR). */
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/** Décélération forte : rapide au départ, arrivée douce sur la valeur finale. */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function AnimatedCounter({
  target,
  suffix = "",
  durationMs = 1600,
  className,
}: {
  target: number;
  suffix?: string;
  durationMs?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(target);
  const [prêt, setPrêt] = useState(false);

  // Avant la première peinture côté client : on repart de zéro — mais
  // seulement si l'animation va réellement pouvoir se jouer. Si le visiteur
  // a demandé moins d'animations, ou si le navigateur ne sait pas détecter
  // l'entrée dans le viewport, on ne touche à rien : la valeur finale reste
  // affichée plutôt qu'un zéro qui ne bougerait jamais.
  useIsomorphicLayoutEffect(() => {
    const réduit = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (réduit || typeof IntersectionObserver === "undefined") return;
    setValue(0);
    setPrêt(true);
  }, []);

  useEffect(() => {
    if (!prêt) return;
    const el = ref.current;
    if (!el) return;

    let frame = 0;
    let début: number | null = null;

    function anime(horodatage: number) {
      if (début === null) début = horodatage;
      const progression = Math.min(1, (horodatage - début) / durationMs);
      setValue(Math.round(easeOutCubic(progression) * target));
      if (progression < 1) frame = requestAnimationFrame(anime);
    }

    const observateur = new IntersectionObserver(
      (entrées) => {
        for (const entrée of entrées) {
          if (!entrée.isIntersecting) continue;
          observateur.disconnect(); // une seule fois, jamais de rejeu
          frame = requestAnimationFrame(anime);
        }
      },
      { threshold: 0.4 },
    );

    observateur.observe(el);
    return () => {
      observateur.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [prêt, target, durationMs]);

  return (
    <span ref={ref} className={className}>
      {/* La valeur lue par les technologies d'assistance reste la valeur
          finale : le décompte est purement décoratif. */}
      <span aria-hidden="true">
        {value}
        {suffix}
      </span>
      <span className="sr-only">
        {target}
        {suffix}
      </span>
    </span>
  );
}
