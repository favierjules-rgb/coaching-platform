import type { TransformationPhoto } from "@/types";

/**
 * Photos avant/après réelles pour la section Transformations de la page
 * d'accueil (chantier pages publiques, juillet 2026). Sources :
 * brand/transformations/approved/, exportées en WebP dans
 * public/brand/transformations/. Poids relevés visuellement sur chaque
 * photo (superposés sur l'image d'origine) — aucune donnée inventée.
 *
 * Certaines personnes apparaissent avec deux angles (dos + face, ou face +
 * profil) : les deux photos sont conservées comme deux entrées distinctes,
 * conformément à la consigne "toutes les transformations doivent
 * apparaître".
 */
export const transformationPhotos: TransformationPhoto[] = [
  {
    id: "arthur-back",
    name: "Arthur",
    weightBefore: "71 kg",
    weightAfter: "67 kg",
    image: "/brand/transformations/arthur-back.webp",
    alt: "Transformation d'Arthur, vue de dos, de 71 kg à 67 kg",
  },
  {
    id: "corentin-face",
    name: "Corentin",
    weightBefore: "72 kg",
    weightAfter: "80 kg",
    image: "/brand/transformations/corentin-face.webp",
    alt: "Transformation de Corentin, vue de face, de 72 kg à 80 kg",
  },
  {
    id: "florine-back",
    name: "Florine",
    weightBefore: "63 kg",
    weightAfter: "56,8 kg",
    image: "/brand/transformations/florine-back.webp",
    alt: "Transformation de Florine, vue de dos, de 63 kg à 56,8 kg",
  },
  {
    id: "florine-face",
    name: "Florine",
    weightBefore: "63 kg",
    weightAfter: "56,8 kg",
    image: "/brand/transformations/florine-face.webp",
    alt: "Transformation de Florine, vue de face, de 63 kg à 56,8 kg",
  },
  {
    id: "francois-back",
    name: "François",
    weightBefore: "56 kg",
    weightAfter: "60 kg",
    image: "/brand/transformations/francois-back.webp",
    alt: "Transformation de François, vue de dos, de 56 kg à 60 kg",
  },
  {
    id: "francois-face",
    name: "François",
    weightBefore: "56 kg",
    weightAfter: "60 kg",
    image: "/brand/transformations/francois-face.webp",
    alt: "Transformation de François, vue de face, de 56 kg à 60 kg",
  },
  {
    id: "ftaha-face",
    name: "Ftaha",
    weightBefore: "103 kg",
    weightAfter: "87 kg",
    image: "/brand/transformations/ftaha-face.webp",
    alt: "Transformation de Ftaha, vue de face, de 103 kg à 87 kg",
  },
  {
    id: "marco-back",
    name: "Marco",
    weightBefore: "77 kg",
    weightAfter: "86,7 kg",
    image: "/brand/transformations/marco-back.webp",
    alt: "Transformation de Marco, vue de dos, de 77 kg à 86,7 kg",
  },
  {
    id: "marco-face",
    name: "Marco",
    weightBefore: "77 kg",
    weightAfter: "86,7 kg",
    image: "/brand/transformations/marco-face.webp",
    alt: "Transformation de Marco, vue de face, de 77 kg à 86,7 kg",
  },
  {
    id: "nathalie-face",
    name: "Nathalie",
    weightBefore: "93 kg",
    weightAfter: "83 kg",
    image: "/brand/transformations/nathalie-face.webp",
    alt: "Transformation de Nathalie, vue de face, de 93 kg à 83 kg",
  },
  {
    id: "sebastien-face",
    name: "Sébastien",
    weightBefore: "74 kg",
    weightAfter: "71 kg",
    image: "/brand/transformations/sebastien-face.webp",
    alt: "Transformation de Sébastien, vue de face, de 74 kg à 71 kg",
  },
  {
    id: "sorayya-face",
    name: "Sorayya",
    weightBefore: "75 kg",
    weightAfter: "63,7 kg",
    image: "/brand/transformations/sorayya-face.webp",
    alt: "Transformation de Sorayya, vue de dos, de 75 kg à 63,7 kg",
  },
  {
    id: "sorayya-side",
    name: "Sorayya",
    weightBefore: "75 kg",
    weightAfter: "63,7 kg",
    image: "/brand/transformations/sorayya-side.webp",
    alt: "Transformation de Sorayya, vue de profil, de 75 kg à 63,7 kg",
  },
];
