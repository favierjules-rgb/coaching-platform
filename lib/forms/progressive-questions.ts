import type { ZodType } from "zod";

/**
 * Progression d'un questionnaire dévoilé pas à pas — logique PARTAGÉE par
 * les formulaires progressifs du site (« Services aux entreprises »,
 * « Mon bilan offert »).
 *
 * Extraite du formulaire entreprise en juillet 2026, au moment d'en écrire
 * un second : cette logique tient en quelques lignes mais son point délicat
 * (voir `neutralize` plus bas) a déjà produit un défaut réel. La dupliquer
 * aurait signifié le reproduire, ou pire, laisser les deux versions
 * diverger silencieusement.
 *
 * Principe : la complétude d'une question est DÉDUITE du schéma de
 * validation final, jamais réécrite. Impossible qu'une question soit jugée
 * « remplie » à l'affichage puis refusée à l'envoi.
 */

export interface ProgressiveQuestionsConfig {
  /** Schéma de validation final — le même que celui de la route serveur. */
  schema: ZodType;
  /**
   * Champs rattachés à chaque question, dans l'ordre d'affichage. Un champ
   * n'appartient qu'à une seule question.
   */
  questionFields: readonly (readonly string[])[];
  /**
   * Valeurs forcées avant l'évaluation, pour les champs qui NE font pas
   * partie des questions — typiquement le consentement.
   *
   * Sans cela, un champ obligatoire renseigné en dernier (`privacyAccepted:
   * z.literal(true)`) fait échouer le schéma au niveau de l'objet, ce qui
   * empêche `superRefine` de s'exécuter : les règles conditionnelles
   * (« précise ton objectif » quand « Autre » est choisi, par exemple) ne
   * sont alors jamais évaluées pendant la progression, et ces questions
   * passent à tort pour remplies. Défaut observé en validation live sur le
   * formulaire entreprise, corrigé ici pour tous.
   */
  neutralize?: Record<string, unknown>;
}

/**
 * Numéro (1-indexé) de la première question encore incomplète, ou
 * `questionFields.length + 1` si toutes le sont.
 */
export function firstIncompleteQuestion(
  values: unknown,
  { schema, questionFields, neutralize }: ProgressiveQuestionsConfig,
): number {
  const total = questionFields.length;
  const pourEvaluation =
    neutralize && typeof values === "object" && values !== null ? { ...values, ...neutralize } : values;

  const result = schema.safeParse(pourEvaluation);
  if (result.success) return total + 1;

  const champsEnErreur = new Set(result.error.issues.map((issue) => String(issue.path[0])));
  for (let index = 0; index < total; index += 1) {
    if (questionFields[index].some((champ) => champsEnErreur.has(champ))) return index + 1;
  }
  return total + 1;
}

/** Toutes les questions sont-elles remplies ? (Le consentement est à part.) */
export function allQuestionsComplete(values: unknown, config: ProgressiveQuestionsConfig): boolean {
  return firstIncompleteQuestion(values, config) > config.questionFields.length;
}
