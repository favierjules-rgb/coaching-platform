import { z } from "zod";

import {
  firstIncompleteQuestion as firstIncompleteQuestionShared,
  type ProgressiveQuestionsConfig,
} from "@/lib/forms/progressive-questions";

/**
 * Demande de devis « GRIT Entreprise » (page publique /services-entreprises)
 * — schéma UNIQUE, partagé par le configurateur client et la route API
 * serveur. Une seule source de vérité : impossible que la validation
 * navigateur et la validation serveur divergent.
 *
 * ════════════════════════════════════════════════════════════════════════
 * CE QUESTIONNAIRE QUALIFIE UN PROJET, IL NE CHIFFRE RIEN
 * ════════════════════════════════════════════════════════════════════════
 * Décision commerciale du 13/09/2026 : aucun montant n'est publié sur le
 * site. Le prix se discute pendant l'appel. Ce fichier ne contient donc
 * AUCUN tarif, AUCUNE devise et AUCUN calcul — et n'en contiendra jamais :
 * `scripts/tests/configurateur-entreprise.mts` balaie ce périmètre et
 * échoue si un montant, un symbole monétaire ou une logique de facturation
 * y réapparaît.
 *
 * Aucune donnée n'est stockée en base : la demande part par email au
 * propriétaire (voir lib/business-inquiry/email.ts), qui prépare l'appel
 * avec ces éléments.
 *
 * ⚠️ ORDRE DES ÉTAPES : L'INTÉRÊT D'ABORD, L'IDENTITÉ EN DERNIER.
 * La version précédente demandait le nom de l'entreprise, puis le nom du
 * contact, puis l'email — trois questions administratives avant que le
 * prospect ait rien construit. Les cinq premières étapes ne réclament
 * désormais aucune donnée personnelle ; le contact n'arrive qu'une fois le
 * projet configuré.
 */

/** Longueurs maximales — bornent la taille du corps de requête et le contenu de l'email. */
export const MAX_LENGTHS = {
  companyName: 120,
  contactName: 120,
  contactRole: 120,
  email: 254,
  phone: 30,
  otherObjective: 120,
  city: 120,
  projectDetails: 2000,
} as const;

/**
 * Tranches d'effectif. Ce sont des TRANCHES, jamais un nombre exploitable
 * pour un calcul : la granularité exacte se précise pendant l'appel.
 */
export const HEADCOUNT_OPTIONS = [
  { value: "1-4", label: "1 à 4" },
  { value: "5-9", label: "5 à 9" },
  { value: "10-19", label: "10 à 19" },
  { value: "20-49", label: "20 à 49" },
  { value: "50+", label: "50 et plus" },
] as const;

export const FREQUENCY_OPTIONS = [
  { value: "2-seances", label: "2 séances par semaine" },
  { value: "3-seances", label: "3 séances par semaine" },
  { value: "a-definir", label: "À définir ensemble" },
] as const;

export const OBJECTIVE_OPTIONS = [
  { value: "bien-etre", label: "Bien-être" },
  { value: "condition-physique", label: "Condition physique" },
  { value: "prevention-sante", label: "Prévention et santé" },
  { value: "cohesion", label: "Cohésion d'équipe" },
  { value: "avantage-salarie", label: "Avantage salarié" },
  { value: "performance", label: "Performance" },
] as const;

export const SECTOR_OPTIONS = [
  { value: "btp", label: "BTP et construction" },
  { value: "commerce", label: "Commerce" },
  { value: "services", label: "Services" },
  { value: "industrie", label: "Industrie et logistique" },
  { value: "sante", label: "Santé" },
  { value: "tertiaire", label: "Tertiaire et bureaux" },
  { value: "autre", label: "Autre" },
] as const;

export const TIMELINE_OPTIONS = [
  { value: "des-que-possible", label: "Dès que possible" },
  { value: "1-mois", label: "Dans 1 mois" },
  { value: "2-3-mois", label: "Dans 2 à 3 mois" },
  { value: "plus-tard", label: "Plus tard" },
] as const;

