"use client";

import { PublicProgramCard } from "@/components/sections/PublicProgramCard";
import type { PublicProgramSummary } from "@/types";

/**
 * Bandeau auto-défilant (chantier module Programmation, étape 6, home page)
 * — la piste est dupliquée en deux exemplaires consécutifs et animée en
 * boucle (voir .public-programs-marquee-track dans app/globals.css) pour un
 * défilement continu, sans coupure visible au raccord, de la gauche vers la
 * droite. `durationSeconds` varie d'un bandeau à l'autre (voir
 * PublicPrograms.tsx) pour que les deux rangées ne défilent jamais à
 * l'identique.
 *
 * Avec un seul programme disponible, dupliquer la piste ferait apparaître
 * une simple copie côte à côte plutôt qu'un défilement — dans ce cas on
 * affiche la carte une seule fois, sans animation.
 */
export function PublicProgramsMarquee({
  programs,
  durationSeconds,
}: {
  programs: PublicProgramSummary[];
  durationSeconds: number;
}) {
  if (programs.length <= 1) {
    return (
      <div className="flex w-max gap-6">
        {programs.map((program) => (
          <PublicProgramCard key={program.id} program={program} />
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-hidden">
      <div
        className="public-programs-marquee-track flex w-max gap-6"
        style={{ animationDuration: `${durationSeconds}s` }}
      >
        {[...programs, ...programs].map((program, index) => (
          <PublicProgramCard key={`${program.id}-${index}`} program={program} />
        ))}
      </div>
    </div>
  );
}
