import {
  disquesDeLAnneau,
  type DensiteDeChargement,
} from "@/lib/loader-anneaux";

/**
 * LE DESSIN DU LOADER — et rien d'autre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI CE COMPOSANT EST SÉPARÉ DE `Loader`
 * ════════════════════════════════════════════════════════════════════════
 * Pour la même raison que `DoubleStar` l'était avant lui : `Loader` décide
 * QUAND et à QUELLE taille l'attente s'affiche, ce composant sait
 * uniquement DESSINER. Le jour où le motif sert ailleurs (un bouton qui
 * travaille, un panneau qui se recharge), il part seul.
 *
 * ⚠️ IL NE PORTE AUCUNE COORDONNÉE. Tout vient de `lib/loader-anneaux.ts`,
 * qui les tient de `brand/loading.json`. Écrire un `cx` en dur ici, c'est
 * rouvrir la porte au dessin qui diverge de sa source.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ANIMATION N'EST PAS ICI NON PLUS
 * ════════════════════════════════════════════════════════════════════════
 * Aucun `style` en ligne, aucun décalage calculé au rendu : le CSS vise les
 * anneaux par leur RANG (`.seth-loader-anneau:nth-of-type(n)`). Les cinq
 * règles couvrent les trois densités d'un coup, et le composant reste un
 * composant serveur sans état — donc présent dans le HTML initial, ce qui
 * est la moindre des choses pour un indicateur de chargement.
 *
 * `aria-hidden` : le libellé est porté par `Loader`, qui l'annonce déjà.
 * Deux annonces pour une seule attente, c'est une de trop.
 */
export function AnneauxDeChargement({
  densite,
  className = "",
}: {
  readonly densite: DensiteDeChargement;
  readonly className?: string;
}) {
  return (
    <svg
      viewBox={`0 0 ${densite.boite} ${densite.boite}`}
      aria-hidden="true"
      focusable="false"
      className={`seth-loader-anneaux ${className}`.trim()}
    >
      {densite.anneaux.map((anneau) => (
        <g key={`${anneau.points}-${anneau.rayon}`} className="seth-loader-anneau">
          {disquesDeLAnneau(anneau, densite.boite).map((disque) => (
            <circle key={`${disque.cx}-${disque.cy}`} cx={disque.cx} cy={disque.cy} r={disque.r} />
          ))}
        </g>
      ))}
    </svg>
  );
}
