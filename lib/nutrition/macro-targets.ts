/**
 * Macros quotidiennes d'un plan nutrition v2 — bibliothèque PURE.
 *
 * SOURCE DE VÉRITÉ (décision d'architecture du chantier) :
 *   - les calories quotidiennes structurées ;
 *   - les pourcentages P/G/L en points de base.
 * Les GRAMMES et les CALORIES par macro en sont DÉRIVÉS, jamais saisis.
 *
 *   proteinGrams = dailyCalories × protein_bp / 10 000 / 4
 *   carbGrams    = dailyCalories × carb_bp    / 10 000 / 4
 *   fatGrams     = dailyCalories × fat_bp     / 10 000 / 9
 *
 * Les décimales sont CONSERVÉES en interne : l'arrondi n'intervient qu'à
 * l'affichage (`toDisplayMacroTargets`). Un arrondi appliqué au calcul
 * ferait dériver la somme des repas par rapport au total de la journée.
 *
 * Aucune mutation des entrées, aucun NaN ni Infinity produit : une entrée
 * hors domaine lève une `RangeError` déterministe plutôt que de propager
 * une valeur invalide.
 */
import {
  BASIS_POINTS_TOTAL,
  NBSP,
  applyBasisPoints,
  assertBasisPoints,
  describeBasisPointsBalance,
  formatBasisPointsBalanceMessage,
  formatBasisPointsPercent,
  formatDecimalFr,
  formatIntegerFr,
  type BasisPointsBalance,
} from "./basis-points";

/** Kilocalories par gramme, par macro — constantes physiologiques du calcul. */
export const KCAL_PER_GRAM = { protein: 4, carb: 4, fat: 9 } as const;

/** Plafond admis pour les calories quotidiennes (aligné sur la contrainte SQL). */
export const DAILY_CALORIES_MAX = 10_000;

export interface MacroSplitBasisPoints {
  readonly proteinBp: number;
  readonly carbBp: number;
  readonly fatBp: number;
}

export interface DailyMacroInput extends MacroSplitBasisPoints {
  readonly dailyCalories: number;
}

export interface MacroGrams {
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
}

export interface MacroCalories {
  readonly proteinCalories: number;
  readonly carbCalories: number;
  readonly fatCalories: number;
  readonly totalCalories: number;
}

export interface DailyMacroTargets {
  /** Calories quotidiennes structurées — source de vérité. */
  readonly dailyCalories: number;
  /** Répartition P/G/L en points de base — source de vérité. */
  readonly split: MacroSplitBasisPoints;
  /** Grammes DÉRIVÉS, décimales conservées. */
  readonly grams: MacroGrams;
  /** Calories DÉRIVÉES des grammes, décimales conservées. */
  readonly calories: MacroCalories;
  /** État de la somme P/G/L par rapport aux 10 000 attendus. */
  readonly balance: BasisPointsBalance;
}

/**
 * Valide les calories quotidiennes d'une entrée de calcul. Zéro est ACCEPTÉ
 * (un brouillon peut ne pas encore porter de cible) ; le négatif, le non
 * fini et le dépassement du plafond sont refusés.
 */
function assertDailyCalories(dailyCalories: number): void {
  if (typeof dailyCalories !== "number" || !Number.isFinite(dailyCalories)) {
    throw new RangeError(
      `Les calories quotidiennes doivent être un nombre fini (reçu : ${String(dailyCalories)}).`,
    );
  }
  if (dailyCalories < 0) {
    throw new RangeError(
      `Les calories quotidiennes ne peuvent pas être négatives (reçu : ${String(dailyCalories)}).`,
    );
  }
  if (dailyCalories > DAILY_CALORIES_MAX) {
    throw new RangeError(
      `Les calories quotidiennes ne peuvent pas dépasser ${DAILY_CALORIES_MAX} (reçu : ${String(dailyCalories)}).`,
    );
  }
}

/** Calories dérivées de grammes déjà calculés (aucun arrondi intermédiaire). */
export function computeCaloriesFromGrams(grams: MacroGrams): MacroCalories {
  const proteinCalories = grams.proteinGrams * KCAL_PER_GRAM.protein;
  const carbCalories = grams.carbGrams * KCAL_PER_GRAM.carb;
  const fatCalories = grams.fatGrams * KCAL_PER_GRAM.fat;
  return {
    proteinCalories,
    carbCalories,
    fatCalories,
    totalCalories: proteinCalories + carbCalories + fatCalories,
  };
}

