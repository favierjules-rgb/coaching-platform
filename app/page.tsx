import { FreeAssessment } from "@/components/sections/FreeAssessment";
import { Hero } from "@/components/sections/Hero";
import { MethodStorytelling } from "@/components/sections/MethodStorytelling";
import { Newsletter } from "@/components/sections/Newsletter";
import { PersonalStory } from "@/components/sections/PersonalStory";
import { PublicPrograms } from "@/components/sections/PublicPrograms";
import { Transformations } from "@/components/sections/Transformations";

export default function HomePage() {
  return (
    <>
      {/* Nouvelle direction (retour de Jules, 20/07/2026) : le Hero reste
          sans animation d'ouverture — visible immédiatement, comme avant ce
          chantier. Le rideau noir + étoiles au chargement (`SethStarsIntro`)
          est retiré de l'affichage ici. Fichier conservé tel quel (géométrie
          des étoiles, formule d'écart ±17.52vh/±18.64vh) : la nouvelle
          direction déplace l'animation plus bas dans la page — les étoiles
          s'écartent au scroll pour révéler les piliers, dans
          `MethodStorytelling` — et pourra réutiliser cette géométrie. */}
      <Hero />
      <MethodStorytelling />
      <Transformations />
      {/* « Mon bilan offert » s'intercale entre les résultats et les offres :
          le visiteur vient de voir des transformations réelles, c'est le
          moment où il se demande ce que ça donnerait pour lui. L'ordre
          Transformations → bilan → programmes est intentionnel. */}
      <FreeAssessment />
      <PublicPrograms />
      <Newsletter />
      <PersonalStory />
    </>
  );
}
