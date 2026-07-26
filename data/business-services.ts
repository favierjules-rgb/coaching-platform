import { Activity, Building2, HeartPulse, ShieldCheck, Sparkles, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Contenu éditorial de la page « Services aux entreprises »
 * (/services-entreprises). Séparé du composant de page pour rester
 * modifiable sans toucher à la mise en page, et testable tel quel — même
 * principe que `data/mock.ts` pour les 4 piliers de la home page.
 *
 * Aucun tarif n'est annoncé : chaque intervention est construite sur mesure
 * et chiffrée après échange.
 */

export interface BusinessCard {
  title: string;
  description: string;
}

export interface BusinessNeed extends BusinessCard {
  icon: LucideIcon;
}

export const BUSINESS_NEEDS: BusinessNeed[] = [
  {
    icon: Activity,
    title: "Activité physique régulière",
    description:
      "Remettre le mouvement dans le quotidien des salariés, avec des séances encadrées en présentiel, adaptées à tous les niveaux.",
  },
  {
    icon: ShieldCheck,
    title: "Prévention des TMS et du mal de dos",
    description:
      "Réduire les troubles musculosquelettiques liés aux postures de travail : renforcement ciblé, mobilité, conseils applicables au poste.",
  },
  {
    icon: HeartPulse,
    title: "Qualité de vie au travail",
    description:
      "Améliorer l'énergie, le sommeil et la gestion du stress de vos équipes par une pratique régulière et des repères concrets.",
  },
  {
    icon: Users,
    title: "Cohésion et événements d'équipe",
    description:
      "Créer des moments collectifs qui rassemblent, à l'occasion d'un séminaire, d'un challenge interne ou d'un temps fort de l'année.",
  },
  {
    icon: Building2,
    title: "Accompagnement des dirigeants",
    description:
      "Un suivi individuel pour les dirigeants et cadres : gestion de la charge, récupération, condition physique malgré un agenda dense.",
  },
  {
    icon: Sparkles,
    title: "Programmes personnalisés",
    description:
      "Chaque entreprise a ses contraintes de lieu, d'horaires et d'effectif : le programme est construit autour des vôtres.",
  },
];

export const BUSINESS_FORMATS: BusinessCard[] = [
  {
    title: "Séances collectives en présentiel",
    description:
      "Un coach sur place, dans vos locaux ou à proximité : des séances encadrées en présentiel, sur le temps de pause ou en fin de journée.",
  },
  {
    title: "Ateliers ponctuels en présentiel",
    description:
      "Un format court sur un thème précis, animé sur site : posture au bureau, réveil musculaire, récupération, nutrition.",
  },
  {
    title: "Programmes réguliers",
    description: "Un accompagnement suivi sur plusieurs semaines, avec progression et ajustements au fil du temps.",
  },
  {
    title: "Coaching individuel de dirigeants",
    description: "Un suivi personnalisé, en présentiel ou à distance, calé sur un agenda exigeant.",
  },
  {
    title: "Accompagnement hybride ou à distance",
    description: "Séances en visio et programmes à suivre en autonomie, pour les équipes réparties sur plusieurs sites.",
  },
  {
    title: "Événements de cohésion",
    description: "Une intervention pensée pour un séminaire, une journée d'équipe ou un challenge sportif interne.",
  },
];

export const BUSINESS_PROCESS_STEPS: BusinessCard[] = [
  {
    title: "Vous décrivez votre besoin",
    description:
      "Quelques questions suffisent : effectif concerné, objectifs, format envisagé et contraintes de votre organisation.",
  },
  {
    title: "Nous échangeons sur le projet",
    description:
      "Je vous recontacte pour préciser le contexte, affiner les objectifs et vérifier la faisabilité logistique.",
  },
  {
    title: "Vous recevez une proposition",
    description:
      "Une proposition d'intervention et un devis adaptés à votre entreprise, sans engagement de votre part.",
  },
];
