/**
 * Répartition des macros par créneau de repas — bibliothèque PURE.
 *
 * SOURCE DE VÉRITÉ : les pourcentages PAR CRÉNEAU, en points de base, une
 * série par macro (protéines, glucides, lipides). Les grammes et les
 * calories d'un repas en sont DÉRIVÉS.
 *
 * RÈGLE CENTRALE — aucun arrondi cumulatif. Les grammes d'un créneau sont
 * calculés depuis l'objectif quotidien NON ARRONDI :
 *
 *     gCréneau = gJournée(non arrondi) × bpCréneau / 10 000
 *
 * La somme des créneaux reconstitue donc exactement la journée dès lors que
 * la somme des points de base vaut 10 000. Arrondir chaque repas puis
 * sommer ferait dériver le total de plusieurs grammes.
 *
 * `distributeRemainingEqually` est le SEUL point d'entrée qui modifie une
 * répartition : aucune autre fonction de ce module ne réécrit
 * silencieusement les valeurs saisies par le coach.
 */
import {
  BASIS_POINTS_TOTAL,
  applyBasisPoints,
  assertBasisPoints,
  describeBasisPointsBalance,
  formatBasisPointsBalanceMessage,
  type BasisPointsBalance,
} from "./basis-points";
import { computeCaloriesFromGrams, type DailyMacroTargets, type MacroGrams } from "./macro-targets";

/**
 * Les six créneaux du modèle v2, dans leur ordre d'affichage canonique.
 * Cet ordre est aussi l'ordre d'attribution des points de base restants
 * (`distributeRemainingEqually`) : il rend la répartition reproductible.
 */
export const MEAL_SLOT_KEYS = [
  "breakfast",
  "morning_snack",
  "lunch",
  "afternoon_snack",
  "dinner",
  "dessert",
] as const;

export type MealSlotKey = (typeof MEAL_SLOT_KEYS)[number];

/** Ordre d'affichage canonique, 0 à 5. */
export const MEAL_SLOT_DEFAULT_ORDER: Readonly<Record<MealSlotKey, number>> = {
  breakfast: 0,
  morning_snack: 1,
  lunch: 2,
  afternoon_snack: 3,
  dinner: 4,
  dessert: 5,
};

/** Libellés français des créneaux — affichage uniquement. */
export const MEAL_SLOT_LABELS_FR: Readonly<Record<MealSlotKey, string>> = {
  breakfast: "Petit déjeuner",
  morning_snack: "Collation du matin",
  lunch: "Déjeuner",
  afternoon_snack: "Collation de l'après-midi",
  dinner: "Dîner",
  dessert: "Dessert",
};

/** Les trois macros réparties, dans leur ordre canonique. */
export const MACRO_KEYS = ["protein", "carb", "fat"] as const;
export type MacroKey = (typeof MACRO_KEYS)[number];

/** Allocation d'un créneau : une part en points de base par macro. */
export interface MealSlotAllocation {
  readonly slot: MealSlotKey;
  readonly enabled: boolean;
  readonly proteinBp: number;
  readonly carbBp: number;
  readonly fatBp: number;
  readonly displayOrder: number;
}

export interface MealSlotMacros {
  readonly slot: MealSlotKey;
  readonly enabled: boolean;
  readonly displayOrder: number;
  /** Grammes DÉRIVÉS, décimales conservées. */
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
  /** Calories DÉRIVÉES des grammes du créneau. */
  readonly calories: number;
}

export interface MealDistribution {
  readonly slots: readonly MealSlotMacros[];
  /** Somme non arrondie des créneaux — reconstitue la journée sans dérive. */
  readonly totals: MacroGrams & { readonly calories: number };
  readonly balance: Readonly<Record<MacroKey, BasisPointsBalance>>;
}

/** Lit la part d'une macro dans une allocation, sans branchement dupliqué. */
export function readSlotBasisPoints(allocation: MealSlotAllocation, macro: MacroKey): number {
  if (macro === "protein") return allocation.proteinBp;
  if (macro === "carb") return allocation.carbBp;
  return allocation.fatBp;
}

/** Retourne une COPIE de l'allocation avec la part d'une macro remplacée. */
export function withSlotBasisPoints(
  allocation: MealSlotAllocation,
  macro: MacroKey,
  bp: number,
): MealSlotAllocation {
  if (macro === "protein") return { ...allocation, proteinBp: bp };
  if (macro === "carb") return { ...allocation, carbBp: bp };
  return { ...allocation, fatBp: bp };
}

