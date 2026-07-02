import { Apple, Dumbbell, Target, TrendingUp } from "lucide-react";

import type {
  MethodPillar,
  NavLink,
  NewsletterGoalOption,
  Transformation,
} from "@/types";

export const navLinks: NavLink[] = [
  { label: "La méthode", href: "#methode" },
  { label: "Transformations", href: "#transformations" },
  { label: "Newsletter", href: "#newsletter" },
];

export const methodPillars: MethodPillar[] = [
  {
    icon: Target,
    title: "Analyse du profil",
    description:
      "Bilan complet : morphologie, objectifs, historique sportif et préférences alimentaires. Chaque plan part de toi.",
  },
  {
    icon: Dumbbell,
    title: "Plan d'entraînement personnalisé",
    description:
      "Un programme sur-mesure, semaine après semaine, adapté à ton matériel, ton niveau et ton emploi du temps.",
  },
  {
    icon: Apple,
    title: "Plan nutritionnel adapté",
    description:
      "Une alimentation calibrée pour ton objectif : macros, repas structurés, liste de courses et conseils du coach.",
  },
  {
    icon: TrendingUp,
    title: "Suivi, ajustements et progression",
    description:
      "Retours réguliers, ajustements en temps réel et photos de progression. Rien n'est laissé au hasard.",
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
