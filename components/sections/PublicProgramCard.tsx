import Link from "next/link";

import { formatAmountCents } from "@/lib/stripe/status";
import type { PublicProgramSummary } from "@/types";

/**
 * Carte programme du catalogue public (chantier module Programmation, étape
 * 6) — home page (bandeaux auto-défilants) et bibliothèque /programmes.
 * Largeur fixe pour un rendu prévisible dans un bandeau horizontal comme
 * dans une grille classique.
 */
export function PublicProgramCard({ program }: { program: PublicProgramSummary }) {
  return (
    <Link
      href={`/programmes/${program.id}`}
      className="group flex w-72 flex-shrink-0 flex-col border border-border bg-zinc-950 transition-colors hover:border-primary"
    >
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900">
        {program.bannerUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- bucket Storage public, URL externe
          <img
            src={program.bannerUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Programme</span>
          </div>
        )}
        <span className="absolute right-3 top-3 border border-primary bg-black/80 px-2 py-1 text-xs font-bold uppercase tracking-wide text-primary">
          {program.priceCents ? formatAmountCents(program.priceCents, program.currency) : "Gratuit"}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-5">
        {program.level && (
          <span className="font-heading text-xs font-semibold uppercase tracking-wide text-primary">{program.level}</span>
        )}
        <h3 className="font-heading text-lg font-bold uppercase text-foreground">{program.name}</h3>
        {program.goal && <p className="line-clamp-2 text-sm text-muted-foreground">{program.goal}</p>}
        {program.durationWeeks > 0 && (
          <span className="mt-auto pt-2 text-xs uppercase tracking-widest text-muted-foreground">
            {program.durationWeeks} semaines
          </span>
        )}
      </div>
    </Link>
  );
}
