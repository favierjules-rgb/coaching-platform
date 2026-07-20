"use client";

import { SethStarsMark } from "@/components/brand/SethStarsMark";
import { usePageScrollProgress } from "@/hooks/usePageScrollProgress";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// Corrigé une 3e fois (retour de Jules) : les deux passes précédentes
// (fondu rapide à 0.2, puis quasi instantané à 0.04 dès le tout début du
// scroll) réglaient bien « pas de flou progressif », mais déplaçaient le
// problème ailleurs — le rideau noir ne servait plus à rien, puisqu'il
// disparaissait avant même que les étoiles n'aient visiblement bougé. Ce
// que Jules décrit est différent : les étoiles doivent D'ABORD défiler
// sur fond noir plein (aucune révélation, même partielle, du Hero
// pendant tout ce trajet), et ce n'est qu'à 75% du parcours — quand
// elles sont quasiment sur les bords — que le haut du Hero doit
// apparaître. Donc le seuil de révélation passe de ~0 à 0.75.
//
// Pour que « le haut du Hero » soit effectivement ce qui apparaît (et
// pas du contenu déjà scrollé hors champ, le bug d'origine), la distance
// totale de scroll de toute la séquence doit rester courte : à 75% de
// cette distance, le Hero (contenu en flux normal, non fixé) ne doit pas
// avoir défilé de plus de quelques dizaines de vh. Voir `TOTAL_SCROLL_VH`
// ci-dessous.
const REVEAL_PROGRESS = 0.75;

// Largeur (en fraction de progression) de la transition d'effacement du
// fond une fois `REVEAL_PROGRESS` atteint. Volontairement minuscule pour
// rester un « cut » net plutôt qu'un fondu perceptible (même exigence
// que la note ci-dessus) — juste assez large pour éviter un saut brut
// d'une frame à l'autre.
const REVEAL_WINDOW = 0.05;

// Distance totale de scroll de la séquence, en multiples de la hauteur
// du viewport. Réduite fortement (depuis 1x) : avec un rideau qui reste
// opaque jusqu'à 75% du trajet, il faut que 75% de cette distance reste
// petit devant la hauteur du Hero pour que son haut (kicker + titre)
// soit encore visible au moment de la révélation — sinon on retombe
// dans le bug d'origine (« les informations apparaissent quand la page
// est déjà trop basse »).
//
// Valeur vérifiée par mesure DOM réelle (`getBoundingClientRect`) plutôt
// que devinée : le kicker (logo + « Seth · Préparation Physique ») est à
// 221px du haut du document, le header fixe fait 64px de haut (cf.
// Header.tsx, h-16). Un premier essai à 0.35 (donc ~187px de scroll à
// 75%) plaçait déjà le kicker à 21px à l'écran — caché sous le header.
// 0.15 (soit ~80px de scroll à 75%) laisse le kicker à ~141px, largement
// visible, avec toute la marge nécessaire pour rester correct sur des
// viewports plus petits.
const TOTAL_SCROLL_VH = 0.15;

/**
 * Rideau d'ouverture du Hero — nouvelle direction (20/07/2026).
 *
 * Le chantier storytelling scroll complet (zoom, fût de pilier, 4
 * piliers) est mis de côté pour l'instant au profit de quelque chose de
 * plus simple, ciblé sur le Hero uniquement : au chargement, écran noir
 * avec les deux étoiles assemblées au centre (exactement la position de
 * repos déjà validée — cf. historique git, écart réel ±17.52vh / ±18.64vh
 * entre les centres des deux étoiles du logo source). Au scroll, les
 * étoiles repartent en diagonale vers les coins d'où elles venaient
 * (trajectoire inverse de l'ancienne version « arrivée »).
 *
 * Corrigé (retour de Jules, 2e passe) : fond noir et étoiles n'ont plus
 * la même temporalité — auparavant les deux étaient portés par l'opacité
 * d'un seul conteneur englobant, calée sur le trajet complet des étoiles
 * (0→1), ce qui retardait la lisibilité du Hero bien après que son haut
 * ait défilé hors champ. Désormais : le fond noir a sa PROPRE opacité
 * (cf. `REVEAL_PROGRESS`/`REVEAL_WINDOW` ci-dessous, revus depuis en 3e
 * passe), tandis que les étoiles gardent leur transparence constante déjà
 * validée et continuent leur trajet jusqu'au bout (0→1) indépendamment —
 * elles restent visibles pendant qu'elles s'éloignent, quelle que soit la
 * temporalité du fond derrière elles.
 *
 * Conséquence d'architecture : ce rideau doit être AU-DESSUS du contenu
 * du Hero (pas en dessous comme avant), sinon rien n'est caché au
 * chargement. z-20 : au-dessus du wrapper `z-10` de Hero.tsx (texte +
 * photo), en dessous du header fixe (`z-50`, cf. Header.tsx) qui doit
 * rester cliquable pendant toute la séquence.
 *
 * Ne modifie pas `Hero.tsx` : sibling indépendant (voir app/page.tsx),
 * `position: fixed` donc non affecté par l'`overflow-hidden` du Hero.
 *
 * Corrigé (retour de Jules, 3e passe) : le fond noir reste PLEINEMENT
 * opaque tant que les étoiles n'ont pas presque atteint les bords — la
 * révélation du Hero n'intervient qu'à `REVEAL_PROGRESS` (75%), toujours
 * en cut net (pas de fondu perceptible, cf. `REVEAL_WINDOW`). Distance
 * totale de scroll ramenée à `TOTAL_SCROLL_VH` (0.15x la hauteur du
 * viewport, valeur vérifiée par mesure DOM réelle — cf. note sur la
 * constante) pour que ces 75% restent courts en pixels réels — sinon le
 * haut du Hero (kicker compris) aurait déjà défilé sous le header fixe au
 * moment de la révélation (bug d'origine, reproduit puis corrigé pendant
 * cette passe).
 * Progression locale (0→1), continue, sans easing (translation linéaire
 * pure, conformément à la préférence déjà exprimée par Jules) :
 *   0                              → étoiles assemblées, fond noir opaque
 *   0 → REVEAL_PROGRESS            → fond noir opaque, étoiles défilent
 *   REVEAL_PROGRESS → +WINDOW      → le fond disparaît (cut net)
 *   0 → 1                          → les étoiles continuent vers les bords
 *   1                              → étoiles hors-écran, rideau démonté
 */
