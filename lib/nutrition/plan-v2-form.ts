/**
 * État du constructeur de plan v2 — bibliothèque PURE.
 *
 * Tout le comportement métier du constructeur vit ICI, pas dans les
 * composants React : le composant n'est qu'une projection de cet état.
 * C'est ce qui rend le constructeur testable sans DOM, et ce qui garantit
 * qu'aucune règle de calcul n'est réécrite dans une vue.
 *
 * SOURCE DE VÉRITÉ DU FORMULAIRE : `dailyCalories` et les parts en POINTS
 * DE BASE ENTIERS. L'interface affiche des pourcentages ; l'état, lui, ne
 * connaît que des entiers — aucune comparaison flottante nulle part.
 *
 * INVARIANTS TENUS PAR CE MODULE :
 *   - les six créneaux sont TOUJOURS présents, dans l'ordre canonique ;
 *   - un créneau désactivé porte TOUJOURS trois zéros ;
 *   - aucune redistribution implicite : seul `distributeRestForMacro`
 *     réécrit une répartition, et uniquement sur appel explicite ;
 *   - toutes les fonctions retournent un NOUVEL état, jamais une mutation.
 */
import { BASIS_POINTS_MAX, BASIS_POINTS_MIN, BASIS_POINTS_TOTAL, formatDecimalFr, isBasisPoints } from "./basis-points";
import {
  computeDailyMacroTargets,
  type DailyMacroTargets,
} from "./macro-targets";
import {
  MACRO_KEYS,
  MEAL_SLOT_DEFAULT_ORDER,
  MEAL_SLOT_KEYS,
  computeMealDistribution,
  createEmptyAllocations,
  describeMacroBalance,
  distributeRemainingEqually,
  normalizeDisabledSlots,
  readSlotBasisPoints,
  withSlotBasisPoints,
  type DistributeRefusal,
  type MacroKey,
  type MealSlotAllocation,
  type MealSlotKey,
} from "./meal-distribution";
import {
  DEFAULT_PROFILE_KEY,
  NUTRITION_MODEL_VERSION_STRUCTURED,
  findDefaultProfile,
  type NutritionPlanV2,
} from "./plan-v2-validation";
import type { ConversionPrefill } from "./plan-v2-conversion";

/** Créneaux verrouillés, indépendamment par macro. */
export type LockedSlots = Readonly<Record<MacroKey, readonly MealSlotKey[]>>;

export interface PlanV2FormState {
  readonly planId: string | null;
  readonly name: string;
  readonly description: string;
  readonly goalType: string;
  readonly status: string;
  readonly coachNotes: string;
  readonly hydrationTip: string;
  readonly dailyCalories: number;
  readonly proteinBp: number;
  readonly carbBp: number;
  readonly fatBp: number;
  readonly slots: readonly MealSlotAllocation[];
  readonly locked: LockedSlots;
}

export interface PlanV2FormMeta {
  readonly planId: string | null;
  readonly name: string;
  readonly description?: string;
  readonly goalType: string;
  readonly status: string;
  readonly coachNotes?: string;
  readonly hydrationTip?: string;
}

const AUCUN_VERROU: LockedSlots = { protein: [], carb: [], fat: [] };

/** Réordonne et complète les six créneaux — jamais de tableau partiel. */
function normaliserCreneaux(slots: readonly MealSlotAllocation[]): MealSlotAllocation[] {
  const parCle = new Map(slots.map((s) => [s.slot, s]));
  return MEAL_SLOT_KEYS.map((slot) => {
    const existant = parCle.get(slot);
    if (!existant) {
      return {
        slot,
        enabled: false,
        proteinBp: 0,
        carbBp: 0,
        fatBp: 0,
        displayOrder: MEAL_SLOT_DEFAULT_ORDER[slot],
      };
    }
    return { ...existant };
  }).sort((a, b) => a.displayOrder - b.displayOrder);
}

/** État initial d'une CONVERSION v1 → v2 (aucune écriture n'a encore eu lieu). */
export function createFormStateFromPrefill(
  prefill: ConversionPrefill,
  meta: PlanV2FormMeta,
): PlanV2FormState {
  return {
    planId: meta.planId,
    name: meta.name,
    description: meta.description ?? "",
    goalType: meta.goalType,
    status: meta.status,
    coachNotes: meta.coachNotes ?? "",
    hydrationTip: meta.hydrationTip ?? "",
    dailyCalories: prefill.dailyCalories,
    proteinBp: prefill.proteinBp,
    carbBp: prefill.carbBp,
    fatBp: prefill.fatBp,
    slots: normaliserCreneaux(prefill.slots),
    locked: AUCUN_VERROU,
  };
}

