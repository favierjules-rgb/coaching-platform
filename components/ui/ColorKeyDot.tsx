import { colorStyleOrNull } from "@/lib/ui/color-keys";

/**
 * N1.6A — L'ACCENT DE COULEUR, EN DEUX FORMES ET PAS UNE DE PLUS.
 *
 * ⚠️ ACCENT, JAMAIS REMPLISSAGE. L'identité du projet est monochrome ; la
 * couleur s'y invite en pastille ou en fine barre latérale. Colorer tout un
 * bloc rendrait l'écran illisible en thème clair et transformerait une aide
 * visuelle en signal dominant.
 *
 * ⚠️ ET ELLE N'EST JAMAIS LA SEULE INFORMATION. Le libellé de la liste est
 * toujours écrit à côté : un daltonien et un lecteur d'écran doivent lire la
 * même chose que tout le monde. C'est pourquoi ce composant rend un
 * `aria-hidden` : il n'ajoute RIEN au texte, il le décore.
 *
 * ⚠️ `null` NE REND RIEN DU TOUT. Une liste sans couleur s'affiche exactement
 * comme avant N1.6A — pas de pastille vide, pas d'espace réservé, pas de gris
 * par défaut. `gray` est un choix ; l'absence n'en est pas un.
 */
export function ColorKeyDot({ colorKey }: { readonly colorKey: string | null | undefined }) {
  const style = colorStyleOrNull(colorKey);
  if (!style) return null;
  return <span aria-hidden="true" className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${style.dot}`} />;
}

/**
 * La barre latérale — la forme retenue côté élève, où chaque occurrence est une
 * ligne haute et où une pastille se perdrait.
 *
 * Rend une classe de bordure gauche, ou la chaîne vide si aucune couleur : le
 * gabarit reste alors STRICTEMENT celui d'avant N1.6A.
 */
export function colorKeyBorderClass(colorKey: string | null | undefined): string {
  const style = colorStyleOrNull(colorKey);
  return style ? `border-l-4 ${style.borderLeft}` : "";
}