/** Six créneaux vides, tous actifs, dans l'ordre canonique. */
export function createEmptyAllocations(): MealSlotAllocation[] {
  return MEAL_SLOT_KEYS.map((slot) => ({
    slot,
    enabled: true,
    proteinBp: 0,
    carbBp: 0,
    fatBp: 0,
    displayOrder: MEAL_SLOT_DEFAULT_ORDER[slot],
  }));
}

/**
 * Somme des points de base d'une macro sur les créneaux ACTIFS.
 * Les créneaux désactivés sont exclus : leur allocation doit être nulle,
 * et le cas contraire est une erreur de validation (voir plan-v2-validation).
 */
export function sumEnabledBasisPoints(
  allocations: readonly MealSlotAllocation[],
  macro: MacroKey,
): number {
  let total = 0;
  for (const allocation of allocations) {
    if (allocation.enabled) {
      total += readSlotBasisPoints(allocation, macro);
    }
  }
  return total;
}

/** État de la somme des créneaux actifs pour une macro. */
export function describeMacroBalance(
  allocations: readonly MealSlotAllocation[],
  macro: MacroKey,
): BasisPointsBalance {
  return describeBasisPointsBalance(
    allocations.filter((a) => a.enabled).map((a) => readSlotBasisPoints(a, macro)),
  );
}

/** Message français de déficit/dépassement pour une macro donnée. */
export function formatMacroBalanceMessage(
  allocations: readonly MealSlotAllocation[],
  macro: MacroKey,
): string | null {
  return formatBasisPointsBalanceMessage(describeMacroBalance(allocations, macro));
}

/**
 * Dérive les grammes et calories de chaque créneau depuis les cibles
 * quotidiennes NON ARRONDIES. Fonction pure : ni `targets` ni `allocations`
 * ne sont modifiés.
 *
 * Un créneau désactivé produit systématiquement des valeurs nulles, quelle
 * que soit son allocation stockée — la désactivation prime à l'affichage,
 * mais l'incohérence reste signalée par la validation.
 */
export function computeMealDistribution(
  targets: DailyMacroTargets,
  allocations: readonly MealSlotAllocation[],
): MealDistribution {
  const slots: MealSlotMacros[] = allocations.map((allocation) => {
    if (!allocation.enabled) {
      return {
        slot: allocation.slot,
        enabled: false,
        displayOrder: allocation.displayOrder,
        proteinGrams: 0,
        carbGrams: 0,
        fatGrams: 0,
        calories: 0,
      };
    }
    const grams: MacroGrams = {
      proteinGrams: applyBasisPoints(targets.grams.proteinGrams, allocation.proteinBp),
      carbGrams: applyBasisPoints(targets.grams.carbGrams, allocation.carbBp),
      fatGrams: applyBasisPoints(targets.grams.fatGrams, allocation.fatBp),
    };
    return {
      slot: allocation.slot,
      enabled: true,
      displayOrder: allocation.displayOrder,
      proteinGrams: grams.proteinGrams,
      carbGrams: grams.carbGrams,
      fatGrams: grams.fatGrams,
      calories: computeCaloriesFromGrams(grams).totalCalories,
    };
  });

  const totals = slots.reduce(
    (acc, slot) => ({
      proteinGrams: acc.proteinGrams + slot.proteinGrams,
      carbGrams: acc.carbGrams + slot.carbGrams,
      fatGrams: acc.fatGrams + slot.fatGrams,
      calories: acc.calories + slot.calories,
    }),
    { proteinGrams: 0, carbGrams: 0, fatGrams: 0, calories: 0 },
  );

  return {
    slots,
    totals,
    balance: {
      protein: describeMacroBalance(allocations, "protein"),
      carb: describeMacroBalance(allocations, "carb"),
      fat: describeMacroBalance(allocations, "fat"),
    },
  };
}

export type DistributeRefusal =
  /** Les lignes verrouillées (et désactivées) dépassent déjà 10 000 bp. */
  | "locked_exceeds_total"
  /** Aucun créneau actif et non verrouillé sur lequel répartir le reste. */
  | "no_distributable_slot";

export type DistributeResult =
  | { readonly ok: true; readonly allocations: MealSlotAllocation[]; readonly distributedBp: number }
  | { readonly ok: false; readonly reason: DistributeRefusal; readonly remainingBp: number };

export interface DistributeOptions {
  /** Créneaux dont la valeur doit être préservée telle quelle. */
  readonly lockedSlots?: readonly MealSlotKey[];
}