/**
 * Lieu des séances — FACULTATIF.
 *
 * ⚠️ LES TROIS VALEURS HISTORIQUES SONT CONSERVÉES TELLES QUELLES
 * (`sur-site`, `a-distance`, `hybride`) : elles voyagent dans les emails
 * déjà reçus et dans deux suites de tests. Seuls les libellés changent, et
 * `salle-partenaire` s'ajoute pour porter le mode d'intervention principal.
 * Renommer aurait cassé l'historique sans rien apporter.
 */
export const LOCATION_OPTIONS = [
  { value: "salle-partenaire", label: "En salle de sport partenaire" },
  { value: "sur-site", label: "Dans nos locaux" },
  { value: "a-distance", label: "À distance, en visio" },
  { value: "hybride", label: "Les deux" },
] as const;

/** Lieux qui impliquent un déplacement : la ville devient obligatoire. */
export const LOCATIONS_REQUIRING_CITY = ["sur-site", "hybride"] as const;

export const headcountValues = HEADCOUNT_OPTIONS.map((o) => o.value);
export const frequencyValues = FREQUENCY_OPTIONS.map((o) => o.value);
export const objectiveValues = OBJECTIVE_OPTIONS.map((o) => o.value);
export const sectorValues = SECTOR_OPTIONS.map((o) => o.value);
export const timelineValues = TIMELINE_OPTIONS.map((o) => o.value);
export const locationValues = LOCATION_OPTIONS.map((o) => o.value);

export type HeadcountValue = (typeof HEADCOUNT_OPTIONS)[number]["value"];
export type FrequencyValue = (typeof FREQUENCY_OPTIONS)[number]["value"];
export type ObjectiveValue = (typeof OBJECTIVE_OPTIONS)[number]["value"];
export type SectorValue = (typeof SECTOR_OPTIONS)[number]["value"];
export type TimelineValue = (typeof TIMELINE_OPTIONS)[number]["value"];
export type LocationValue = (typeof LOCATION_OPTIONS)[number]["value"];

/**
 * `trim()` systématique avant validation : un champ rempli d'espaces est vide.
 *
 * Le message de dépassement est explicite et EN FRANÇAIS : sans lui, Zod
 * renvoie son texte par défaut en anglais, qui s'afficherait tel quel sous
 * le champ concerné.
 */
const trimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Ce champ est limité à ${max.toLocaleString("fr-FR")} caractères.`);

export const businessInquirySchema = z
  .object({
    // Étape 1 — effectif
    headcount: z.enum(headcountValues as [string, ...string[]], {
      message: "Sélectionnez le nombre de collaborateurs concernés.",
    }),

    // Étape 2 — fréquence
    frequency: z.enum(frequencyValues as [string, ...string[]], {
      message: "Sélectionnez une fréquence de séances.",
    }),

    // Étape 3 — objectifs (au moins un, plusieurs possibles)
    objectives: z
      .array(z.enum(objectiveValues as [string, ...string[]]))
      .min(1, "Sélectionnez au moins un objectif.")
      .max(objectiveValues.length),

    // Étape 4 — secteur
    sector: z.enum(sectorValues as [string, ...string[]], {
      message: "Sélectionnez votre secteur d'activité.",
    }),

    // Étape 5 — échéance
    timeline: z.enum(timelineValues as [string, ...string[]], {
      message: "Indiquez quand vous souhaitez démarrer.",
    }),

    // Étape 6 — projet (entièrement facultative)
    projectDetails: trimmed(MAX_LENGTHS.projectDetails).optional().or(z.literal("")),
    location: z
      .enum(locationValues as [string, ...string[]])
      .optional()
      .or(z.literal("")),
    city: trimmed(MAX_LENGTHS.city).optional().or(z.literal("")),

    // Étape 7 — contact
    companyName: trimmed(MAX_LENGTHS.companyName).min(1, "Indiquez le nom de votre entreprise."),
    contactName: trimmed(MAX_LENGTHS.contactName).min(2, "Indiquez le nom et le prénom du contact."),
    contactRole: trimmed(MAX_LENGTHS.contactRole).min(2, "Indiquez votre fonction dans l'entreprise."),
    email: trimmed(MAX_LENGTHS.email).email("Indiquez une adresse email professionnelle valide."),
    phone: trimmed(MAX_LENGTHS.phone)
      .regex(/^[+()\d\s.-]*$/, "Le téléphone ne doit contenir que des chiffres et des séparateurs.")
      .optional()
      .or(z.literal("")),

    // Consentement (case distincte, obligatoire)
    privacyAccepted: z.literal(true, {
      message: "Merci d'accepter l'utilisation de vos informations pour traiter votre demande.",
    }),

    /**
     * Piège à robots : champ masqué, jamais rempli par un humain. Toujours
     * accepté par le schéma — c'est la route qui décide quoi en faire, afin
     * de renvoyer une réponse NEUTRE plutôt qu'une erreur de validation qui
     * apprendrait au robot comment passer.
     */
    website: z.string().max(200).optional().or(z.literal("")),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Ville obligatoire dès qu'un déplacement est demandé — et seulement
    // alors : le lieu lui-même reste facultatif.
    if (
      data.location &&
      (LOCATIONS_REQUIRING_CITY as readonly string[]).includes(data.location) &&
      (!data.city || data.city.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["city"],
        message: "Indiquez la ville ou la zone géographique de l'intervention.",
      });
    }
  });

export type BusinessInquiryInput = z.infer<typeof businessInquirySchema>;

/* ─────────────── Progression du configurateur ─────────────── */

/**
 * Champs rattachés à chacune des sept étapes, dans l'ordre d'affichage.
 *
 * ⚠️ LES CINQ PREMIÈRES ÉTAPES NE DEMANDENT AUCUNE DONNÉE PERSONNELLE.
 * C'est le cœur du parcours : le prospect construit son projet avant de se
 * déclarer. L'étape 6 est entièrement facultative — elle ne bloque donc
 * jamais la progression.
 */
export const STEP_FIELDS: readonly (readonly string[])[] = [
  ["headcount"], // 1 — combien de collaborateurs
  ["frequency"], // 2 — à quelle fréquence
  ["objectives"], // 3 — quels objectifs
  ["sector"], // 4 — quel secteur
  ["timeline"], // 5 — quelle échéance
  ["projectDetails", "location", "city"], // 6 — le projet (facultatif)
  ["companyName", "contactName", "contactRole", "email", "phone"], // 7 — contact
] as const;

export const STEP_COUNT = STEP_FIELDS.length;

/** Dernière étape : celle qui porte les coordonnées et déclenche l'envoi. */
export const CONTACT_STEP = STEP_COUNT;

/**
 * Configuration de progression de CE questionnaire. La mécanique elle-même
 * vit dans `lib/forms/progressive-questions.ts`, partagée avec les autres
 * formulaires progressifs du site — comportement strictement identique,
 * seule la description des étapes change.
 */
const progressionConfig: ProgressiveQuestionsConfig = {
  schema: businessInquirySchema,
  // La brique partagée nomme ses groupes « questions » ; ici ce sont des
  // ÉTAPES (un écran chacune). Même structure, vocabulaire local différent.
  questionFields: STEP_FIELDS,
  // Le consentement n'appartient à aucune étape et se coche en dernier.
  neutralize: { privacyAccepted: true },
};

/**
 * Numéro (1-indexé) de la première étape encore incomplète, ou
 * `STEP_COUNT + 1` si toutes le sont.
 */
export function firstIncompleteStep(values: unknown): number {
  return firstIncompleteQuestionShared(values, progressionConfig);
}

/** L'étape `step` est-elle remplie ? */
export function isStepComplete(values: unknown, step: number): boolean {
  return firstIncompleteStep(values) > step;
}

/** Les sept étapes sont-elles toutes remplies ? (Le consentement est à part.) */
export function allStepsComplete(values: unknown): boolean {
  return firstIncompleteStep(values) > STEP_COUNT;
}

/** Libellé lisible d'une valeur d'option — utilisé au récapitulatif et dans l'email. */
export function labelFor(
  options: readonly { value: string; label: string }[],
  value: string,
): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** `true` si le honeypot a été rempli : soumission automatisée. */
export function looksAutomated(input: { website?: string }): boolean {
  return Boolean(input.website && input.website.trim().length > 0);
}
