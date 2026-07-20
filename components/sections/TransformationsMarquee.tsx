"use client";

import { TransformationPhotoCard } from "@/components/sections/TransformationPhotoCard";
import type { TransformationPhoto } from "@/types";

/**
 * Bandeau auto-défilant des photos de transformation (chantier pages
 * publiques, juillet 2026) — même technique que PublicProgramsMarquee.tsx
 * (piste dupliquée en deux exemplaires, voir .transformations-marquee-track
 * dans app/globals.css) : défilement continu, sans coupure visible au
 * raccord, de la gauche vers la droite. Enveloppé dans .marquee-pausable
 * pour une pause au survol (souris uniquement, voir globals.css). Sur
 * prefers-reduced-motion, l'animation est coupée côté CSS et la piste reste
 * défilable manuellement (overflow-x-auto) : le contenu reste accessible,
 * seul le mouvement automatique disparaît.
 */
export function TransformationsMarquee({
  transformations,
  durationSeconds,
}: {
  transformations: TransformationPhoto[];
  durationSeconds: number;
}) {
  if (transformations.length <= 1) {
    return (
      <div className="flex w-max gap-6">
        {transformations.map((transformation) => (
          <TransformationPhotoCard key={transformation.id} transformation={transformation} />
        ))}
      </div>
    );
  }

  return (
    <div className="marquee-pausable overflow-x-auto overflow-y-hidden">
      <div
        className="transformations-marquee-track flex w-max gap-6"
        style={{ animationDuration: `${durationSeconds}s` }}
      >
        {[...transformations, ...transformations].map((transformation, index) => (
          <TransformationPhotoCard key={`${transformation.id}-${index}`} transformation={transformation} />
        ))}
      </div>
    </div>
  );
}
