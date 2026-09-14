import { AnneauxDeChargement } from "@/components/ui/AnneauxDeChargement";
import {
  DENSITE_COMPLETE,
  DENSITE_MINIMALE,
  DENSITE_REDUITE,
  type DensiteDeChargement,
} from "@/lib/loader-anneaux";

/**
 * LE LOADER — LES ANNEAUX DE POINTS, QUI RESPIRENT PENDANT L'ATTENTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUI A CHANGÉ, ET CE QUI NE CHANGE PAS
 * ════════════════════════════════════════════════════════════════════════
 * Ce loader affichait l'emblème SETH (`DoubleStar`), dont les deux pointes
 * s'allumaient en alternance. Il affiche désormais les anneaux concentriques
 * de `brand/loading.json`. C'est un changement de marque ASSUMÉ, décidé le
 * 14/09/2026 : l'emblème n'a pas été jugé insuffisant, un motif d'attente
 * dédié a été préféré. `DoubleStar` reste l'emblème du site et continue de
 * servir ailleurs (voir `SessionCompletionCard`).
 *
 * Ce qui NE change pas, et qui comptait déjà :
 *   • le loader reste un COMPOSANT SERVEUR sans état ni réseau — il est dans
 *     le HTML initial, sinon il arriverait après ce qu'il est censé couvrir ;
 *   • il s'annonce toujours aux lecteurs d'écran (`role="status"`) ;
 *   • sous `prefers-reduced-motion`, on retire le battement, JAMAIS le
 *     signal : un indicateur qui disparaît fait croire à une page cassée ;
 *   • il ne redessine rien : la géométrie vient d'un fichier de marque, et
 *     un test relit ce fichier pour le prouver.
 *
 * ════════════════════════════════════════════════════════════════════════
 * TROIS VARIANTES, TROIS DENSITÉS — ET C'EST LE CŒUR DU SUJET
 * ════════════════════════════════════════════════════════════════════════
 * Le motif d'origine compte 120 points sur un canevas de 1080 px. Rendu à
 * 28 px — la taille des attentes de section — chaque point mesurerait moins
 * d'un pixel. Rétrécir ce dessin, c'est le détruire.
 *
 * La taille et la densité varient donc ENSEMBLE : cinq anneaux en pleine
 * page, deux dans un bloc, un seul en ligne de texte. Le motif reste
 * reconnaissable partout au lieu de se dissoudre dans les petites tailles.
 * Voir `lib/loader-anneaux.ts` pour les proportions de chaque densité.
 */
interface LoaderProps {
  /** Le libellé lu par les lecteurs d'écran. Précisez-le quand le contexte
   *  le permet — « Chargement des programmes… » vaut mieux que « Chargement… ». */
  readonly libelle?: string;
  /**
   * TROIS FORMES, POUR TROIS NATURES D'ATTENTE — et le choix n'est pas
   * décoratif : un écran pleine page posé sur une action de deux secondes
   * fait paraître l'application cassée.
   *
   *   `plein`   une PAGE entière se charge. Occupe la hauteur disponible,
   *             centre le motif, et lui donne ses cinq anneaux.
   *   `ligne`   une SECTION ou un composant se charge. S'insère dans le bloc
   *             existant ; deux anneaux, points plus gros.
   *   `inline`  une ACTION COURTE est en cours. À la taille du texte qui
   *             l'entoure, sans marge propre ; un seul anneau.
   */
  readonly variante?: "plein" | "ligne" | "inline";
  readonly className?: string;
}

/* La densité est une conséquence de la variante, jamais un réglage à part :
   laisser choisir « cinq anneaux en ligne de texte » serait laisser choisir
   une bouillie. */
const DENSITES: Record<NonNullable<LoaderProps["variante"]>, DensiteDeChargement> = {
  plein: DENSITE_COMPLETE,
  ligne: DENSITE_REDUITE,
  inline: DENSITE_MINIMALE,
};

export function Loader({
  libelle = "Chargement…",
  variante = "plein",
  className = "",
}: LoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-seth-loader={variante}
      className={`seth-loader seth-loader-${variante} ${className}`.trim()}
    >
      <AnneauxDeChargement densite={DENSITES[variante]} />
      <span className="sr-only">{libelle}</span>
    </div>
  );
}