/**
 * Répartit les points de base restants d'UNE macro, à parts égales, sur les
 * créneaux ACTIFS et NON VERROUILLÉS.
 *
 * GARANTIES :
 *   - les créneaux verrouillés sont préservés à l'octet près ;
 *   - les créneaux désactivés ne sont jamais modifiés (leur valeur est
 *     comptée comme figée : c'est la validation, pas cette fonction, qui
 *     signale une allocation non nulle sur un créneau désactivé) ;
 *   - le reste est réparti de manière DÉTERMINISTE : quotient entier pour
 *     tous, puis les unités restantes attribuées une à une dans l'ORDRE
 *     D'AFFICHAGE croissant ;
 *   - la somme vaut EXACTEMENT 10 000 quand une répartition est possible ;
 *   - refus propre, sans écriture, si les lignes figées dépassent déjà
 *     10 000 points de base.
 *
 * Fonction pure : le tableau d'entrée et ses éléments ne sont jamais mutés.
 */
export function distributeRemainingEqually(
  allocations: readonly MealSlotAllocation[],
  macro: MacroKey,
  options: DistributeOptions = {},
): DistributeResult {
  const locked = new Set(options.lockedSlots ?? []);

  let figes = 0;
  const cibles: MealSlotAllocation[] = [];
  for (const allocation of allocations) {
    const modifiable = allocation.enabled && !locked.has(allocation.slot);
    if (modifiable) {
      cibles.push(allocation);
    } else {
      figes += readSlotBasisPoints(allocation, macro);
    }
  }

  const reste = BASIS_POINTS_TOTAL - figes;
  if (reste < 0) {
    return { ok: false, reason: "locked_exceeds_total", remainingBp: reste };
  }
  if (cibles.length === 0) {
    if (reste === 0) {
      return { ok: true, allocations: allocations.map((a) => ({ ...a })), distributedBp: 0 };
    }
    return { ok: false, reason: "no_distributable_slot", remainingBp: reste };
  }

  const quotient = Math.floor(reste / cibles.length);
  const unitesRestantes = reste - quotient * cibles.length;

  // Ordre d'affichage croissant ; à ordre égal, ordre canonique du créneau.
  // Deux critères stables ⇒ aucune ambiguïté, donc aucun résultat dépendant
  // de l'implémentation de `sort`.
  const ordreAttribution = cibles
    .map((allocation, index) => ({ allocation, index }))
    .sort((a, b) => {
      if (a.allocation.displayOrder !== b.allocation.displayOrder) {
        return a.allocation.displayOrder - b.allocation.displayOrder;
      }
      return (
        MEAL_SLOT_DEFAULT_ORDER[a.allocation.slot] - MEAL_SLOT_DEFAULT_ORDER[b.allocation.slot]
      );
    });

  const valeurParSlot = new Map<MealSlotKey, number>();
  ordreAttribution.forEach((entree, rang) => {
    valeurParSlot.set(entree.allocation.slot, quotient + (rang < unitesRestantes ? 1 : 0));
  });

  const sortie = allocations.map((allocation) => {
    const valeur = valeurParSlot.get(allocation.slot);
    if (valeur === undefined) {
      return { ...allocation };
    }
    return withSlotBasisPoints({ ...allocation }, macro, valeur);
  });

  return { ok: true, allocations: sortie, distributedBp: reste };
}

/**
 * Remet à zéro l'allocation des créneaux désactivés. APPEL EXPLICITE
 * uniquement : aucune autre fonction du module ne le fait à l'insu du
 * coach. Fonction pure.
 */
export function normalizeDisabledSlots(
  allocations: readonly MealSlotAllocation[],
): MealSlotAllocation[] {
  return allocations.map((allocation) =>
    allocation.enabled
      ? { ...allocation }
      : { ...allocation, proteinBp: 0, carbBp: 0, fatBp: 0 },
  );
}

/**
 * Contrôle de domaine d'une allocation : entiers de points de base dans
 * [0, 10 000] et ordre d'affichage entier positif. Lève une `RangeError`
 * déterministe — utilisé aux frontières (payload RPC, import).
 */
export function assertAllocation(allocation: MealSlotAllocation): void {
  assertBasisPoints(allocation.proteinBp, `${allocation.slot}.protein_bp`);
  assertBasisPoints(allocation.carbBp, `${allocation.slot}.carb_bp`);
  assertBasisPoints(allocation.fatBp, `${allocation.slot}.fat_bp`);
  if (!Number.isInteger(allocation.displayOrder) || allocation.displayOrder < 0) {
    throw new RangeError(
      `${allocation.slot}.display_order doit être un entier positif (reçu : ${String(allocation.displayOrder)}).`,
    );
  }
}
