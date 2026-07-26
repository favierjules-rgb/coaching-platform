"use client";

import { SethStarsMark } from "@/components/brand/SethStarsMark";
import { SectionLabel } from "@/components/ui/SectionLabel";
import { methodPillars } from "@/data/mock";
import { usePinnedSceneViewport } from "@/hooks/usePinnedSceneViewport";
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

// Hauteur de la scène ancrée : 220 hauteurs d'écran, définies par les
// classes `.pinned-scene-track` / `.pinned-scene-viewport` (app/globals.css)
// en `svh` avec repli `vh`. Distance de scroll réellement « capturée » =
// 220 − 100 = 120 hauteurs d'écran de scroll utile, suffisant pour lire le
// geste sans être interminable. En `svh` plutôt qu'en `vh` : sur mobile,
// `vh` ignore les barres du navigateur et la scène déborderait de la zone
// visible, rognant le premier et le dernier pilier.

/**
 * Titre + grille des 4 piliers — markup unique, partagé par la scène
 * ancrée (desktop) et le rendu en flux normal (mobile, tablette,
 * `prefers-reduced-motion`). Extrait pour garantir que les deux variantes
 * ne divergent jamais : mêmes textes, mêmes icônes, même ordre 01→04.
 */
function PillarsContent() {
  return (
    <>
      <SectionLabel>Ma méthode</SectionLabel>
      {/* text-3xl en dessous de `sm` : « 1 transformation. » dépasse la
          colonne sur un écran de 320px en text-4xl, ce qui créerait un
          défilement horizontal. Tailles `sm:`/`md:` d'origine inchangées.
          Marge basse resserrée sous `lg` pour dégager de la hauteur au
          profit des piliers. */}
      <h2 className="mb-3 font-heading text-[1.6rem] font-extrabold uppercase leading-[1.05] text-foreground sm:mb-5 sm:text-4xl sm:leading-tight lg:mb-12 md:text-6xl">
        4 piliers.
        <br />1 transformation.
      </h2>

      {/* Densité compacte sous `lg` (padding, marges, tailles de texte et
          d'icône) pour que les 4 piliers empilés tiennent dans la hauteur
          d'un téléphone et que la scène ancrée reste possible. Toutes les
          valeurs desktop sont reprises telles quelles derrière `lg:`. */}
      <div className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-4">
        {methodPillars.map(({ icon: Icon, title, description }, index) => (
          <div key={title} className="bg-card p-3.5 sm:p-5 lg:p-8">
            <div className="mb-1.5 font-heading text-[10px] font-semibold uppercase tracking-[0.3em] text-primary sm:text-xs lg:mb-6">
              0{index + 1}
            </div>
            <Icon size={28} className="mb-1.5 h-5 w-5 text-primary lg:mb-4 lg:h-7 lg:w-7" />
            <h3 className="mb-1 font-heading text-base font-bold uppercase leading-tight text-foreground sm:text-lg lg:mb-3 lg:text-xl lg:leading-normal">
              {title}
            </h3>
            <p className="text-xs leading-snug text-muted-foreground lg:text-sm lg:leading-relaxed">{description}</p>
          </div>
        ))}
      </div>
    </>
  );
}

/**
 * Rendu en FLUX NORMAL : hauteur déterminée par le contenu, aucune scène
 * ancrée, aucun rognage. Sert `prefers-reduced-motion` et les écrans trop
 * courts pour la scène (voir `usePinnedSceneViewport`).
 *
 * Correction du 26/07/2026 : sur téléphone, la grille des piliers s'empile
 * et devenait bien plus haute que le viewport. Enfermée dans la scène
 * ancrée (`h-screen` + `overflow-hidden` + `justify-center`), elle
 * débordait des deux côtés à la fois : le titre et le haut du pilier 01
 * rognés en haut, la fin du pilier 04 en bas, et la section suivante
 * semblait « remonter ». Les étoiles restent présentes en décoration,
 * assemblées comme au repos.
 */
function MethodPillarsFlow() {
  return (
    <section id="methode" className="scroll-mt-24 bg-background py-24">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex justify-center">
          <SethStarsMark className="h-40 w-auto max-w-[70vw] opacity-90" />
        </div>

        <PillarsContent />
      </div>
    </section>
  );
}

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
 * L'animation est conservée sur téléphone (demande de Jules, 26/07/2026) :
 * les piliers y adoptent une densité compacte — padding, marges, tailles de
 * texte et d'icône réduits sous `lg` — pour tenir dans une hauteur d'écran,
 * et la scène est mesurée en `svh` afin de rester dans la zone réellement
 * visible. `usePinnedSceneViewport` ne l'active que si le viewport peut
 * l'accueillir sans rogner : sous ce seuil (iPhone SE et assimilés), le
 * contenu passe en flux normal (voir `MethodPillarsFlow`) — conformément à
 * la hiérarchie de remède de `.agents/skills/review-animations` : mieux
 * vaut retirer l'animation d'un contexte que d'y contraindre le contenu.
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
  const canPinScene = usePinnedSceneViewport();

  // La scène ancrée est un composant à part, monté UNIQUEMENT sur desktop :
  // `useSectionScrollProgress` attache son écouteur de scroll dans un effet à
  // dépendances vides, donc au montage de son composant. Appelé depuis ce
  // composant-ci, il se serait exécuté au tout premier rendu — celui du flux
  // normal, où son `ref` n'est attaché à aucun nœud — et n'aurait jamais été
  // rejoué au passage en desktop : l'écouteur n'aurait jamais existé, la
  // progression serait restée à 0 et le contenu à `opacity: 0`. Monter la
  // scène séparément garantit que le ref est en place avant l'effet.
  if (reducedMotion || !canPinScene) {
    return <MethodPillarsFlow />;
  }

  return <MethodPillarsScene />;
}

/** Scène ancrée desktop — markup et calculs strictement identiques à l'existant. */
function MethodPillarsScene() {
  const { ref, progress } = useSectionScrollProgress<HTMLDivElement>();

  const sepT = Math.min(1, progress / SEPARATION_END);
  const starATransform = `translate(-50%, -50%) translate(calc(-${REST_OFFSET_X_VH}vh - ${sepT * GROWTH_X_VW}vw), calc(-${REST_OFFSET_Y_VH}vh - ${sepT * GROWTH_Y_VH}vh))`;
  const starBTransform = `translate(-50%, -50%) translate(calc(${REST_OFFSET_X_VH}vh + ${sepT * GROWTH_X_VW}vw), calc(${REST_OFFSET_Y_VH}vh + ${sepT * GROWTH_Y_VH}vh))`;

  const contentT = easeOut(
    Math.min(1, Math.max(0, (progress - CONTENT_START) / (CONTENT_END - CONTENT_START)))
  );

  return (
    <section id="methode" className="scroll-mt-24 bg-background">
      <div ref={ref} className="pinned-scene-track relative">
        <div className="pinned-scene-viewport sticky top-0 w-full overflow-hidden">
          <div
            className="mx-auto flex h-full max-w-7xl flex-col justify-center px-6 py-6 lg:py-0"
            style={{
              opacity: contentT,
              transform: `scale(${0.96 + 0.04 * contentT})`,
              willChange: "transform, opacity",
            }}
          >
            <PillarsContent />
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
