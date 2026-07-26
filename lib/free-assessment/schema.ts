import { z } from "zod";

import {
  firstIncompleteQuestion as firstIncompleteQuestionShared,
  type ProgressiveQuestionsConfig,
} from "@/lib/forms/progressive-questions";

/**
 * Demande de « Mon bilan offert » (section de la page d'accueil) — schéma
 * UNIQUE, partagé par le formulaire client et la route API serveur. Une
 * seule source de vérité : impossible que la validation navigateur et la
 * validation serveur divergent, et la progression du questionnaire en est
 * elle-même déduite.
 *
 * Aucune donnée n'est stockée en base : la demande part par email au coach
 * (voir lib/free-assessment/email.ts).
 */

/** Longueurs maximales — bornent la taille du corps de requête et le contenu de l'email. */
export const MAX_LENGTHS = {
  lastName: 80,
  firstName: 80,
  phone: 30,
  email: 254,
  otherGoal: 160,
  frustration: 1500,
} as const;

/** Longueur minimale de la frustration : en dessous, la réponse n'apprend rien. */
export const MIN_FRUSTRATION_LENGTH = 20;

export const GOAL_OPTIONS = [
  { value: "perte-de-poids", label: "Perdre du poids" },
  { value: "prise-de-muscle", label: "Prendre du muscle" },
  { value: "remise-en-forme", label: "Me remettre en forme" },
  { value: "performance", label: "Améliorer mes performances sportives" },
  { value: "energie-sante", label: "Retrouver de l'énergie et améliorer ma santé" },
  { value: "reprise", label: "Reprendre après une blessure ou une période d'arrêt" },
  { value: "autre", label: "Autre" },
] as const;

export const goalValues = GOAL_OPTIONS.map((o) => o.value);
export type GoalValue = (typeof GOAL_OPTIONS)[number]["value"];

/** `trim()` systématique : un champ rempli d'espaces est vide. Message de dépassement en français. */
const trimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Ce champ est limité à ${max.toLocaleString("fr-FR")} caractères.`);

/**
 * Un nom ou prénom : lettres (accentuées comprises), espaces, apostrophes et
 * traits d'union. Volontairement permissif sur les alphabets — refuser un nom
 * légitime est bien pire que d'accepter une saisie fantaisiste, que le coach
 * verra de toute façon.
 */
const NAME_PATTERN = /^[\p{L}][\p{L}\p{M}\s'’-]*$/u;

/**
 * Téléphone : formats français et internationaux courants. On tolère les
 * séparateurs habituels (espaces, points, tirets, parenthèses) et le préfixe
 * `+`, puis on compte les CHIFFRES — c'est le seul critère fiable, un numéro
 * français en fait 10, un international entre 8 et 15 (recommandation UIT
 * E.164).
 */
const PHONE_ALLOWED = /^\+?[\d\s.\-()]+$/;

export function countPhoneDigits(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

/**
 * Nettoie un numéro avant envoi : espaces multiples réduits, séparateurs
 * conservés tels quels (le coach doit lire le numéro comme la personne l'a
 * écrit). Aucune reformulation hasardeuse en E.164 : sans indicatif pays
 * fiable, une « normalisation » produirait un numéro faux.
 */
export function normalizePhone(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const freeAssessmentSchema = z
  .object({
    // Q1 — nom
    lastName: trimmed(MAX_LENGTHS.lastName)
      .min(2, "Indique ton nom.")
      .regex(NAME_PATTERN, "Ce nom contient des caractères inattendus."),

    // Q2 — prénom
    firstName: trimmed(MAX_LENGTHS.firstName)
      .min(2, "Indique ton prénom.")
      .regex(NAME_PATTERN, "Ce prénom contient des caractères inattendus."),

    // Q3 — téléphone
    phone: trimmed(MAX_LENGTHS.phone)
      .min(1, "Indique ton numéro de téléphone.")
      .regex(PHONE_ALLOWED, "Ce numéro contient des caractères inattendus.")
      .refine((value) => countPhoneDigits(value) >= 8, "Ce numéro semble incomplet.")
      .refine((value) => countPhoneDigits(value) <= 15, "Ce numéro comporte trop de chiffres.")
      .transform(normalizePhone),

    // Q4 — email
    email: trimmed(MAX_LENGTHS.email)
      .toLowerCase()
      .pipe(z.string().email("Indique une adresse email valide.")),

    // Q5 — objectif principal
    goal: z.enum(goalValues as [string, ...string[]], {
      message: "Sélectionne ton objectif principal.",
    }),
    otherGoal: trimmed(MAX_LENGTHS.otherGoal).optional().or(z.literal("")),

    // Q6 — frustration
    frustration: trimmed(MAX_LENGTHS.frustration).min(
      MIN_FRUSTRATION_LENGTH,
      `Décris ta situation en ${MIN_FRUSTRATION_LENGTH} caractères au minimum.`,
    ),

    // Consentement (case distincte, obligatoire, jamais précochée)
    privacyAccepted: z.literal(true, {
      message: "Merci d'accepter d'être recontacté pour ta demande de bilan.",
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
    // « Autre » choisi : la précision devient obligatoire.
    if (data.goal === "autre" && (!data.otherGoal || data.otherGoal.trim().length === 0)) {
      ctx.addIssue({
        code: "custom",
        path: ["otherGoal"],
        message: "Précise ton objectif.",
      });
    }
  });

export type FreeAssessmentInput = z.infer<typeof freeAssessmentSchema>;

/* ─────────────── Progression du questionnaire ─────────────── */

/** Champs rattachés à chacune des six questions, dans l'ordre d'affichage. */
export const QUESTION_FIELDS: readonly (readonly string[])[] = [
  ["lastName"], // 1 — nom
  ["firstName"], // 2 — prénom
  ["phone"], // 3 — téléphone
  ["email"], // 4 — email
  ["goal", "otherGoal"], // 5 — objectif (+ précision si « Autre »)
  ["frustration"], // 6 — frustration
] as const;

export const QUESTION_COUNT = QUESTION_FIELDS.length;

const progressionConfig: ProgressiveQuestionsConfig = {
  schema: freeAssessmentSchema,
  questionFields: QUESTION_FIELDS,
  // Le consentement n'appartient à aucune question et se coche en dernier.
  neutralize: { privacyAccepted: true },
};

/** Numéro (1-indexé) de la première question encore incomplète. */
export function firstIncompleteQuestion(values: unknown): number {
  return firstIncompleteQuestionShared(values, progressionConfig);
}

/** Les six questions sont-elles toutes remplies ? (Le consentement est à part.) */
export function allQuestionsComplete(values: unknown): boolean {
  return firstIncompleteQuestion(values) > QUESTION_COUNT;
}

/** Libellé lisible d'une valeur d'option — utilisé dans l'email reçu. */
export function labelFor(options: readonly { value: string; label: string }[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** `true` si le honeypot a été rempli : soumission automatisée. */
export function looksAutomated(input: { website?: string }): boolean {
  return Boolean(input.website && input.website.trim().length > 0);
}