export function SethStarsIntro() {
  const reducedMotion = usePrefersReducedMotion();
  const progress = usePageScrollProgress(TOTAL_SCROLL_VH);

  if (reducedMotion) {
    // Pas de rideau du tout : le Hero doit être immédiatement visible et
    // accessible pour les utilisateur·rice·s sensibles au mouvement,
    // plutôt que d'attendre une animation qu'iels ne verront pas se jouer.
    return null;
  }

  if (progress >= 1) {
    // Entièrement scrollé au-delà : ne reste pas monté indéfiniment
    // au-dessus du Hero (état final = complètement transparent de toute
    // façon, mais autant démonter proprement).
    return null;
  }

  // Trajectoire linéaire pure : aucun easing, la vitesse de déplacement
  // est constante du repos jusqu'à la sortie hors-écran. `remaining` va
  // de 0 (repos, assemblé) à 1 (sorti de l'écran) — sens inverse de
  // l'ancienne version « arrivée », mais même formule de transform (donc
  // même géométrie de repos déjà validée, et même distance de sortie
  // ±40vw/±34vh).
  const remaining = progress;

  const starATransform = `translate(-50%, -50%) translate(calc(-17.52vh - ${remaining * 40}vw), calc(-18.64vh - ${remaining * 34}vh))`;
  const starBTransform = `translate(-50%, -50%) translate(calc(17.52vh + ${remaining * 40}vw), calc(18.64vh + ${remaining * 34}vh))`;

  // Légère transparence constante sur chaque étoile (déjà validée par
  // Jules) — indépendante du fondu du fond, cf. note ci-dessus.
  const STAR_OPACITY = 0.88;

  // Fond noir qui masque le Hero au chargement, et le reste jusqu'à
  // `REVEAL_PROGRESS` : les étoiles défilent sur un fond plein tant
  // qu'elles n'ont pas quasiment atteint les bords. Passé ce seuil, cut
  // net sur une fenêtre minuscule (`REVEAL_WINDOW`) — indépendant du
  // trajet des étoiles, qui continue jusqu'à 1 sans changement.
  const bgOpacity =
    progress < REVEAL_PROGRESS ? 1 : Math.max(0, 1 - (progress - REVEAL_PROGRESS) / REVEAL_WINDOW);

  return (
    <div className="pointer-events-none fixed inset-0 z-20">
      <div className="absolute inset-0 bg-black" style={{ opacity: bgOpacity }} />
      <div
        className="absolute left-1/2 top-1/2 h-[92vh] w-auto"
        style={{ transform: starATransform, opacity: STAR_OPACITY, willChange: "transform" }}
      >
        <SethStarsMark star="A" className="h-[92vh] w-auto" />
      </div>
      <div
        className="absolute left-1/2 top-1/2 h-[92vh] w-auto"
        style={{ transform: starBTransform, opacity: STAR_OPACITY, willChange: "transform" }}
      >
        <SethStarsMark star="B" className="h-[92vh] w-auto" />
      </div>
    </div>
  );
}