/**
 * État initial d'une CRÉATION DIRECTE en v2 : aucun identifiant de plan,
 * donc AUCUNE ligne en base. Les six créneaux existent, désactivés et à
 * zéro. La première écriture sera l'unique appel à la RPC.
 */
export function createBlankFormState(meta: Omit<PlanV2FormMeta, "planId">): PlanV2FormState {
  return {
    planId: null,
    name: meta.name,
    description: meta.description ?? "",
    goalType: meta.goalType,
    status: meta.status,
    coachNotes: meta.coachNotes ?? "",
    hydrationTip: meta.hydrationTip ?? "",
    dailyCalories: 0,
    proteinBp: 0,
    carbBp: 0,
    fatBp: 0,
    slots: normaliserCreneaux(createEmptyAllocations().map((a) => ({ ...a, enabled: false }))),
    locked: AUCUN_VERROU,
  };
}

/** État initial d'un plan DÉJÀ v2, relu par la lecture canonique. */
export function createFormStateFromCanonical(
  plan: NutritionPlanV2,
  meta: PlanV2FormMeta,
): PlanV2FormState {
  const profil = findDefaultProfile(plan);
  return {
    planId: plan.id,
    name: meta.name,
    description: meta.description ?? "",
    goalType: meta.goalType,
    status: meta.status,
    coachNotes: meta.coachNotes ?? "",
    hydrationTip: meta.hydrationTip ?? "",
    dailyCalories: profil?.dailyCalories ?? 0,
    proteinBp: profil?.proteinBp ?? 0,
    carbBp: profil?.carbBp ?? 0,
    fatBp: profil?.fatBp ?? 0,
    slots: normaliserCreneaux(profil?.slots ?? createEmptyAllocations().map((a) => ({ ...a, enabled: false }))),
    locked: AUCUN_VERROU,
  };
}

/* ─────────────────────── Objectif quotidien ─────────────────────── */

export function setDailyCalories(state: PlanV2FormState, calories: number): PlanV2FormState {
  const valeur = Number.isFinite(calories) && calories >= 0 ? calories : 0;
  return { ...state, dailyCalories: valeur };
}

export function readDailyMacroBp(state: PlanV2FormState, macro: MacroKey): number {
  if (macro === "protein") return state.proteinBp;
  if (macro === "carb") return state.carbBp;
  return state.fatBp;
}

export function setDailyMacroBp(
  state: PlanV2FormState,
  macro: MacroKey,
  bp: number,
): PlanV2FormState {
  if (!isBasisPoints(bp)) {
    return state; // valeur hors domaine : AUCUN écrêtage silencieux, on ignore
  }
  if (macro === "protein") return { ...state, proteinBp: bp };
  if (macro === "carb") return { ...state, carbBp: bp };
  return { ...state, fatBp: bp };
}

/* ─────────────────────── Créneaux ─────────────────────── */

/**
 * Active ou désactive un créneau. La désactivation remet IMMÉDIATEMENT les
 * trois allocations locales à zéro — en mémoire seulement : rien n'est
 * écrit en base avant un clic explicite sur Enregistrer.
 */
export function setSlotEnabled(
  state: PlanV2FormState,
  slot: MealSlotKey,
  enabled: boolean,
): PlanV2FormState {
  return {
    ...state,
    slots: state.slots.map((a) =>
      a.slot !== slot
        ? { ...a }
        : enabled
          ? { ...a, enabled: true }
          : { ...a, enabled: false, proteinBp: 0, carbBp: 0, fatBp: 0 },
    ),
    // Un créneau désactivé perd aussi son verrou : le conserver figerait un
    // zéro invisible lors de la prochaine répartition automatique.
    locked: enabled
      ? state.locked
      : {
          protein: state.locked.protein.filter((s) => s !== slot),
          carb: state.locked.carb.filter((s) => s !== slot),
          fat: state.locked.fat.filter((s) => s !== slot),
        },
  };
}

