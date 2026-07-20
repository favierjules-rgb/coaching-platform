"use client";

import { SethStarsMark } from "@/components/brand/SethStarsMark";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { methodPillars } from "@/data/mock";
import { useSectionScrollProgress } from "@/hooks/useSectionScrollProgress";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { easeOut } from "@/lib/easing";

// Nouvelle direction (retour de Jules, 20/07/2026) : le Hero n'a plus
// d'animation d'ouverture (voir app/page.tsx — `SethStarsIntro` retiré de
// l'affichage). L'animation se déplace ici : les deux étoiles, assemblées
// comme la marque de repos, S'ÉCARTENT au scroll pour révéler les 4
// piliers de la méthode — au lieu du rideau noir qui ouvrait le Hero.
//
// Position de repos (étoiles assemblées) : formule déjà validée dans
// `SethStarsIntro.tsx` — écart réel ±17.52vh / ±18.64vh entre les centres
// des deux étoiles du logo source (viewBox "0 0 636.03 807"), en vh sur
// les deux axes pour préserver l'angle ~46.8° quel que soit le ratio du
// viewport. Réutilisée telle quelle ici pour la cohérence visuelle du
// motif (même geste que ce qui devait ouvrir le Hero, simplement déplacé
// plus bas dans la page).
const REST_OFFSET_X_VH = 17.52;
const REST_OFFSET_Y_VH = 18.64;

// Amplitude de l'écartement (ajoutée à la position de repos ci-dessus).
// Calculée pour dégager le bord de la colonne de contenu (max-w-7xl =
// 1280px, donc ±640px depuis le centre) de la largeur propre de chaque
// étoile (92vh de haut × ratio 636.03/807 ≈ 0.7881 de large, soit une
// demi-largeur ≈ 0.394×92vh ≈ 36.2vh) — sur un viewport desktop courant
// (~900px de haut), 640px − 17.52vh(repos) + 36.2vh(demi-largeur étoile)
// ≈ 808px de croissance nécessaire, soit environ 56vw. Valeur en vw (pas
// en px fixe) car elle doit rester proportionnée au viewport ; sur un
// écran plus étroit que 1280px, la colonne elle-même rétrécit avec lui,
// donc l'écart réellement nécessaire diminue aussi. Composante verticale
// modeste (8 vs 34vh dans l'ancien rideau du Hero) pour lire comme un
// geste surtout horizontal (« s'écartent »), plutôt que la diagonale
// complète de l'ancienne sortie. Première estimation par le calcul,
// pas encore vérifiée sur un viewport desktop large — à confirmer.
const GROWTH_X_VW = 56;
const GROWTH_Y_VH = 8;

// Progression locale (0→1) à laquelle l'écartement est terminé — au-delà,
// les étoiles restent immobiles à leur position finale pendant le reste
// de la portion ancrée (un temps de pause avant que le scroll normal ne
// reprenne). Le contenu (titre + 4 piliers) apparaît pendant l'écart,
// cf. `CONTENT_START`/`CONTENT_END` ci-dessous.
const SEPARATION_END = 0.6;

// Fenêtre de progression sur laquelle le contenu (titre + grille des 4
// piliers) apparaît. Commence après un court délai (les étoiles doivent
// avoir commencé à s'écarter avant que du texte n'apparaisse dessous,
// sinon la superposition initiale est illisible), se termine légèrement
// avant la fin de l'écartement pour que tout soit net avant la pause.
const CONTENT_START = 0.12;
const CONTENT_END = 0.5;

// Transparence constante des étoiles (déjà validée par Jules dans
// `SethStarsIntro.tsx`) — inchangée ici pour la cohérence du motif.
const STAR_OPACITY = 0.88;

// Hauteur de la section ancrée, en vh. Distance de scroll réellement
// « capturée » = cette valeur moins 100vh (la hauteur du viewport) — ici
// 120vh de scroll utile, suffisant pour lire le geste sans être
// interminable.
const SECTION_HEIGHT_VH = 220;

