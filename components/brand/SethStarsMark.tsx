import type { CSSProperties } from "react";

interface SethStarsMarkProps {
  className?: string;
  /**
   * Passthrough optionnel (Groupe 2 — zoom) : permet au composant parent
   * d'appliquer `transformOrigin`/`transform` directement sur le `<svg>`
   * lui-même (nécessaire pour un zoom centré sur un point précis du
   * tracé, exprimé en % du viewBox — cf. MethodStorytelling.tsx). Reste
   * un composant purement présentational : aucune logique ajoutée ici.
   */
  style?: CSSProperties;
  /**
   * "both" (défaut) : les deux étoiles ensemble, viewBox partagé complet
   * — pour un affichage statique assemblé (ex. repli
   * `prefers-reduced-motion`). "A" / "B" : une seule étoile, seule dans
   * son propre viewBox recadré sur sa propre géométrie — pour être animée
   * par un wrapper HTML externe. Important : le composant parent doit
   * appliquer le `transform` sur ce wrapper HTML, PAS sur un élément à
   * l'intérieur du SVG — un transform CSS appliqué à l'intérieur d'un SVG
   * est résolu dans l'espace de coordonnées local du viewBox, donc réduit
   * par le ratio d'échelle du viewBox vers la boîte de rendu (c'est ce qui
   * limitait le déplacement des étoiles à la 1ère correction). Voir
   * `SethStarsIntro.tsx`.
   */
  star?: "both" | "A" | "B";
}

// Tracés extraits de `brand/logo/approved/seth-logo-secondary-grit.svg`
// (fichier fourni par Jules, jamais modifié). Seuls les deux tracés blancs
// `.cls-1` (les étoiles) sont repris ici ; le grand tracé sombre (fond +
// formes négatives du logo complet) est volontairement omis.
const STAR_A_PATH =
  "M211,0h1l1.16,24,2.57,31.01,3.45,35.02,4.75,36.99c.85,6.62,2.24,12.7,3.56,19.12,1.4,6.78,2.34,12.55,5.14,19.08,3.56,8.31,6.05,17.8,12.72,24.45,14.34,14.3,30.38,18.7,48.95,23.98,17.65,5.02,35.2,7.15,53.76,9.45,14,1.74,33.52,2.46,60.97,3.98,2.1.12,3.85.21,5.04.27-.97.27-2.42.63-4.2.95-3.29.59-5.76.66-7.45.73-3.86.16-1.05.19-11.1.82-8.31.52-9.97.49-19.31,1.06-3.69.23-5.53.33-7.37.49-5.96.49-11.74,1.2-17.79,2.14l-45.25,6.99c-14.86,2.29-28.82,7.82-41.68,15.27-10.9,6.32-17.74,15.54-22.28,26.98-5.01,12.64-5.79,25.55-7.55,39.32-3.98,31.19-6.78,61.37-8.47,92.68l-8,147.86c-.13,2.34-.59,4.85-1.29,7.44l-2.98-56.73-4.58-61.34-3.97-60.94-2.3-28.93c-.29-15.64-3.38-30.46-5.71-45.82-1.22-8.04-2.17-15.36-4.92-23.17-3.16-8.98-5.47-18.64-11.99-25.85-16.61-18.37-32.58-20.94-54.11-27.06-13.15-3.74-26.04-4.75-39.81-6.2,0,0-25.35-2.77-58.94-4.17-3.49-.15-4.57-.22-6.73-.37-1.37-.09-2.75-.2-2.75-.2-.06,0-.91-.07-1.77-.14-3.33-.28-5-.42-6.54-.65-1.06-.15-2.61-.42-4.48-.88,3.08-.47,5.21-.67,6.64-.77.3-.02.96-.06,2.02-.14,2.19-.15,3.78-.28,3.9-.28,7.6-.57,30.7-.96,30.7-.96,11.42-.64,22.8-1.59,34.29-2.86,9.31-1.03,17.9-1.67,27.03-4.13,3.62-.98,7.65-2.01,11.75-2.55,19.06-2.54,37.13-8.43,52.83-19.98,13.39-9.85,19.84-25.08,22.84-40.98,1.98-10.52,4.93-20.29,6.31-30.96l5.46-42.08,4.63-52.89L210.96.03l.04-.02Z";