/**
 * Calcule les cibles quotidiennes à partir des calories et de la
 * répartition en points de base. FONCTION PURE : l'objet d'entrée n'est
 * jamais modifié, et le résultat ne partage aucune référence avec lui.
 */
export function computeDailyMacroTargets(input: DailyMacroInput): DailyMacroTargets {
  assertDailyCalories(input.dailyCalories);
  assertBasisPoints(input.proteinBp, "protein_bp");
  assertBasisPoints(input.carbBp, "carb_bp");
  assertBasisPoints(input.fatBp, "fat_bp");

  const grams: MacroGrams = {
    proteinGrams: applyBasisPoints(input.dailyCalories, input.proteinBp) / KCAL_PER_GRAM.protein,
    carbGrams: applyBasisPoints(input.dailyCalories, input.carbBp) / KCAL_PER_GRAM.carb,
    fatGrams: applyBasisPoints(input.dailyCalories, input.fatBp) / KCAL_PER_GRAM.fat,
  };

  return {
    dailyCalories: input.dailyCalories,
    split: { proteinBp: input.proteinBp, carbBp: input.carbBp, fatBp: input.fatBp },
    grams,
    calories: computeCaloriesFromGrams(grams),
    balance: describeBasisPointsBalance([input.proteinBp, input.carbBp, input.fatBp]),
  };
}

/**
 * Vrai si la répartition P/G/L vaut EXACTEMENT 10 000 points de base.
 * Comparaison entière — jamais `=== 100` sur des flottants.
 */
export function isSplitComplete(split: MacroSplitBasisPoints): boolean {
  return split.proteinBp + split.carbBp + split.fatBp === BASIS_POINTS_TOTAL;
}

/** Calories strictement positives : condition nécessaire pour assigner un plan. */
export function hasAssignableCalories(dailyCalories: number): boolean {
  return Number.isFinite(dailyCalories) && dailyCalories > 0 && dailyCalories <= DAILY_CALORIES_MAX;
}

/**
 * Message français décrivant le déficit ou le dépassement de la
 * répartition quotidienne. `null` si elle est exactement complète.
 */
export function formatSplitBalanceMessage(split: MacroSplitBasisPoints): string | null {
  return formatBasisPointsBalanceMessage(
    describeBasisPointsBalance([split.proteinBp, split.carbBp, split.fatBp]),
  );
}

/**
 * REPRÉSENTATION D'AFFICHAGE — strictement distincte de la représentation
 * de calcul. Les valeurs sont ici des CHAÎNES françaises déjà arrondies :
 * elles ne doivent jamais être réinjectées dans un calcul.
 */
export interface DisplayMacroTargets {
  readonly dailyCalories: string;
  readonly proteinGrams: string;
  readonly carbGrams: string;
  readonly fatGrams: string;
  readonly proteinPercent: string;
  readonly carbPercent: string;
  readonly fatPercent: string;
  readonly derivedCalories: string;
  readonly balanceMessage: string | null;
}

export interface DisplayOptions {
  /** Décimales affichées pour les grammes (0 par défaut). */
  readonly gramDecimals?: number;
}

/** Projette des cibles de calcul vers leur représentation d'affichage française. */
export function toDisplayMacroTargets(
  targets: DailyMacroTargets,
  options: DisplayOptions = {},
): DisplayMacroTargets {
  const decimales = options.gramDecimals ?? 0;
  return {
    dailyCalories: `${formatIntegerFr(targets.dailyCalories)}${NBSP}kcal`,
    proteinGrams: `${formatDecimalFr(targets.grams.proteinGrams, decimales)}${NBSP}g`,
    carbGrams: `${formatDecimalFr(targets.grams.carbGrams, decimales)}${NBSP}g`,
    fatGrams: `${formatDecimalFr(targets.grams.fatGrams, decimales)}${NBSP}g`,
    proteinPercent: formatBasisPointsPercent(targets.split.proteinBp),
    carbPercent: formatBasisPointsPercent(targets.split.carbBp),
    fatPercent: formatBasisPointsPercent(targets.split.fatBp),
    derivedCalories: `${formatIntegerFr(targets.calories.totalCalories)}${NBSP}kcal`,
    balanceMessage: formatBasisPointsBalanceMessage(targets.balance),
  };
}
