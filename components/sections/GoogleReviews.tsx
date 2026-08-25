import { Star } from "lucide-react";

import { GoogleReviewsStack } from "@/components/sections/GoogleReviewsStack";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { getReviews } from "@/lib/reviews/source";

/**
 * Section home page « Avis Google » (chantier avis Google, Phase A) — placée
 * entre `Transformations` (les résultats se voient) et `FreeAssessment` (le
 * premier pas). Le visiteur vient de voir des transformations réelles ; il lit
 * ici ce que les élèves en disent, avant qu'on lui propose quoi que ce soit.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ⚠️ PHASE A — LES AVIS AFFICHÉS SONT DES DONNÉES DE DÉMONSTRATION
 * ════════════════════════════════════════════════════════════════════════
 * L'accès à l'API Google Business Profile est en cours d'examen. En
 * attendant, `getReviews()` rend un jeu d'exemples (voir
 * `lib/reviews/google-reviews.mock.ts`) et pose `demonstration: true`.
 *
 * Tant que ce drapeau vaut `true`, la section affiche un BANDEAU VISIBLE
 * disant à l'écran que ces avis sont des exemples. Le jour où la Phase B
 * branche Google, le drapeau passe à `false` dans la source et le bandeau
 * disparaît tout seul — personne n'a à penser à le retirer, et il est donc
 * impossible de publier de faux témoignages en oubliant une étape.
 *
 * ════════════════════════════════════════════════════════════════════════
 * COMPOSANT SERVEUR, COMME SES VOISINES
 * ════════════════════════════════════════════════════════════════════════
 * Elle appelle la source et rend du HTML. L'interactivité — survol, tap,
 * clavier — vit dans `GoogleReviewsStack`, composant client, exactement comme
 * `Transformations → TransformationsMarquee` et
 * `FreeAssessment → FreeAssessmentForm`.
 *
 * ⚠️ ELLE NE SAIT PAS D'OÙ VIENNENT LES AVIS, et c'est tout l'intérêt : la
 * Phase B remplacera le corps de `getReviews()` sans qu'une ligne de ce
 * fichier ni de la pile ne change.
 *
 * ════════════════════════════════════════════════════════════════════════
 * ELLE DISPARAÎT PLUTÔT QUE DE MENTIR
 * ════════════════════════════════════════════════════════════════════════
 * Aucun avis publiable et la section ne rend RIEN. Pas d'état vide, pas de
 * « bientôt des avis », pas de squelette : `Transformations` et `Mon bilan
 * offert` se retrouvent simplement voisines, comme avant ce chantier. C'est
 * la même décision que `PublicPrograms`, qui rend `null` plutôt qu'un
 * catalogue vide.
 *
 * ⚠️ LE FILTRE 5 ÉTOILES N'EST PAS APPLIQUÉ ICI. Il l'est dans la source,
 * une seule fois, avant que quoi que ce soit voie les avis — voir
 * `lib/reviews/types.ts`, `estPubliable()`. Le rappliquer ici donnerait deux
 * endroits à maintenir, et l'un des deux finirait par diverger.
 */
export async function GoogleReviews() {
  const { reviews, demonstration, average, count } = await getReviews();
  if (reviews.length === 0) return null;

  return (
    <section
      id="avis-clients"
      className="scroll-mt-24 overflow-hidden bg-background pt-14 pb-20 md:pt-20 md:pb-24"
    >
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Preuve sociale</SectionLabel>
        <h2 className="mb-4 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          Avis Google
        </h2>
        <p className="mb-6 max-w-xl text-muted-foreground">Ils parlent de leur expérience.</p>

        {/*
          LA NOTE GLOBALE — celle des avis AFFICHÉS, et le libellé le dit.
          Ce n'est pas la note de la fiche Google, qui inclut les avis de
          moins de cinq étoiles : l'annoncer comme telle serait un chiffre
          faux. La Phase B lira la vraie moyenne chez Google.
        */}
        {average !== null ? (
          <p className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-heading text-2xl font-extrabold text-foreground">
              {average.toFixed(1).replace(".", ",")}
            </span>
            <span className="flex items-center gap-0.5" aria-label={`${average} étoiles sur 5`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} size={16} className="avis-etoile" aria-hidden="true" />
              ))}
            </span>
            <span className="text-sm text-muted-foreground">
              {count} avis affiché{count > 1 ? "s" : ""}
            </span>
          </p>
        ) : null}

        {/*
          ⚠️ LE BANDEAU DE DÉMONSTRATION. Il n'est pas décoratif : c'est ce
          qui empêche qu'un faux témoignage soit lu comme un vrai. Il
          disparaît automatiquement quand la source cesse d'être une
          démonstration.
        */}
        {demonstration ? (
          <p
            data-avis-demonstration
            role="note"
            className="mb-2 inline-flex flex-wrap items-center gap-2 border border-primary/50 px-3 py-2 text-[0.7rem] uppercase tracking-[0.16em] text-primary"
          >
            <span aria-hidden="true">●</span>
            Données de démonstration — ces avis sont des exemples, pas de vrais avis Google
          </p>
        ) : null}
      </div>

      {/*
        La pile déborde volontairement de la grille sur les grands écrans : les
        cartes s'inclinent et se décalent, et un conteneur trop serré les
        rognerait. `overflow-hidden` sur la <section> garantit qu'aucun
        débordement ne produit de barre de défilement horizontale sur la page.
      */}
      <div className="mx-auto max-w-7xl px-6">
        <GoogleReviewsStack avis={reviews} />
      </div>
    </section>
  );
}