const STAR_B_PATH =
  "M426.86,776.98l-2.4,29.16-1.64-24.14-2.29-27.38-3.86-39.49-4.54-35.15c-.9-6.93-2.3-13.32-3.74-20.09-1.21-5.7-1.71-10.6-4.11-16.13-3.95-9.1-6.3-19.26-13.5-26.71l-10.26-8.45c-10.3-8.48-23.55-11.17-36.24-14.93-18.39-5.45-36.84-7.67-55.96-10.12-19.46-2.49-38.64-2.7-57.93-3.98-2.27-.15-4.95-.35-7.47-1.37,13.76-.07,27.34-1.4,41.41-2.52,6.99-.56,13.53-.82,20.41-1.87l46.27-7.06c15.82-2.41,30.51-7.8,44.17-15.41,11.7-6.51,19.01-16.22,23.62-28.61,4.66-12.52,5.43-25.23,7.18-38.81,3.97-30.87,6.73-60.69,8.36-91.7l7.3-138.5c.32-6.14.61-11.61,1.95-17.83l3.25,60.1,4.35,58.05,4.14,63.91,1.84,21.08c1.53,17.57,3.14,34.41,6.08,51.66,1.31,7.7,1.93,14.78,4.71,22.36,2.99,8.15,4.83,16.64,10.29,23.94,7.17,9.59,17.54,16.65,28.61,21.12,9.34,3.78,18.43,5.67,27.8,8.38,13.37,3.86,26.63,4.72,40.47,6.18,0,0,20.61,2.3,52.18,4.01,4.91.27,7.59.39,7.59.39l3.93.18c2.2.1,2.75.13,3.66.18,1.08.07,2.22.14,3.66.27,1.15.11,2.4.23,3.84.46,1.36.22,3.2.58,5.36,1.22-2.88.16-5.76.31-8.65.47l-6.03.33c-1.14.06-2.28.12-3.42.19-2.1.11-49.64,2.61-63.29,3.96-7.95.78-15.04,1.99-22.98,3.74l-12.1,2.66c-18.39,2.35-35.22,7.9-50.94,18.5-12.25,8.26-20.12,22.05-23.23,36.44l-7.22,33.44-5.91,44.93-4.71,52.94h-.01Z";

// viewBox complet (le logo entier, référence du fichier source).
const VIEWBOX_BOTH = "0 0 636.03 807";
// viewBox recadrés sur la géométrie propre de chaque étoile (bbox exacte
// + 6 unités de marge), calculés par analyse programmatique du tracé —
// permet à chaque étoile de remplir sa propre boîte de rendu.
const VIEWBOX_A = "-5.25 -6 425.32 582.08";
const VIEWBOX_B = "216.92 229.89 424.43 582.25";

/**
 * Marque des deux étoiles SETH (chantier storytelling scroll, juillet 2026).
 * Purement décoratif et présentational : ce composant ne contient aucune
 * logique de scroll ni d'état, et n'applique lui-même aucun transform.
 * `aria-hidden` : jamais annoncé par un lecteur d'écran, jamais focusable.
 */
export function SethStarsMark({ className, style, star = "both" }: SethStarsMarkProps) {
  const viewBox = star === "A" ? VIEWBOX_A : star === "B" ? VIEWBOX_B : VIEWBOX_BOTH;

  return (
    <svg viewBox={viewBox} className={className} style={style} aria-hidden="true" focusable="false">
      {star !== "B" && <path d={STAR_A_PATH} fill="#fff" />}
      {star !== "A" && <path d={STAR_B_PATH} fill="#fff" />}
    </svg>
  );
}
