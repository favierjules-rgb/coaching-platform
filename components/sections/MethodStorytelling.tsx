"use client";

import type { CSSProperties } from "react";

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
// Géométrie du motif : entièrement déportée en CSS, dans les variables
// `--method-*` définies par `.method-stars-scene` / `.method-stars-band`
// (app/globals.css). Une seule longueur y est libre — la hauteur d'étoile
// — et la position de repos comme la position finale en découlent par des
// rapports constants, repris du calibrage desktop validé.
//
// Correction du 29/07/2026 (retour de Jules : animation figée sur iPhone
// 14, correcte sur iPhone 16 Pro Max). Deux défauts distincts :
//
//  1. `usePinnedSceneViewport` conditionnait l'ANIMATION elle-même à
//     `(min-height: 700px)`. Ce seuil tombe pile entre la hauteur
//     réellement visible d'un iPhone 14 sous Safari (~664px, barres
//     comprises) et celle d'un grand iPhone (~740-776px) : le premier
//     recevait un repli entièrement statique, le second l'animation. Le
//     seuil ne décide plus désormais que de la MISE EN PAGE (contenu
//     ancré ou en flux) ; les étoiles s'écartent dans les deux cas.
//
//  2. La géométrie était exprimée en unités calibrées pour le bureau
//     (`92vh` de haut, `56vw` d'écart). Sur un écran étroit, l'étoile
//     devenait plus large que le viewport et l'écart ne suffisait plus à
//     l'en faire sortir. Voir le commentaire de `app/globals.css`.
//
// Aucun ciblage d'appareil, aucun User-Agent, aucun `window.innerWidth` :
// tout est résolu par `min()`/`max()` côté CSS, donc valable à toute
// largeur et recalculé par le navigateur à chaque changement de taille.

// Progression locale (0→1) à laquelle l'écartement est terminé — au-delà,
// les étoiles restent immobiles à leur position finale pendant le reste
// de la portion ancrée (un temps de pause avant que le scroll normal ne
// reprenne). Le contenu (titre + 4 piliers) apparaît pendant l'écart,
// cf. `CONTENT_START`/`CONTENT_END` ci-dessous.
const SEPARATION_END = 0.6;

// Mêmes bornes, pour le repli en flux — exprimées sur la traversée de la
// bande décorative (0 = elle entre par le bas de l'écran, 1 = elle sort par
// le haut). Départ une fois la bande entrée, arrivée alors qu'elle sort
// déjà : l'écart occupe donc toute la portion où on la regarde, et on ne
// voit jamais une bande vide attendre la fin du défilement.
const FLOW_SEPARATION_START = 0.3;
const FLOW_SEPARATION_END = 0.85;

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

/**
 * Les deux étoiles, à une étape donnée de l'écartement (`sepT`, 0 → 1).
 *
 * Un seul `transform` par étoile, interpolé entre la position de repos et
 * la position finale — les deux lues dans les variables CSS de l'ancêtre.
 * `sepT` n'entre donc que comme un nombre : c'est le navigateur qui fait
 * l'arithmétique des unités, à la largeur courante, sans que JavaScript
 * n'ait à connaître la taille de l'écran.
 *
 * Skills appliquées (cf. `.agents/skills/review-animations/SKILL.md`,
 * `.agents/skills/emil-design-eng/SKILL.md`) :
 * - `transform` seul, jamais `top`/`left` (règle « GPU-only properties ») ;
 * - `transform-origin: center` explicite — le motif pivote autour de son
 *   propre centre, il n'est ancré à aucun déclencheur ;
 * - `will-change: transform` uniquement sur ce qui bouge réellement ;
 * - `pointer-events: none` : décor pur, jamais dans le chemin du clic ;
 * - la variable CSS n'est PAS réécrite image par image sur un parent
 *   (déclencherait une tempête de recalculs sur tout le sous-arbre) : elle
 *   est statique, seul le `transform` de chaque étoile change.
 */
