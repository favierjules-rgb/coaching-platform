/**
 * Conversion v1 → v2 — bibliothèque PURE.
 *
 * Un plan historique porte sa cible dans `nutrition_plans.daily_target`,
 * en GRAMMES : `{ calories, protein, carbs, fat }`. Le modèle v2, lui,
 * raisonne en CALORIES quotidiennes + parts P/G/L en points de base.
 *
 * Cette bibliothèque dérive le préremplissage du formulaire de conversion,
 * de manière DÉTERMINISTE et sans jamais inventer quoi que ce soit :
 *
 *   proteinCalories = proteinGrams × 4
 *   carbCalories    = carbGrams    × 4
 *   fatCalories     = fatGrams     × 9
 *
 * puis répartition des 10 000 points de base au prorata de ces calories.
 *
 * CE QU'ELLE NE FAIT PAS. Elle ne préremplit JAMAIS la répartition entre
 * les repas : les six créneaux partent désactivés et à zéro, et c'est le
 * coach qui choisit. Un plan v1 ne contient aucune information permettant
 * de deviner cette répartition — l'inventer serait mentir.
 */
import {
  BASIS_POINTS_TOTAL,
  BASIS_POINTS_MAX,
  BASIS_POINTS_MIN,
} from "./basis-points";
import { DAILY_CALORIES_MAX, KCAL_PER_GRAM } from "./macro-targets";
import {
  MACRO_KEYS,
  createEmptyAllocations,
  type MacroKey,
  type MealSlotAllocation,
} from "./meal-distribution";

/** Forme du JSONB `nutrition_plans.daily_target` d'un plan v1. */
export interface LegacyDailyTarget {
  readonly calories?: number | null;
  readonly protein?: number | null;
  readonly carbs?: number | null;
  readonly fat?: number | null;
}

export interface ConversionPrefill {
  readonly dailyCalories: number;
  readonly proteinBp: number;
  readonly carbBp: number;
  readonly fatBp: number;
  /**
   * Vrai si la répartition a réellement pu être dérivée des grammes v1.
   * Faux quand le plan v1 ne porte aucun gramme exploitable : les parts
   * restent alors à zéro, à charge du coach de les saisir.
   */
  readonly derivedFromGrams: boolean;
  /** Calories reconstituées depuis les grammes (peut différer de `calories`). */
  readonly caloriesFromGrams: number;
  /** Points de base attribués par la règle de résidu (0 à 2). */
  readonly residualBp: number;
  /** Créneaux : les six, DÉSACTIVÉS et à zéro. Aucune allocation inventée. */
  readonly slots: readonly MealSlotAllocation[];
}

/** Nombre fini et positif, ou 0. Aucune entrée ne peut produire un NaN. */
function nombreSur(valeur: number | null | undefined): number {
  if (typeof valeur !== "number" || !Number.isFinite(valeur) || valeur < 0) {
    return 0;
  }
  return valeur;
}

const CALORIES_PAR_MACRO: Readonly<Record<MacroKey, number>> = {
  protein: KCAL_PER_GRAM.protein,
  carb: KCAL_PER_GRAM.carb,
  fat: KCAL_PER_GRAM.fat,
};

/**
 * RÈGLE DE RÉSIDU — documentée et déterministe.
 *
 * Le prorata produit des parts fractionnaires. On prend d'abord la partie
 * ENTIÈRE de chacune (`Math.floor`), ce qui laisse un résidu de 0 à 2
 * points de base. Ce résidu est attribué une unité à la fois, par PARTIE
 * FRACTIONNAIRE DÉCROISSANTE ; à fraction égale, l'ordre canonique des
 * macros tranche (protéines, puis glucides, puis lipides).
 *
 * Deux critères totaux ⇒ aucune ambiguïté, donc aucun résultat dépendant de
 * l'implémentation de `sort`. Le total vaut EXACTEMENT 10 000.
 */
