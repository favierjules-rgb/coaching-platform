import { FreeAssessment } from "@/components/sections/FreeAssessment";
import { GoogleReviews } from "@/components/sections/GoogleReviews";
import { Hero } from "@/components/sections/Hero";
import { MethodStorytelling } from "@/components/sections/MethodStorytelling";
import { Newsletter } from "@/components/sections/Newsletter";
import { PersonalStory } from "@/components/sections/PersonalStory";
import { PublicPrograms } from "@/components/sections/PublicPrograms";
import { Transformations } from "@/components/sections/Transformations";
import { HomeThemeSwitch, homeThemeAntiFlashScript } from "@/components/home/HomeThemeSwitch";

export default function HomePage() {
  return (
    /*
     * Conteneur du thème de la home (chantier apple-refresh) : le choix
     * clair/sombre du visiteur vit sur CE div — jamais sur <html>, qui
     * appartient à ThemeProvider (admin/élève, clé localStorage distincte).
     * Le script bloquant est le PREMIER enfant : il applique le choix
     * mémorisé pendant le parsing, avant toute peinture du contenu — pas de
     * flash, pas d'erreur d'hydratation (`suppressHydrationWarning` couvre
     * l'attribut que le script peut avoir changé côté client).
     * Sombre par défaut : sans choix mémorisé, la page est identique à
     * ce qu'elle a toujours été.
     */
    <div id="accueil" data-home-theme="dark" suppressHydrationWarning>
      <script dangerouslySetInnerHTML={{ __html: homeThemeAntiFlashScript }} />
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
      {/* Les avis s'intercalent entre les résultats et le bilan : les
          transformations se voient, les avis se lisent — la preuve visuelle
          puis la preuve dite. ⚠️ PHASE A : les avis affichés sont des données
          de démonstration, et la section porte un bandeau qui le dit à
          l'écran (voir lib/reviews/source.ts). La section ne rend RIEN si
          aucun avis publiable n'existe, auquel cas cette ligne est invisible
          et l'ordre d'origine est intact. */}
      <GoogleReviews />
      {/* « Mon bilan offert » s'intercale entre la preuve sociale et les
          offres : le visiteur vient de voir des transformations réelles et de
          lire ce que les élèves en disent, c'est le moment où il se demande ce
          que ça donnerait pour lui. L'ordre Transformations → avis → bilan →
          programmes est intentionnel. */}
      <FreeAssessment />
      <PublicPrograms />
      <Newsletter />
      <PersonalStory />
      <HomeThemeSwitch />
    </div>
  );
}
