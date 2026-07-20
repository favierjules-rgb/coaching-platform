import type { TransformationPhoto } from "@/types";

/**
 * Photos avant/après réelles pour la section Transformations de la page
 * d'accueil (chantier pages publiques, juillet 2026 — photos et témoignages
 * mis à jour par Jules le 20/07/2026). Sources : brand/transformations/approved/
 * (collages avant/après complets, une photo = les deux moments côte à côte),
 * exportées en WebP dans public/brand/transformations/. Poids et témoignages
 * fournis directement par Jules — aucune donnée inventée.
 *
 * Certaines personnes apparaissent avec deux photos (deux séances de prises
 * de vue distinctes) : les deux entrées sont conservées, avec le même poids
 * et le même témoignage sur les deux, conformément à la consigne "toutes les
 * transformations doivent apparaître".
 */
export const transformationPhotos: TransformationPhoto[] = [
  {
    id: "arthur",
    name: "Arthur",
    weightBefore: "71 kg",
    weightAfter: "67 kg",
    quote:
      "Compétiteur en force athlétique ayant une mauvaise gestion de la fatigue et de l'intensité, un plan d'entraînement adapté à ses besoins lui a permis de devenir plus compétitif. Puis un changement d'objectifs en vue, en hypertrophie et en sport d'endurance : on a dû adapter et changer le plan pour qu'il puisse continuer à progresser.",
    image: "/brand/transformations/arthur.webp",
    alt: "Transformation d'Arthur, avant/après, de 71 kg à 67 kg",
  },
  {
    id: "corentin-1",
    name: "Corentin",
    weightBefore: "72 kg",
    weightAfter: "80 kg",
    quote:
      "« Après une grosse opération de l'épaule je voulais reprendre confiance en moi et prendre du muscle pour ne plus me sentir fragile de l'épaule. »",
    image: "/brand/transformations/corentin-1.webp",
    alt: "Transformation de Corentin, avant/après, de 72 kg à 80 kg",
  },
  {
    id: "corentin-2",
    name: "Corentin",
    weightBefore: "72 kg",
    weightAfter: "80 kg",
    quote:
      "« Après une grosse opération de l'épaule je voulais reprendre confiance en moi et prendre du muscle pour ne plus me sentir fragile de l'épaule. »",
    image: "/brand/transformations/corentin-2.webp",
    alt: "Transformation de Corentin, avant/après, de 72 kg à 80 kg",
  },
  {
    id: "florine-1",
    name: "Florine",
    weightBefore: "63 kg",
    weightAfter: "56,8 kg",
    quote:
      "Après une grosse prise de poids durant la grossesse, Florine avait besoin de reprendre confiance en elle. Après 10 kg perdus, c'est réussi. Témoignage vidéo sur la page Instagram.",
    image: "/brand/transformations/florine-1.webp",
    alt: "Transformation de Florine, avant/après, de 63 kg à 56,8 kg",
  },
  {
    id: "florine-2",
    name: "Florine",
    weightBefore: "63 kg",
    weightAfter: "56,8 kg",
    quote:
      "Après une grosse prise de poids durant la grossesse, Florine avait besoin de reprendre confiance en elle. Après 10 kg perdus, c'est réussi. Témoignage vidéo sur la page Instagram.",
    image: "/brand/transformations/florine-2.webp",
    alt: "Transformation de Florine, avant/après, de 63 kg à 56,8 kg",
  },
  {
    id: "francois-1",
    name: "François",
    weightBefore: "56 kg",
    weightAfter: "60 kg",
    quote:
      "Un père qui s'est laissé aller avec le temps, 40 ans, un besoin vital de reprendre les choses en main. Témoignage vidéo sur la page Instagram.",
    image: "/brand/transformations/francois-1.webp",
    alt: "Transformation de François, avant/après, de 56 kg à 60 kg",
  },
  {
    id: "francois-2",
    name: "François",
    weightBefore: "56 kg",
    weightAfter: "60 kg",
    quote:
      "Un père qui s'est laissé aller avec le temps, 40 ans, un besoin vital de reprendre les choses en main. Témoignage vidéo sur la page Instagram.",
    image: "/brand/transformations/francois-2.webp",
    alt: "Transformation de François, avant/après, de 56 kg à 60 kg",
  },
  {
    id: "ftaha",
    name: "Ftaha",
    weightBefore: "103 kg",
    weightAfter: "87 kg",
    quote:
      "Une maman qui ne savait pas gérer son alimentation : une transformation à la hauteur de l'investissement.",
    image: "/brand/transformations/ftaha.webp",
    alt: "Transformation de Ftaha, avant/après, de 103 kg à 87 kg",
  },
  {
    id: "marco",
    name: "Marco",
    weightBefore: "77 kg",
    weightAfter: "86,7 kg",
    quote:
      "Objectif clair : prendre beaucoup de masse musculaire, plus de 9 kg en 6 mois.",
    image: "/brand/transformations/marco.webp",
    alt: "Transformation de Marco, avant/après, de 77 kg à 86,7 kg",
  },
  {
    id: "nathalie",
    name: "Nathalie",
    weightBefore: "93 kg",
    weightAfter: "83 kg",
    quote:
      "Atteinte de la maladie d'Hashimoto, après avoir tout essayé (régime, sport), rien ne fonctionnait. À la fin, c'est quasiment 11 kg de perdus : un plan d'entraînement structuré, une alimentation équilibrée et adaptée à son hypothyroïdie.",
    image: "/brand/transformations/nathalie.webp",
    alt: "Transformation de Nathalie, avant/après, de 93 kg à 83 kg",
  },
  {
    id: "sebastien",
    name: "Sébastien",
    weightBefore: "74 kg",
    weightAfter: "71 kg",
    quote:
      "Résultat hallucinant en 4 mois. « Honnêtement Jules, tu me demandais si je voulais prendre encore de la masse, je ne pensais y arriver aussi rapidement, mais je crois bien avoir atteint mon physique idéal. »",
    image: "/brand/transformations/sebastien.webp",
    alt: "Transformation de Sébastien, avant/après, de 74 kg à 71 kg",
  },
  {
    id: "sorayya-1",
    name: "Sorayya",
    weightBefore: "75 kg",
    weightAfter: "63,7 kg",
    quote:
      "L'objectif était de faire sa première course Hyrox, et pour performer on a dû perdre beaucoup de poids : plus de 10 kg perdus en 6 mois, 2 Hyrox solo, une programmation adaptée pour performer. Bravo à elle !",
    image: "/brand/transformations/sorayya-1.webp",
    alt: "Transformation de Sorayya, avant/après, de 75 kg à 63,7 kg",
  },
  {
    id: "sorayya-2",
    name: "Sorayya",
    weightBefore: "75 kg",
    weightAfter: "63,7 kg",
    quote:
      "L'objectif était de faire sa première course Hyrox, et pour performer on a dû perdre beaucoup de poids : plus de 10 kg perdus en 6 mois, 2 Hyrox solo, une programmation adaptée pour performer. Bravo à elle !",
    image: "/brand/transformations/sorayya-2.webp",
    alt: "Transformation de Sorayya, avant/après, de 75 kg à 63,7 kg",
  },
  {
    id: "achraf",
    name: "Achraf",
    weightBefore: "80 kg",
    weightAfter: "72 kg",
    quote:
      "Papa et planning super chargé : hiérarchiser les besoins était primordial pour gagner du temps.",
    image: "/brand/transformations/achraf.webp",
    alt: "Transformation d'Achraf, avant/après, de 80 kg à 72 kg",
  },
  {
    id: "jules",
    name: "Jules",
    weightBefore: "67 kg",
    weightAfter: "85 kg",
    quote:
      "Le coach en charge de toutes ces transformations : un coach qui applique sa méthodologie et qui suit ses propres conseils. Il faut être exemplaire avant de pouvoir donner des leçons.",
    image: "/brand/transformations/jules.webp",
    alt: "Transformation de Jules, coach, avant/après, de 67 kg à 85 kg",
  },
];