export function repartirAuProrata(
  caloriesParMacro: Readonly<Record<MacroKey, number>>,
): { readonly bp: Record<MacroKey, number>; readonly residualBp: number } {
  const total = MACRO_KEYS.reduce((s, m) => s + caloriesParMacro[m], 0);
  if (total <= 0) {
    return { bp: { protein: 0, carb: 0, fat: 0 }, residualBp: 0 };
  }

  const exact = MACRO_KEYS.map((macro) => {
    const brut = (caloriesParMacro[macro] * BASIS_POINTS_TOTAL) / total;
    const entier = Math.floor(brut);
    return { macro, entier, fraction: brut - entier };
  });

  const sommeEntiere = exact.reduce((s, e) => s + e.entier, 0);
  const residu = BASIS_POINTS_TOTAL - sommeEntiere;

  const ordre = [...exact].sort((a, b) => {
    if (b.fraction !== a.fraction) {
      return b.fraction - a.fraction;
    }
    return MACRO_KEYS.indexOf(a.macro) - MACRO_KEYS.indexOf(b.macro);
  });

  const bp: Record<MacroKey, number> = { protein: 0, carb: 0, fat: 0 };
  for (const e of exact) {
    bp[e.macro] = e.entier;
  }
  for (let i = 0; i < residu; i += 1) {
    bp[ordre[i % ordre.length].macro] += 1;
  }

  // Filet : jamais hors [0, 10 000], jamais NaN.
  for (const macro of MACRO_KEYS) {
    const v = bp[macro];
    bp[macro] = Number.isFinite(v)
      ? Math.min(BASIS_POINTS_MAX, Math.max(BASIS_POINTS_MIN, v))
      : 0;
  }

  return { bp, residualBp: residu };
}

/**
 * Préremplissage du formulaire de conversion depuis un `daily_target` v1.
 * Fonction PURE : l'objet d'entrée n'est jamais modifié.
 */
export function prefillFromLegacyDailyTarget(
  target: LegacyDailyTarget | null | undefined,
): ConversionPrefill {
  const grammes: Record<MacroKey, number> = {
    protein: nombreSur(target?.protein),
    carb: nombreSur(target?.carbs),
    fat: nombreSur(target?.fat),
  };

  const caloriesParMacro: Record<MacroKey, number> = {
    protein: grammes.protein * CALORIES_PAR_MACRO.protein,
    carb: grammes.carb * CALORIES_PAR_MACRO.carb,
    fat: grammes.fat * CALORIES_PAR_MACRO.fat,
  };
  const caloriesFromGrams =
    caloriesParMacro.protein + caloriesParMacro.carb + caloriesParMacro.fat;

  const { bp, residualBp } = repartirAuProrata(caloriesParMacro);
  const derivedFromGrams = caloriesFromGrams > 0;

  // Les calories saisies du plan v1 priment ; à défaut, celles reconstituées
  // depuis les grammes. Jamais au-delà du plafond porté par la contrainte SQL.
  const caloriesSaisies = nombreSur(target?.calories);
  const dailyCalories = Math.min(
    DAILY_CALORIES_MAX,
    caloriesSaisies > 0 ? caloriesSaisies : Math.round(caloriesFromGrams),
  );

  return {
    dailyCalories,
    proteinBp: bp.protein,
    carbBp: bp.carb,
    fatBp: bp.fat,
    derivedFromGrams,
    caloriesFromGrams,
    residualBp,
    // AUCUNE allocation inventée : six créneaux désactivés, tout à zéro.
    slots: createEmptyAllocations().map((a) => ({ ...a, enabled: false })),
  };
}

/** Message de confirmation affiché AVANT toute conversion. Aucune écriture. */
export const CONVERSION_CONFIRMATION_MESSAGE_FR =
  "Cette action active le nouveau modèle de répartition. Les objectifs quotidiens existants seront repris, mais la répartition entre les repas devra être complétée manuellement.";