function StarPair({ sepT }: { sepT: number }) {
  const t = sepT.toFixed(4);
  const dx = `calc(var(--method-rest-x) + ${t} * (var(--method-end-x) - var(--method-rest-x)))`;
  const dy = `calc(var(--method-rest-y) + ${t} * (var(--method-end-y) - var(--method-rest-y)))`;

  const commun: CSSProperties = {
    opacity: STAR_OPACITY,
    transformOrigin: "center",
    willChange: "transform",
  };
  // `width: auto` + hauteur imposée : le viewBox de chaque étoile donne le
  // ratio, donc la largeur suit sans jamais déformer le tracé
  // (`preserveAspectRatio` reste à sa valeur par défaut, xMidYMid meet).
  const taille: CSSProperties = { height: "var(--method-star-h)", width: "auto" };

  return (
    <>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{ ...commun, transform: `translate(-50%, -50%) translate(calc(-1 * ${dx}), calc(-1 * ${dy}))` }}
      >
        <SethStarsMark star="A" className="block" style={taille} />
      </div>
      <div
        className="pointer-events-none absolute left-1/2 top-1/2"
        style={{ ...commun, transform: `translate(-50%, -50%) translate(${dx}, ${dy})` }}
      >
        <SethStarsMark star="B" className="block" style={taille} />
      </div>
    </>
  );
}

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
 * ancrée, aucun rognage. Sert les écrans trop courts pour immobiliser le
 * contenu dans une hauteur d'écran (voir `usePinnedSceneViewport`) et
 * `prefers-reduced-motion`.
 *
 * Correction du 26/07/2026 : sur téléphone, la grille des piliers s'empile
 * et devenait bien plus haute que le viewport. Enfermée dans la scène
 * ancrée (`h-screen` + `overflow-hidden` + `justify-center`), elle
 * débordait des deux côtés à la fois : le titre et le haut du pilier 01
 * rognés en haut, la fin du pilier 04 en bas, et la section suivante
 * semblait « remonter ».
 *
 * Correction du 29/07/2026 : cette variante n'était plus animée du tout —
 * elle posait la marque assemblée en image fixe. C'est ce que voyait un
 * iPhone 14. Elle reçoit désormais le MÊME geste, dans une bande qui lui
 * est propre, au-dessus du titre : les étoiles y sont entières au repos,
 * s'écartent au défilement et sortent par les bords. La bande évite le
 * seul placement qui ne pouvait pas marcher ici — superposer les étoiles
 * au contenu : les cartes des piliers sont opaques (`bg-card`), une étoile
 * passée derrière serait invisible, et passée devant elle rendrait le
 * texte illisible sur une colonne étroite.
 *
 * `immobile` : `prefers-reduced-motion`. Les étoiles restent alors à leur
 * position de repos — assemblées, exactement la marque du logo — visibles
 * et nettes, simplement sans mouvement.
 */
function MethodPillarsFlow({ immobile }: { immobile: boolean }) {
  // La progression est mesurée sur la BANDE elle-même, en mode traversée :
  // le geste se déroule exactement pendant qu'elle traverse l'écran, donc
  // entièrement sous les yeux. Mesurée sur la section entière, il se serait
  // joué pendant que la bande sortait déjà par le haut.
  const { ref, progress } = useSectionScrollProgress<HTMLDivElement>("traversal");

  // Fenêtre resserrée sur le milieu de la traversée : les étoiles restent
  // assemblées le temps que la bande entre par le bas, s'écartent pendant
  // qu'elle remonte, et ont fini avant qu'elle ne sorte par le haut.
  const sepT = immobile
    ? 0
    : Math.min(1, Math.max(0, (progress - FLOW_SEPARATION_START) / (FLOW_SEPARATION_END - FLOW_SEPARATION_START)));

  return (
    <section id="methode" className="method-stars-scene scroll-mt-24 bg-background py-24">
      <div className="mx-auto max-w-7xl px-6">
        {/* `overflow-hidden` : les étoiles sortent par les bords de la
            bande sans jamais créer de défilement horizontal sur la page. */}
        <div ref={ref} className="method-stars-band relative mb-12 overflow-hidden" aria-hidden="true">
          <StarPair sepT={sepT} />
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
 * visible.
 *
 * `usePinnedSceneViewport` arbitre uniquement la MISE EN PAGE : le contenu
 * peut-il être immobilisé dans une hauteur d'écran sans être rogné ? Sous
 * ce seuil, il repasse en flux normal — mais les étoiles s'écartent dans
 * les deux cas (correction du 29/07/2026). Ce que la hiérarchie de remède
 * de `.agents/skills/review-animations` recommande de retirer, c'est une
 * animation qui contraint son contenu ; ici c'est l'ancrage qui contraint,
 * pas le geste, et seul l'ancrage est abandonné.
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
 * - `prefers-reduced-motion` : aucune scène ancrée, aucun mouvement — les
 *   deux étoiles restent assemblées à leur position de repos, visibles et
 *   nettes, titre et 4 piliers immédiatement lisibles. Jamais masquées.
 */
export function MethodStorytelling() {
  const reducedMotion = usePrefersReducedMotion();
  const canPinScene = usePinnedSceneViewport();

  // Les deux variantes sont des composants distincts :
  // `useSectionScrollProgress` attache son écouteur de scroll dans un effet à
  // dépendances vides, donc au montage de son composant. Appelé depuis ce
  // composant-ci, il se serait exécuté au tout premier rendu — celui servi par
  // le serveur, où son `ref` n'est attaché à aucun nœud — et n'aurait jamais
  // été rejoué au passage sur l'autre variante : l'écouteur n'aurait jamais
  // existé et la progression serait restée à 0. Monter chaque variante
  // séparément garantit que le ref est en place avant l'effet.
  if (reducedMotion || !canPinScene) {
    return <MethodPillarsFlow immobile={reducedMotion} />;
  }

  return <MethodPillarsScene />;
}

/** Scène ancrée : le contenu est immobilisé, les étoiles s'écartent devant. */
function MethodPillarsScene() {
  const { ref, progress } = useSectionScrollProgress<HTMLDivElement>();

  const sepT = Math.min(1, progress / SEPARATION_END);

  const contentT = easeOut(
    Math.min(1, Math.max(0, (progress - CONTENT_START) / (CONTENT_END - CONTENT_START)))
  );

  return (
    <section id="methode" className="method-stars-scene scroll-mt-24 bg-background">
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

          <StarPair sepT={sepT} />
        </div>
      </div>
    </section>
  );
}
