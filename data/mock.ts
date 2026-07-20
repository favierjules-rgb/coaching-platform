import { Apple, Dumbbell, GraduationCap, Target } from "lucide-react";

import type {
  MethodPillar,
  NavLink,
  NewsletterGoalOption,
  Transformation,
} from "@/types";

/**
 * Ancres préfixées par `/` (correctif chantier /programmes, juillet 2026) —
 * indispensable car le Header (voir components/layout/Header.tsx) est
 * partagé par toutes les pages publiques (SiteChrome), pas seulement la
 * home : un simple `#methode` ne fonctionne que si on est déjà sur `/`,
 * alors que `/#methode` navigue d'abord vers la home puis scrolle. Ce
 * comportement est correct même depuis la home elle-même (même chemin,
 * pas de rechargement). "Programmes" reste un lien de page classique
 * (`/programmes`, bibliothèque complète), volontairement pas une ancre.
 */
export const navLinks: NavLink[] = [
  { label: "La méthode", href: "/#methode" },
  { label: "Transformations", href: "/#transformations" },
  { label: "Programmes", href: "/programmes" },
  { label: "Newsletter", href: "/#newsletter" },
];

// Contenu des 4 piliers mis à jour par Jules (20/07/2026) — titres 1 à 3
// inchangés (seules les descriptions ont été fournies), pilier 4 remplacé
// entièrement (nouveau titre « Apprentissage », nouvelle icône, nouveau
// texte) : l'ancien pilier 4 (« Suivi, ajustements et progression »,
// icône TrendingUp) est retiré.
export const methodPillars: MethodPillar[] = [
  {
    icon: Target,
    title: "Analyse du profil",
    description:
      "Bilan complet : morphologie, objectifs, problèmes rencontrés, habitudes. Un chemin construit pour toi.",
  },
  {
    icon: Dumbbell,
    title: "Plan d'entraînement personnalisé",
    description:
      "Un programme sur-mesure, ajustement constant semaine après semaine, adapté à ton planning.",
  },
  {
    icon: Apple,
    title: "Plan nutritionnel adapté",
    description:
      "Une alimentation calibrée pour ton mode de vie : macronutrition, micronutrition, liste de courses, compléments alimentaires.",
  },
  {
    icon: GraduationCap,
    title: "Apprentissage",
    description:
      "Intègre une école : notions d'hypertrophie, RIR, RPE et physiologie de l'entraînement.",
  },
];

export const transformations: Transformation[] = [
  {
    id: "maxime",
    name: "Maxime R.",
    duration: "6 mois",
    goal: "+8 kg de masse musculaire",
    quote:
      "Une vraie structure. J'ai gagné plus de muscle en 6 mois qu'en 3 ans seul en salle.",
  },
  {
    id: "karim",
    name: "Karim B.",
    duration: "4 mois",
    goal: "-10 kg de masse grasse",
    quote:
      "Un suivi constant, des programmes adaptés. Des résultats qui durent dans le temps.",
  },
  {
    id: "thomas",
    name: "Thomas D.",
    duration: "8 mois",
    goal: "72 kg → 80 kg",
    quote:
      "Méthode claire, plan alimentaire facile à suivre. Enfin des résultats durables.",
  },
  {
    id: "julie",
    name: "Julie P.",
    duration: "5 mois",
    goal: "Remise en forme complète",
    quote:
      "Confiance retrouvée, énergie au top et un accompagnement humain du début à la fin.",
  },
];

export const newsletterGoals: NewsletterGoalOption[] = [
  { value: "prise-de-masse", label: "Prise de masse" },
  { value: "perte-de-poids", label: "Perte de poids" },
  { value: "reequilibrage", label: "Rééquilibrage alimentaire" },
  { value: "performance", label: "Performance sportive" },
  { value: "remise-en-forme", label: "Remise en forme" },
];