export function setSlotMacroBp(
  state: PlanV2FormState,
  slot: MealSlotKey,
  macro: MacroKey,
  bp: number,
): PlanV2FormState {
  if (!isBasisPoints(bp)) {
    return state;
  }
  return {
    ...state,
    slots: state.slots.map((a) =>
      a.slot === slot && a.enabled ? withSlotBasisPoints({ ...a }, macro, bp) : { ...a },
    ),
  };
}

export function isSlotLocked(state: PlanV2FormState, macro: MacroKey, slot: MealSlotKey): boolean {
  return state.locked[macro].includes(slot);
}

export function toggleSlotLock(
  state: PlanV2FormState,
  macro: MacroKey,
  slot: MealSlotKey,
): PlanV2FormState {
  const actuels = state.locked[macro];
  const suivants = actuels.includes(slot)
    ? actuels.filter((s) => s !== slot)
    : [...actuels, slot];
  return { ...state, locked: { ...state.locked, [macro]: suivants } };
}

/* ─────────────────────── Répartir le reste ─────────────────────── */

export type DistributeOutcome =
  | { readonly ok: true; readonly state: PlanV2FormState; readonly distributedBp: number }
  | { readonly ok: false; readonly reason: DistributeRefusal; readonly message: string };

const MESSAGES_REFUS: Readonly<Record<DistributeRefusal, string>> = {
  locked_exceeds_total:
    "Les repas verrouillés dépassent déjà 100 % : déverrouille au moins une ligne avant de répartir le reste.",
  no_distributable_slot:
    "Aucun repas actif et non verrouillé sur lequel répartir le reste.",
};

/**
 * Seul point d'entrée qui réécrit une répartition. Délègue INTÉGRALEMENT à
 * la fonction pure de la PR 1 — aucune logique de répartition n'est
 * réimplémentée ici.
 */
export function distributeRestForMacro(
  state: PlanV2FormState,
  macro: MacroKey,
): DistributeOutcome {
  const resultat = distributeRemainingEqually(state.slots, macro, {
    lockedSlots: state.locked[macro],
  });
  if (!resultat.ok) {
    return { ok: false, reason: resultat.reason, message: MESSAGES_REFUS[resultat.reason] };
  }
  return {
    ok: true,
    state: { ...state, slots: resultat.allocations },
    distributedBp: resultat.distributedBp,
  };
}

/* ─────────────────────── Dérivés d'affichage ─────────────────────── */

/** Cibles quotidiennes dérivées de l'état courant. */
export function deriveDailyTargets(state: PlanV2FormState): DailyMacroTargets {
  return computeDailyMacroTargets({
    dailyCalories: state.dailyCalories,
    proteinBp: state.proteinBp,
    carbBp: state.carbBp,
    fatBp: state.fatBp,
  });
}

export interface RecapRow {
  readonly slot: MealSlotKey;
  readonly enabled: boolean;
  readonly proteinGrams: number;
  readonly carbGrams: number;
  readonly fatGrams: number;
  readonly calories: number;
}

export interface RecapSummary {
  readonly rows: readonly RecapRow[];
  readonly totals: {
    readonly proteinGrams: number;
    readonly carbGrams: number;
    readonly fatGrams: number;
    readonly calories: number;
  };
  /** Calories demandées par le coach. */
  readonly requestedCalories: number;
  /** Calories reconstituées depuis les macros quotidiennes. */
  readonly derivedCalories: number;
  /** Écart d'affichage éventuel entre les deux (jamais bloquant). */
  readonly displayGapCalories: number;
}

/**
 * Récapitulatif par repas. Les valeurs sont NON ARRONDIES : l'arrondi est
 * fait par la vue au dernier moment, jamais dans les totaux.
 */
export function buildRecap(state: PlanV2FormState): RecapSummary {
  const cibles = deriveDailyTargets(state);
  const distribution = computeMealDistribution(cibles, state.slots);
  return {
    rows: distribution.slots.map((s) => ({
      slot: s.slot,
      enabled: s.enabled,
      proteinGrams: s.proteinGrams,
      carbGrams: s.carbGrams,
      fatGrams: s.fatGrams,
      calories: s.calories,
    })),
    totals: {
      proteinGrams: distribution.totals.proteinGrams,
      carbGrams: distribution.totals.carbGrams,
      fatGrams: distribution.totals.fatGrams,
      calories: distribution.totals.calories,
    },
    requestedCalories: state.dailyCalories,
    derivedCalories: cibles.calories.totalCalories,
    displayGapCalories: cibles.calories.totalCalories - state.dailyCalories,
  };
}

