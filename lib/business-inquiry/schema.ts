import { z } from "zod";

import {
  firstIncompleteQuestion as firstIncompleteQuestionShared,
  type ProgressiveQuestionsConfig,
} from "@/lib/forms/progressive-questions";

/**
 * Demande de contact « Services aux entreprises » (page publique
 * /services-entreprises) — schéma UNIQUE, partagé par le formulaire client
 * et la route API serveur. Une seule source de vérité : impossible que la
 * validation navigateur et la validation serveur divergent.
 *
 * Aucune donnée n'est stockée en base : la demande part par email au
 * propriétaire (voir lib/business-inquiry/email.ts).
 */

/** Longueurs maximales — bornent la taille du corps de requête et le contenu de l'email. */
export const MAX_LENGTHS = {
  companyName: 120,
  contactName: 120,
  contactRole: 120,
  email: 254,
  phone: 30,
  otherNeed: 120,
  city: 120,
  projectDetails: 2000,
} as const;

export const HEADCOUNT_OPTIONS = [
  { value: "1-10", label: "1 à 10" },
  { value: "11-25", label: "11 à 25" },
  { value: "26-50", label: "26 à 50" },
  { value: "51-100", label: "51 à 100" },
  { value: "100+", label: "Plus de 100" },
  { value: "a-definir", label: "À définir" },
] as const;

export const NEED_OPTIONS = [
  { value: "seances-regulieres", label: "Séances sportives régulières" },
  { value: "prevention-tms", label: "Prévention des TMS ou du mal de dos" },
  { value: "qvt", label: "Qualité de vie au travail et bien-être" },
  { value: "cohesion", label: "Cohésion d'équipe ou team building" },
  { value: "coaching-dirigeants", label: "Coaching de dirigeants" },
  { value: "evenement", label: "Préparation d'un événement" },
  { value: "autre", label: "Autre" },
] as const;

/**
 * Les valeurs restent inchangées (elles voyagent dans l'email et dans les
 * tests) ; seuls les libellés nomment explicitement le présentiel, qui
 * n'apparaissait nulle part alors que c'est le mode d'intervention le plus
 * demandé.
 */
export const FORMAT_OPTIONS = [
  { value: "sur-site", label: "En présentiel, dans vos locaux" },
  { value: "a-distance", label: "À distance, en visio" },
  { value: "hybride", label: "Présentiel et distanciel" },
] as const;

/** Formats qui impliquent un déplacement : la ville devient obligatoire. */
export const FORMATS_REQUIRING_CITY = ["sur-site", "hybride"] as const;

export const headcountValues = HEADCOUNT_OPTIONS.map((o) => o.value);
export const needValues = NEED_OPTIONS.map((o) => o.value);
export const formatValues = FORMAT_OPTIONS.map((o) => o.value);

export type HeadcountValue = (typeof HEADCOUNT_OPTIONS)[number]["value"];
export type NeedValue = (typeof NEED_OPTIONS)[number]["value"];
export type FormatValue = (typeof FORMAT_OPTIONS)[number]["value"];

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
    // Q1 — entreprise
    companyName: trimmed(MAX_LENGTHS.companyName).min(1, "Indiquez le nom de votre entreprise."),

    // Q2 — contact
    contactName: trimmed(MAX_LENGTHS.contactName).min(2, "Indiquez le nom et le prénom du contact."),
    contactRole: trimmed(MAX_LENGTHS.contactRole).min(2, "Indiquez la fonction dans l'entreprise."),

    // Q3 — coordonnées
    email: trimmed(MAX_LENGTHS.email).email("Indiquez une adresse email professionnelle valide."),
    phone: trimmed(MAX_LENGTHS.phone)
      .regex(/^[+()\d\s.-]*$/, "Le téléphone ne doit contenir que des chiffres et des séparateurs.")
      .optional()
      .or(z.literal("")),

    // Q4 — effectif
    headcount: z.enum(headcountValues as [string, ...string[]], {
      message: "Sélectionnez l'effectif concerné.",
    }),

    // Q5 — besoins (au moins un)
    needs: z
      .array(z.enum(needValues as [string, ...string[]]))
      .min(1, "Sélectionnez au moins un besoin.")
      .max(needValues.length),
    otherNeed: trimmed(MAX_LENGTHS.otherNeed).optional().or(z.literal("")),

    // Q6 — format et localisation
    format: z.enum(formatValues as [string, ...string[]], {
      message: "Sélectionnez un format d'accompagnement.",
    }),
    city: trimmed(MAX_LENGTHS.city).optional().or(z.literal("")),

    // Q7 — détails
    projectDetails: trimmed(MAX_LENGTHS.projectDetails).optional().or(z.literal("")),

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
    // Ville obligatoire dès qu'une intervention physique est prévue.
    if (
      (FORMATS_REQUIRING_CITY as readonly string[]).includes(data.format) &&
      (!data.city || data.city.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["city"],
        message: "Indiquez la ville ou la zone géographique de l'intervention.",
      });
    }
    // « Autre » coché : la précision devient obligatoire.
    if (data.needs.includes("autre") && (!data.otherNeed || data.otherNeed.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["otherNeed"],
        message: "Précisez votre besoin.",
      });
    }
  });

export type BusinessInquiryInput = z.infer<typeof businessInquirySchema>;

/* ─────────────── Progression du questionnaire ─────────────── */

/**
 * Champs rattachés à chacune des sept questions, dans l'ordre d'affichage.
 * Sert au dévoilement progressif : une question n'apparaît qu'une fois la
 * précédente valide.
 */
export const QUESTION_FIELDS: readonly (readonly string[])[] = [
  ["companyName"], // 1 — entreprise
  ["contactName", "contactRole"], // 2 — contact
  ["email", "phone"], // 3 — coordonnées
  ["headcount"], // 4 — effectif
  ["needs", "otherNeed"], // 5 — besoins
  ["format", "city"], // 6 — format et lieu
  ["projectDetails"], // 7 — détails (facultatif)
] as const;

export const QUESTION_COUNT = QUESTION_FIELDS.length;

/**
 * Configuration de progression de CE questionnaire. La mécanique elle-même
 * vit dans `lib/forms/progressive-questions.ts`, partagée avec les autres
 * formulaires progressifs — comportement strictement identique, seule la
 * description des questions change.
 *
 * Les champs facultatifs (téléphone, détails du projet) ne produisent aucune
 * erreur lorsqu'ils sont vides : ils ne bloquent donc pas la progression. La
 * ville, elle, retient la question 6 tant qu'un format en présentiel est
 * choisi sans localisation — c'est la règle du schéma.
 */
const progressionConfig: ProgressiveQuestionsConfig = {
  schema: businessInquirySchema,
  questionFields: QUESTION_FIELDS,
  // Le consentement n'appartient à aucune question et se coche en dernier.
  neutralize: { privacyAccepted: true },
};

/**
 * Numéro (1-indexé) de la première question encore incomplète, ou
 * `QUESTION_COUNT + 1` si toutes le sont.
 */
export function firstIncompleteQuestion(values: unknown): number {
  return firstIncompleteQuestionShared(values, progressionConfig);
}

/** Les sept questions sont-elles toutes remplies ? (Le consentement est à part.) */
export function allQuestionsComplete(values: unknown): boolean {
  return firstIncompleteQuestion(values) > QUESTION_COUNT;
}

/** Libellé lisible d'une valeur d'option — utilisé dans l'email reçu. */
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
