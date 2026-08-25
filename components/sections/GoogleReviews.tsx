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
 * ⚠️ LES AVIS SONT RÉELS ; LEUR CIRCUIT NE L'EST PAS ENCORE
 * ════════════════════════════════════════════════════════════════════════
 * L'accès à l'API Google Business Profile est en cours d'examen. En
 * attendant, `getReviews()` rend NEUF VRAIS AVIS GOOGLE recopiés à la main
 * depuis des captures d'écran (voir `lib/reviews/google-reviews.mock.ts`), et
 * pose `demonstration: true` — non pas parce que les avis seraient faux, mais
 * parce que la source est locale et figée.
 *
 * Tant que ce drapeau vaut `true`, la section affiche un BANDEAU VISIBLE
 * disant à l'écran que ces avis ne sont pas synchronisés. Le jour où la
 * Phase B branche Google, le drapeau passe à `false` dans la source et le
 * bandeau disparaît tout seul — personne n'a à penser à le retirer.
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
      className="scroll-mt-24 overflow-x-clip bg-background pt-12 pb-14 md:pt-16 md:pb-16"
    >
      <div className="mx-auto max-w-7xl px-6">
        <SectionLabel>Preuve sociale</SectionLabel>
        <h2 className="mb-3 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
          Leur expérience
        </h2>
        <p className="mb-5 max-w-xl text-muted-foreground">Ce qu&apos;ils en pensent réellement</p>

        {/*
          LA NOTE GLOBALE — celle des avis AFFICHÉS, et le libellé le dit.
          Ce n'est pas la note de la fiche Google, qui inclut les avis de
          moins de cinq étoiles : l'annoncer comme telle serait un chiffre
          faux. La Phase B lira la vraie moyenne chez Google.
        */}
        {average !== null ? (
          <p className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
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
          ⚠️ LE BANDEAU DE PROVENANCE. Il n'est pas décoratif, et il a CHANGÉ
          DE PROPOS : les avis affichés sont désormais de vrais avis Google,
          écrits par de vraies personnes. Dire d'eux qu'ils sont « des
          exemples » serait devenu un mensonge, et un mensonge aux dépens des
          clients qui les ont écrits.

          Ce qui reste à signaler, c'est le CIRCUIT : ces avis sont recopiés à
          la main dans le dépôt, pas lus chez Google. Un nouvel avis
          n'apparaîtra pas tout seul, un avis supprimé resterait affiché. Le
          bandeau dit exactement cela, et rien de plus.

          Il disparaît automatiquement le jour où la source cesse d'être
          locale — personne n'a à penser à le retirer.
        */}
        {demonstration ? (
          <p
            data-avis-demonstration
            role="note"
            className="mb-2 inline-flex flex-wrap items-center gap-2 border border-primary/50 px-3 py-2 text-[0.7rem] uppercase tracking-[0.16em] text-primary"
          >
            <span aria-hidden="true">●</span>
            Avis Google réels, recopiés manuellement — non synchronisés automatiquement
          </p>
        ) : null}
      </div>

      {/*
        ⚠️ `overflow-x-clip` ET NON `overflow-hidden`.

        Les deux empêchent la barre de défilement horizontale, ce qui est
        l'objectif — les cartes se décalent latéralement et un conteneur trop
        serré les rognerait. Mais `overflow-hidden` force AUSSI un
        `overflow-y: auto` implicite, qui guillotinerait verticalement une
        carte dépliée au survol : l'avis de huit cents caractères serait coupé
        net au bas de la section. `overflow-x: clip` laisse l'axe vertical
        entièrement libre, sans rien concéder sur l'horizontal.
      */}
      <div className="mx-auto max-w-5xl px-6">
        <GoogleReviewsStack avis={reviews} />
      </div>
    </section>
  );
}
