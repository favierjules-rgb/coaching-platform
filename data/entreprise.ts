import {
  Activity,
  CalendarCheck,
  ClipboardList,
  Dumbbell,
  LineChart,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Contenu éditorial de la page « GRIT Entreprise » (/services-entreprises).
 * Séparé des composants pour rester modifiable sans toucher à la mise en
 * page, et lisible d'un seul endroit.
 *
 * ⚠️ AUCUN TARIF, AUCUN MONTANT, AUCUN CHIFFRE INVENTÉ. Les prix ne sont
 * pas publiés (décision du 13/09/2026) et aucune statistique, aucun
 * témoignage ni aucun résultat client n'est affirmé tant qu'il n'existe pas
 * réellement. Les repères ci-dessous décrivent l'offre — durée d'une
 * séance, fréquences proposées — pas des performances.
 */

export interface CarteEntreprise {
  title: string;
  description: string;
}

export interface CarteAvecIcone extends CarteEntreprise {
  icon: LucideIcon;
}

/** Repères affichés sous le titre du hero — factuels, vérifiables. */
export const REPERES_HERO: readonly { value: string; label: string }[] = [
  { value: "45 min", label: "par séance" },
  { value: "2 ou 3", label: "séances par semaine" },
  { value: "Individuel", label: "un coach par collaborateur" },
];

/** Section « Comment ça marche » — quatre étapes côté entreprise. */
export const ETAPES_DEPLOIEMENT: readonly CarteEntreprise[] = [
  {
    title: "Vous décrivez votre besoin",
    description: "Effectif concerné, fréquence souhaitée, objectifs et échéance.",
  },
  {
    title: "Nous construisons la proposition",
    description: "Une formule adaptée à votre organisation, présentée lors d'un échange.",
  },
  {
    title: "Vos collaborateurs démarrent",
    description: "Bilan individuel, programme personnalisé, créneaux calés sur leur emploi du temps.",
  },
  {
    title: "Vous suivez le déploiement",
    description: "Un point régulier sur l'assiduité et l'avancement de l'accompagnement.",
  },
];

/** Section « Ce que l'entreprise obtient ». */
export const CE_QUE_VOUS_OBTENEZ: readonly CarteAvecIcone[] = [
  {
    icon: UserCheck,
    title: "Coaching individuel",
    description: "Un coach dédié, en face à face, pour chaque collaborateur accompagné.",
  },
  {
    icon: ClipboardList,
    title: "Programme personnalisé",
    description: "Construit à partir du niveau, des contraintes et des objectifs de chacun.",
  },
  {
    icon: LineChart,
    title: "Suivi de la progression",
    description: "Des points d'étape réguliers, et des ajustements au fil de l'accompagnement.",
  },
  {
    icon: Dumbbell,
    title: "Aucune infrastructure",
    description: "Ni salle à aménager, ni matériel à acheter, ni coach à recruter.",
  },
  {
    icon: CalendarCheck,
    title: "Créneaux flexibles",
    description: "Les séances se calent sur les disponibilités réelles de vos équipes.",
  },
];

/** Section « Pour vos collaborateurs » — l'expérience vécue, en cinq jalons. */
export const PARCOURS_COLLABORATEUR: readonly CarteEntreprise[] = [
  { title: "Bilan initial", description: "Niveau, antécédents, objectifs personnels." },
  { title: "Programme personnalisé", description: "Construit pour la personne, pas pour un groupe." },
  { title: "Séances individuelles", description: "45 minutes encadrées, 2 ou 3 fois par semaine." },
  { title: "Suivi des progrès", description: "Les repères évoluent, le programme aussi." },
  { title: "Bilan de fin", description: "Ce qui a changé, et la suite à envisager." },
];

/** Section « Une formule adaptée » — le principe, sans aucun chiffrage. */
export const PRINCIPE_FORMULE: readonly CarteAvecIcone[] = [
  {
    icon: Users,
    title: "Adapté à votre effectif",
    description: "Le dispositif se dimensionne au nombre de collaborateurs concernés.",
  },
  {
    icon: Activity,
    title: "Adapté à votre rythme",
    description: "Deux ou trois séances par semaine, selon l'intensité recherchée.",
  },
  {
    icon: Sparkles,
    title: "Construit avec vous",
    description: "La proposition est établie après un échange, jamais depuis un catalogue.",
  },
];