/**
 * Storytelling scroll « 4 piliers SETH » — nouvelle version (20/07/2026).
 *
 * Remplace l'ancienne scène « zoom + fût de pilier » (abandonnée par
 * Jules, cf. historique git) par un geste plus simple et plus proche de
 * sa demande initiale : une scène ancrée (sticky) où les deux étoiles,
 * assemblées comme au repos, s'écartent horizontalement à mesure que
 * l'utilisateur·rice scrolle, révélant le titre « 4 piliers. 1
 * transformation. » et les 4 cartes de méthode (contenu déjà existant,
 * `methodPillars` de `data/mock.ts` — repris tel quel, aucun texte
 * inventé pour ce chantier visuel).
 *
 * Skills appliquées (cf. `.agents/skills/emil-design-eng/SKILL.md`,
 * `.agents/skills/animation-vocabulary/SKILL.md`) :
 * - Uniquement `transform`/`opacity` animés (règle perf « Only animate
 *   transform and opacity ») — aucune largeur/hauteur/padding animée.
 * - Entrée du contenu en fondu + léger scale-in depuis 0.96 (jamais
 *   depuis `scale(0)`, cf. règle « Never animate from scale(0) »), avec
 *   `easeOut` (déjà utilisé ailleurs dans ce fichier, reprend le token
 *   CSS `--ease-out` du design system).
 * - C'est un `Scroll-driven animation` + `Reveal` (vocabulaire du
 *   glossaire) : la progression est pilotée par le scroll, pas une
 *   temporisation fixe.
 * - `prefers-reduced-motion` : aucune scène ancrée, aucun mouvement —
 *   repli direct sur le contenu final (étoiles assemblées statiques,
 *   titre et 4 piliers immédiatement visibles et lisibles).
 */
export function MethodStorytelling() {
  const reducedMotion = usePrefersReducedMotion();
  const { ref, progress } = useSectionScrollProgress<HTMLDivElement>();

  if (reducedMotion) {
    return (
      <section id="methode" className="scroll-mt-24 bg-background py-24">
        <div className="mx-auto max-w-7xl px-6">
          <div className="mb-12 flex justify-center">
            <SethStarsMark className="h-40 w-auto max-w-[70vw] opacity-90" />
          </div>

          <SectionLabel>Ma méthode</SectionLabel>
          <h2 className="mb-16 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
            4 piliers.
            <br />1 transformation.
          </h2>

          <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
            {methodPillars.map(({ icon: Icon, title, description }, index) => (
              <div key={title} className="bg-card p-8">
                <div className="mb-6 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                  0{index + 1}
                </div>
                <Icon size={28} className="mb-4 text-primary" />
                <h3 className="mb-3 font-heading text-xl font-bold uppercase text-foreground">
                  {title}
                </h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    );
  }

  const sepT = Math.min(1, progress / SEPARATION_END);
  const starATransform = `translate(-50%, -50%) translate(calc(-${REST_OFFSET_X_VH}vh - ${sepT * GROWTH_X_VW}vw), calc(-${REST_OFFSET_Y_VH}vh - ${sepT * GROWTH_Y_VH}vh))`;
  const starBTransform = `translate(-50%, -50%) translate(calc(${REST_OFFSET_X_VH}vh + ${sepT * GROWTH_X_VW}vw), calc(${REST_OFFSET_Y_VH}vh + ${sepT * GROWTH_Y_VH}vh))`;

  const contentT = easeOut(
    Math.min(1, Math.max(0, (progress - CONTENT_START) / (CONTENT_END - CONTENT_START)))
  );

  return (
    <section id="methode" className="scroll-mt-24 bg-background">
      <div ref={ref} style={{ height: `${SECTION_HEIGHT_VH}vh` }} className="relative">
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          <div
            className="mx-auto flex h-full max-w-7xl flex-col justify-center px-6"
            style={{
              opacity: contentT,
              transform: `scale(${0.96 + 0.04 * contentT})`,
              willChange: "transform, opacity",
            }}
          >
            <SectionLabel>Ma méthode</SectionLabel>
            <h2 className="mb-12 font-heading text-4xl font-extrabold uppercase text-foreground md:text-6xl">
              4 piliers.
              <br />1 transformation.
            </h2>

            <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
              {methodPillars.map(({ icon: Icon, title, description }, index) => (
                <div key={title} className="bg-card p-8">
                  <div className="mb-6 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
                    0{index + 1}
                  </div>
                  <Icon size={28} className="mb-4 text-primary" />
                  <h3 className="mb-3 font-heading text-xl font-bold uppercase text-foreground">
                    {title}
                  </h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
                </div>
              ))}
            </div>
          </div>

          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[92vh] w-auto"
            style={{ transform: starATransform, opacity: STAR_OPACITY, willChange: "transform" }}
          >
            <SethStarsMark star="A" className="h-[92vh] w-auto" />
          </div>
          <div
            className="pointer-events-none absolute left-1/2 top-1/2 h-[92vh] w-auto"
            style={{ transform: starBTransform, opacity: STAR_OPACITY, willChange: "transform" }}
          >
            <SethStarsMark star="B" className="h-[92vh] w-auto" />
          </div>
        </div>
      </div>
    </section>
  );
}
