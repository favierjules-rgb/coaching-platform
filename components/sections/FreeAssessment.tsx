import { FreeAssessmentForm } from "@/components/sections/FreeAssessmentForm";
import { SectionLabel } from "@/components/ui/SectionLabel";

/**
 * Section home page « Mon bilan offert » (juillet 2026) — placée entre
 * `Transformations` (les résultats donnent envie) et `PublicPrograms` (les
 * offres), c'est-à-dire au moment exact où le visiteur se demande « et pour
 * moi, ça donnerait quoi ? ».
 *
 * Le questionnaire progressif vit dans `FreeAssessmentForm` (composant
 * client) ; cette section reste un composant serveur, comme ses voisines.
 * Mise en page reprise de `Transformations`/`PublicPrograms` : même fond
 * noir, même `SectionLabel`, même échelle de titre — aucune identité
 * visuelle propre qui détonnerait dans la page.
 *
 * Ancre stable `#bilan-offert` pour de futurs appels à l'action.
 */
export function FreeAssessment() {
  return (
    <section id="bilan-offert" className="scroll-mt-24 bg-black py-24">
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Premier échange</SectionLabel>
        <h2 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          Mon bilan offert
        </h2>
        <p className="mb-4 max-w-xl text-muted-foreground">
          Réponds à quelques questions pour me permettre de comprendre ton objectif et les difficultés que tu
          rencontres. Je te recontacte personnellement afin d&apos;échanger sur ta situation et définir les
          prochaines étapes.
        </p>
        <p className="mb-16 max-w-xl text-sm text-muted-foreground">
          Ce premier échange est sans engagement.
        </p>

        <div className="max-w-3xl">
          <FreeAssessmentForm />
        </div>
      </div>
    </section>
  );
}
