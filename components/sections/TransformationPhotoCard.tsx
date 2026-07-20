import Image from "next/image";

import type { TransformationPhoto } from "@/types";

/**
 * Carte photo avant/après (chantier pages publiques, section
 * Transformations, juillet 2026 — témoignages ajoutés le 20/07/2026) —
 * collage avant/après réel (image complète, pas de recadrage) + prénom +
 * poids + témoignage rédigé par Jules. Largeur élargie par rapport à la
 * version initiale (w-44/w-52) pour laisser respirer le témoignage ; ratio
 * 4/5 = ratio natif des collages sources (voir data/transformationPhotos.ts),
 * plus besoin de recadrer.
 */
export function TransformationPhotoCard({ transformation }: { transformation: TransformationPhoto }) {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col gap-3 sm:w-80">
      <div className="relative aspect-[4/5] w-full overflow-hidden border border-border bg-zinc-950">
        <Image
          src={transformation.image}
          alt={transformation.alt}
          fill
          sizes="(min-width: 640px) 320px, 288px"
          className="object-cover"
        />
      </div>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium text-foreground">{transformation.name}</span>
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {transformation.weightBefore} <span aria-hidden="true">→</span> {transformation.weightAfter}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-gray-400">{transformation.quote}</p>
    </div>
  );
}