/** Grammes restant à répartir pour une macro, d'après les points de base non alloués. */
export function remainingGramsForMacro(state: PlanV2FormState, macro: MacroKey): number {
  const cibles = deriveDailyTargets(state);
  const balance = describeMacroBalance(state.slots, macro);
  const grammesJour =
    macro === "protein"
      ? cibles.grams.proteinGrams
      : macro === "carb"
        ? cibles.grams.carbGrams
        : cibles.grams.fatGrams;
  return (grammesJour * balance.remainingBp) / BASIS_POINTS_TOTAL;
}

/* ─────────────────────── Saisie en pourcentage ─────────────────────── */

export type PercentParseResult =
  | { readonly ok: true; readonly bp: number }
  | { readonly ok: false; readonly message: string };

/**
 * Convertit une saisie utilisateur en points de base.
 *
 * AUCUN ÉCRÊTAGE SILENCIEUX : une valeur hors de 0–100 % n'est pas ramenée
 * discrètement dans les bornes, elle est REFUSÉE avec un message. Le champ
 * conserve alors le texte saisi, et l'état métier reste inchangé.
 */
export function parsePercentInput(texte: string): PercentParseResult {
  const normalise = texte.trim().replace(",", ".").replace("%", "").trim();
  if (normalise === "") {
    return { ok: true, bp: 0 };
  }
  const valeur = Number(normalise);
  if (!Number.isFinite(valeur)) {
    return { ok: false, message: "Valeur illisible : saisis un pourcentage entre 0 et 100." };
  }
  if (valeur < 0) {
    return { ok: false, message: "Un pourcentage ne peut pas être négatif." };
  }
  if (valeur > 100) {
    return { ok: false, message: "Un pourcentage ne peut pas dépasser 100 %." };
  }
  const bp = Math.round(valeur * 100);
  if (bp < BASIS_POINTS_MIN || bp > BASIS_POINTS_MAX) {
    return { ok: false, message: "Un pourcentage ne peut pas dépasser 100 %." };
  }
  return { ok: true, bp };
}

/** Points de base → texte du champ numérique (2 décimales au plus, virgule). */
export function formatPercentInput(bp: number): string {
  return formatDecimalFr(bp / 100, 2);
}

/* ─────────────────────── Sorties ─────────────────────── */

/** Projette l'état vers la forme canonique attendue par la validation PR 1. */
export function toValidationPlan(state: PlanV2FormState): NutritionPlanV2 {
  return {
    id: state.planId ?? "",
    nutritionModelVersion: NUTRITION_MODEL_VERSION_STRUCTURED,
    name: state.name,
    profiles: [
      {
        profileKey: DEFAULT_PROFILE_KEY,
        dailyCalories: state.dailyCalories,
        proteinBp: state.proteinBp,
        carbBp: state.carbBp,
        fatBp: state.fatBp,
        slots: state.slots,
      },
    ],
  };
}

/**
 * Projette l'état vers le payload de la RPC. Les créneaux désactivés sont
 * normalisés à zéro AVANT l'envoi — le payload reste structurellement
 * valide même pour un brouillon très incomplet, et porte TOUJOURS les six
 * créneaux avec `enabled` explicite.
 */
export function toSaveInput(state: PlanV2FormState): {
  planId: string | null;
  name: string;
  description: string;
  goalType: string;
  status: string;
  coachNotes: string;
  hydrationTip: string;
  dailyCalories: number;
  proteinBp: number;
  carbBp: number;
  fatBp: number;
  slots: MealSlotAllocation[];
} {
  return {
    planId: state.planId,
    name: state.name,
    description: state.description,
    goalType: state.goalType,
    status: state.status,
    coachNotes: state.coachNotes,
    hydrationTip: state.hydrationTip,
    dailyCalories: state.dailyCalories,
    proteinBp: state.proteinBp,
    carbBp: state.carbBp,
    fatBp: state.fatBp,
    slots: normalizeDisabledSlots(state.slots),
  };
}

/** Somme des points de base d'une macro sur les créneaux actifs. */
export function slotBasisPointsFor(state: PlanV2FormState, slot: MealSlotKey, macro: MacroKey): number {
  const allocation = state.slots.find((a) => a.slot === slot);
  return allocation ? readSlotBasisPoints(allocation, macro) : 0;
}

/** Les trois macros, dans l'ordre canonique — réexporté pour les vues. */
export { MACRO_KEYS };
