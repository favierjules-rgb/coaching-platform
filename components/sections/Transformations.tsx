import { SectionLabel } from "@/components/ui/SectionLabel";
import { TransformationsMarquee } from "@/components/sections/TransformationsMarquee";
import { transformationPhotos } from "@/data/transformationPhotos";

/**
 * Section home page "Transformations" (chantier pages publiques, juillet
 * 2026) — remplace l'ancienne grille statique à 4 témoignages fictifs par
 * un bandeau auto-défilant des 13 vraies photos avant/après (voir
 * data/transformationPhotos.ts). Volontairement image + prénom + poids
 * uniquement : les témoignages écrits (citation/durée/objectif, type
 * `Transformation` dans types/index.ts) sont réservés à une autre partie du
 * site, dans un chantier séparé — aucun contenu inventé ici.
 */
export function Transformations() {
  return (
    <section id="transformations" className="scroll-mt-24 overflow-hidden bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Résultats réels</SectionLabel>
        <h2 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          Transformations
        </h2>
        <p className="mb-16 max-w-xl text-muted-foreground">
          Avant / Après. Des vrais résultats, des vrais élèves. Aucune
          retouche.
        </p>
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <TransformationsMarquee
          transformations={transformationPhotos}
          durationSeconds={Math.max(40, transformationPhotos.length * 6)}
        />
      </div>
    </section>
  );
}
