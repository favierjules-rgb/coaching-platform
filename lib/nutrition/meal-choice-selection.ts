import {
  solveMealChoices,
  type MealChoiceSolution,
  type MealMacroTarget,
  type SelectedFoodForMealSolver,
} from "@/lib/nutrition/meal-choice-solver";
import type { ChoiceOption, MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";

/**
 * N1.4 — LA COMPOSITION D'UN REPAS PAR L'ÉLÈVE, EN FONCTIONS PURES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'UNE SÉLECTION EST, ET CE QU'ELLE N'EST PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ UNE SÉLECTION DÉSIGNE UNE LIGNE DU SNAPSHOT, PAS UN ALIMENT.
 * `occurrenceId → optionId`, jamais `occurrenceId → alimentId`. Un même repas
 * peut porter « Choix de ta protéine » deux fois, et « Poulet » figurer dans
 * les deux : l'identifiant de l'aliment ne dirait pas laquelle des deux
 * occurrences a été servie. `meal_choice_options.id` le dit, lui, et c'est
 * exactement ce dont N1.5 aura besoin pour calculer les quantités.
 *
 * ⚠️ RIEN ICI N'ÉCRIT NULLE PART. Aucune importation de Supabase, aucune
 * promesse, aucun effet. Choisir un aliment en N1.4 ne crée NI repas consommé,
 * NI entrée, NI repas planifié : c'est un brouillon de composition, tenu en
 * mémoire. Un rafraîchissement le remet à zéro, et c'est assumé pour ce lot —
 * la persistance viendra avec le calcul, pas avant.
 */

/** `occurrenceId → optionId`. Une occurrence, un choix, jamais deux. */
export type SelectionDeChoix = Readonly<Record<string, string>>;

export const AUCUNE_SELECTION: SelectionDeChoix = Object.freeze({});

/**
 * La portée d'un brouillon : CE repas, CE jour.
 *
 * ⚠️ LE JOUR FAIT PARTIE DE LA CLÉ, MÊME SI L'IDENTIFIANT DE REPAS SUFFIRAIT
 * AUJOURD'HUI. Un repas prescrit appartient déjà à un seul jour du plan ; mais
 * le même plan est consulté semaine après semaine, et une composition du lundi
 * 3 n'a rien à faire dans le lundi 10. Nommer la date ici rend la portée
 * explicite plutôt que dépendante d'une propriété du schéma qui pourrait
 * changer.
 */
export function cleDeComposition(mealId: string, date: string | null): string {
  return `${mealId}|${date ?? "sans-date"}`;
}

/**
 * Choisit — ou REMPLACE — l'option d'une occurrence.
 *
 * ⚠️ IL N'Y A JAMAIS DEUX CHOIX ACTIFS POUR UNE OCCURRENCE : la clé est
 * l'occurrence, donc écrire remplace. Et les autres occurrences ne sont pas
 * touchées, ce qui est la garantie d'indépendance demandée.
 */
export function choisirOption(
  selection: SelectionDeChoix,
  slotId: string,
  optionId: string,
): SelectionDeChoix {
  return { ...selection, [slotId]: optionId };
}

/** L'option retenue pour cette occurrence, ou `null`. */
export function optionChoisieId(selection: SelectionDeChoix, slotId: string): string | null {
  return selection[slotId] ?? null;
}

export function estChoisie(selection: SelectionDeChoix, slotId: string): boolean {
  return optionChoisieId(selection, slotId) !== null;
}

/**
 * L'option elle-même, retrouvée DANS le snapshot de cette occurrence.
 *
 * ⚠️ ON CHERCHE DANS `occurrence.options`, ET NULLE PART AILLEURS. Une
 * sélection qui désignerait une option d'une autre occurrence — ou une option
 * disparue du snapshot — rend `null` plutôt qu'un aliment trouvé de travers.
 */
export function optionChoisie(
  occurrence: MealChoiceSlot,
  selection: SelectionDeChoix,
): ChoiceOption | null {
  const id = optionChoisieId(selection, occurrence.id);
  if (id === null) return null;
  return occurrence.options.find((o) => o.optionId === id) ?? null;
}

/**
 * Une option est EXPLOITABLE si son identité a pu être nommée.
 *
 * ⚠️ LE CAS EST EXCEPTIONNEL ET IL EST TRAITÉ, PAS IGNORÉ. Une option dont la
 * source a disparu reste dans le snapshot — on ne la retire pas, le repas doit
 * rester ouvrable — mais on ne la propose pas comme un choix normal : N1.5 ne
 * saurait pas en calculer la quantité, faute de macros à lire. Elle est donc
 * affichée, nommée « Aliment indisponible », et DÉSACTIVÉE.
 */
export function optionExploitable(option: ChoiceOption): boolean {
  return typeof option.optionId === "string" && typeof option.displayName === "string";
}

export interface ProgressionDesChoix {
  readonly total: number;
  readonly choisis: number;
  readonly complet: boolean;
}

/**
 * Combien d'occurrences, combien de choix faits, et si le repas est complet.
 *
 * ⚠️ « COMPLET » EST FAUX SUR UN REPAS SANS OCCURRENCE. Un repas libre n'a rien
 * à compléter : le dire « complet » laisserait croire à N1.5 qu'il y a une
 * composition à calculer là où il n'y en a aucune.
 */
export function progressionDesChoix(
  occurrences: readonly MealChoiceSlot[],
  selection: SelectionDeChoix,
): ProgressionDesChoix {
  const total = occurrences.length;
  const choisis = occurrences.filter((o) => optionChoisie(o, selection) !== null).length;
  return { total, choisis, complet: total > 0 && choisis === total };
}

/**
 * La composition retenue, prête pour N1.5 : une occurrence, son option.
 *
 * Les occurrences non choisies sont ABSENTES — on ne fabrique pas un choix par
 * défaut. L'ordre est celui des occurrences, donc celui du coach.
 */
export interface ChoixResolu {
  readonly slotId: string;
  readonly optionId: string;
  readonly option: ChoiceOption;
}

export function choixResolus(
  occurrences: readonly MealChoiceSlot[],
  selection: SelectionDeChoix,
): readonly ChoixResolu[] {
  const resolus: ChoixResolu[] = [];
  for (const occurrence of occurrences) {
    const option = optionChoisie(occurrence, selection);
    if (option?.optionId) {
      resolus.push({ slotId: occurrence.id, optionId: option.optionId, option });
    }
  }
  return resolus;
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.5 — DU CHOIX AU CALCUL
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Une option est CALCULABLE si ses faits nutritionnels ont pu être hydratés.
 *
 * ⚠️ CE N'EST PAS LA MÊME QUESTION QU'`optionExploitable`. Celle-là demande
 * « peut-on la NOMMER, donc la proposer ? » ; celle-ci demande « peut-on la
 * CALCULER ? ». Elles répondent aujourd'hui ensemble — nom et macros viennent
 * de la même ligne du catalogue, et disparaissent ensemble — mais les
 * confondre reviendrait à faire dépendre un calcul de la présence d'un
 * libellé, ce qui est une coïncidence, pas une règle.
 *
 * ⚠️ UNE OPTION AFFICHÉE « ALIMENT INDISPONIBLE » NE PEUT PAS ÊTRE CALCULÉE.
 * On ne lui invente pas 0/0/0 : un aliment sans macros connues n'est pas un
 * aliment à zéro calorie, et le traiter comme tel ferait mentir la cible du
 * repas entier.
 */
export function optionCalculable(option: ChoiceOption): boolean {
  const n = option.nutrition;
  if (!n) return false;
  return (
    typeof option.optionId === "string" &&
    [n.proteinPer100, n.carbPer100, n.fatPer100].every(
      (v) => typeof v === "number" && Number.isFinite(v),
    )
  );
}

/**
 * L'ENTRÉE DU SOLVEUR N1.5 — construite UNIQUEMENT depuis `choixResolus`.
 *
 * ⚠️ AUCUNE AUTRE SOURCE. Ni la bibliothèque (`food_lists`), ni un second
 * état de sélection, ni les items texte du coach : ce que l'élève a choisi,
 * et rien d'autre.
 *
 * ⚠️ L'ORDRE EST CELUI DU COACH, et il est conservé jusqu'à l'écran. Trier
 * par quantité ou par nom ferait danser les lignes à chaque changement de
 * choix.
 *
 * ⚠️ DEUX OCCURRENCES DU MÊME ALIMENT RESTENT DEUX ENTRÉES. On ne déduplique
 * pas par `option.id` : « poulet » dans la protéine principale et « poulet »
 * dans la garniture sont deux variables distinctes du système, et les fondre
 * en une seule changerait le problème posé.
 *
 * Rend `null` dès qu'UN choix n'est pas calculable — on ne calcule pas un
 * repas amputé d'un de ses aliments.
 */
export function alimentsPourLeSolveur(
  resolus: readonly ChoixResolu[],
): readonly SelectedFoodForMealSolver[] | null {
  const aliments: SelectedFoodForMealSolver[] = [];
  for (const resolu of resolus) {
    if (!optionCalculable(resolu.option)) return null;
    const n = resolu.option.nutrition as NonNullable<ChoiceOption["nutrition"]>;
    aliments.push({
      optionId: resolu.optionId,
      slotId: resolu.slotId,
      name: resolu.option.displayName ?? "",
      unit: n.unit === "ml" ? "ml" : "g",
      proteinPer100: n.proteinPer100,
      carbPer100: n.carbPer100,
      fatPer100: n.fatPer100,
      // ⚠️ N1.5.1 — LA PORTION N'EST RETENUE QUE SI SON UNITÉ EST CELLE DU
      // CALCUL. Un snapshot figé en `g` sur un aliment devenu `ml` décrirait
      // une échelle qui n'est plus la sienne : on préfère calculer sans
      // préférence plutôt qu'avec une préférence fausse. Le cas est théorique
      // — l'unité d'un aliment ne change pas — mais le silence, lui, ne
      // serait pas rattrapable.
      preferredQuantity:
        resolu.option.preferredUnit === n.unit ? (resolu.option.preferredQuantity ?? null) : null,
    });
  }
  return aliments;
}

/**
 * L'ÉTAT DU CALCUL D'UN REPAS — une fonction, quatre réponses possibles.
 *
 * ⚠️ C'EST ICI QUE SE DÉCIDE S'IL Y A DES QUANTITÉS, PAS DANS LE RENDU. Le
 * composant ne fait que traduire ces quatre cas en pixels ; les tester exige
 * donc de tester une fonction, pas de deviner un DOM.
 *
 *   incomplet      — il manque au moins un choix. AUCUNE quantité. Un repas à
 *                    moitié composé n'a pas de « demi-solution » : les trois
 *                    macros se répartissent entre TOUS les aliments.
 *   sans-cible     — le jour n'a pas de cible exploitable (profil introuvable,
 *                    créneau désactivé). Il n'y a rien à viser.
 *   non-calculable — la composition est complète, mais un aliment n'a plus de
 *                    faits nutritionnels. On le DIT plutôt que de calculer
 *                    sans lui.
 *   calcule        — la solution, quantités comprises.
 */
export type EtatDuCalculDuRepas =
  | { readonly etat: "incomplet" }
  | { readonly etat: "sans-cible" }
  | { readonly etat: "non-calculable" }
  | { readonly etat: "calcule"; readonly solution: MealChoiceSolution };

export function calculDuRepas(
  occurrences: readonly MealChoiceSlot[],
  selection: SelectionDeChoix,
  cible: MealMacroTarget | null,
): EtatDuCalculDuRepas {
  // ⚠️ L'ORDRE DES TESTS COMPTE. « Incomplet » vient d'abord : tant que
  // l'élève n'a pas fini de composer, l'absence de cible n'a aucun intérêt à
  // être signalée.
  if (!progressionDesChoix(occurrences, selection).complet) return { etat: "incomplet" };

  const aliments = alimentsPourLeSolveur(choixResolus(occurrences, selection));
  if (aliments === null) return { etat: "non-calculable" };
  if (cible === null || aliments.length === 0) return { etat: "sans-cible" };

  return { etat: "calcule", solution: solveMealChoices(aliments, cible) };
}
