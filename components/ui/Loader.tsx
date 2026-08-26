import { DoubleStar } from "@/components/ui/DoubleStar";

/**
 * LE LOADER — L'EMBLÈME SETH, QUI RESPIRE PENDANT L'ATTENTE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI L'EMBLÈME ET PAS UN CERCLE QUI TOURNE
 * ════════════════════════════════════════════════════════════════════════
 * Un spinner générique ne dit rien : il occupe l'attente sans l'habiter. La
 * double étoile, elle, est déjà la marque du site — la revoir pendant un
 * chargement rattache le temps mort à la page qu'on attend au lieu de le
 * suspendre dans le vide.
 *
 * ⚠️ C'EST LE MÊME TRACÉ QUE PARTOUT AILLEURS. `DoubleStar` porte les deux
 * chemins du logo officiel ; on ne les redessine pas ici, on les réutilise.
 * Un emblème redessiné pour un usage finirait par diverger de l'original.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ANIMATION : DEUX ÉTOILES QUI ALTERNENT, PAS UNE ROTATION
 * ════════════════════════════════════════════════════════════════════════
 * Les deux pointes s'éclairent l'une après l'autre, en boucle. Une rotation
 * aurait déformé une marque qui a un haut et un bas ; l'alternance respecte
 * sa géométrie tout en donnant le battement qu'on attend d'un indicateur.
 *
 * `linear` et non `ease-out` : c'est un mouvement CONSTANT, pas une entrée.
 * Un mouvement perpétuel qui accélère et ralentit attire l'œil bien plus
 * qu'il ne le devrait (voir `.agents/skills/review-animations/STANDARDS.md`).
 *
 * ⚠️ COUPÉ SOUS `prefers-reduced-motion` : l'emblème reste affiché, immobile.
 * Un indicateur qui disparaît en mouvement réduit laisserait l'utilisateur
 * sans savoir que quelque chose charge — on retire le battement, pas le
 * signal.
 *
 * ════════════════════════════════════════════════════════════════════════
 * IL S'ANNONCE AUX LECTEURS D'ÉCRAN
 * ════════════════════════════════════════════════════════════════════════
 * `role="status"` et un libellé lu à voix haute : sans eux, l'attente est
 * silencieuse pour qui ne voit pas l'écran, et la page semble simplement
 * cassée.
 */
interface LoaderProps {
  /** Le libellé lu par les lecteurs d'écran. Précisez-le quand le contexte
   *  le permet — « Chargement des programmes… » vaut mieux que « Chargement… ». */
  readonly libelle?: string;
  /**
   * `plein` occupe toute la hauteur disponible et centre l'emblème : c'est la
   * forme des pages entières. `ligne` s'insère dans un bloc existant.
   */
  readonly variante?: "plein" | "ligne";
  readonly className?: string;
}

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
      <DoubleStar className="seth-loader-marque" />
      <span className="sr-only">{libelle}</span>
    </div>
  );
}
