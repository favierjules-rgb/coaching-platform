import Image from "next/image";

import type { TransformationPhoto } from "@/types";

/**
 * Carte photo avant/après (chantier pages publiques, section
 * Transformations, juillet 2026) — image réelle + prénom + poids
 * avant/après uniquement (pas de citation, voir Transformations.tsx pour le
 * contexte). Largeur fixe pour un rendu prévisible dans le bandeau
 * horizontal, comme PublicProgramCard.
 */
export function TransformationPhotoCard({ transformation }: { transformation: TransformationPhoto }) {
  return (
    <div className="flex w-44 flex-shrink-0 flex-col gap-3 sm:w-52">
      <div className="relative aspect-[9/16] w-full overflow-hidden border border-border bg-zinc-950">
        <Image
          src={transformation.image}
          alt={transformation.alt}
          fill
          sizes="(min-width: 640px) 208px, 176px"
          className="object-cover"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{transformation.name}</span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {transformation.weightBefore} <span aria-hidden="true">→</span> {transformation.weightAfter}
        </span>
      </div>
    </div>
  );
}
