import { SectionLabel } from "@/components/ui/SectionLabel";
import { TransformationsMarquee } from "@/components/sections/TransformationsMarquee";
import { transformationPhotos } from "@/data/transformationPhotos";

/**
 * Section home page "Transformations" (chantier pages publiques, juillet
 * 2026, témoignages ajoutés le 20/07/2026) — bandeau auto-défilant des 15
 * vraies photos avant/après avec témoignage rédigé par Jules pour chacune
 * (voir data/transformationPhotos.ts). Aucun contenu inventé.
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
          Les résultats d&apos;une partie de mes élèves qui ont suivi la
          méthode.
        </p>
      </div>

      <div className="mx-auto max-w-7xl px-6">
        <TransformationsMarquee
          transformations={transformationPhotos}
          durationSeconds={Math.max(60, transformationPhotos.length * 9)}
        />
      </div>
    </section>
  );
}
