/**
 * Validation d'un plan nutrition v2 — bibliothèque PURE.
 *
 * DEUX NIVEAUX STRICTEMENT SÉPARÉS :
 *
 *   1. BROUILLON (`validatePlanV2Draft`) — ce qui doit être vrai pour que
 *      le plan puisse être ENREGISTRÉ. Un brouillon incomplet est
 *      parfaitement valide : le coach sauvegarde son travail en cours.
 *      Seules les valeurs hors domaine, les créneaux inconnus ou dupliqués
 *      et les types incorrects sont refusés.
 *
 *   2. ASSIGNATION (`validatePlanV2Assignable`) — ce qui doit être vrai
 *      pour que le plan puisse être ATTRIBUÉ à un élève. Toutes les
 *      répartitions doivent alors être complètes.
 *
 * Les erreurs sont STRUCTURÉES (code, champ, macro, créneau, écart en
 * points de base), pas une chaîne unique : l'interface pourra surligner la
 * ligne fautive sans re-parser un message.
 *
 * Les plans v1 NE PASSENT PAS par cette validation : ils n'ont ni profil ni
 * répartition par créneau, et leur fonctionnement actuel est inchangé (voir
 * plan-v2-guards.ts).
 */
import { BASIS_POINTS_TOTAL, isBasisPoints } from "./basis-points";
import { hasAssignableCalories, DAILY_CALORIES_MAX, type MacroSplitBasisPoints } from "./macro-targets";
import {
  MACRO_KEYS,
  MEAL_SLOT_KEYS,
  describeMacroBalance,
  readSlotBasisPoints,
  type MacroKey,
  type MealSlotAllocation,
  type MealSlotKey,
} from "./meal-distribution";

/** Clé du profil unique existant aujourd'hui. Le modèle en accepte d'autres. */
export const DEFAULT_PROFILE_KEY = "default";

/** Versions du modèle nutrition portées par `nutrition_plans.nutrition_model_version`. */
export const NUTRITION_MODEL_VERSION_LEGACY = 1;
export const NUTRITION_MODEL_VERSION_STRUCTURED = 2;

/** Profil de répartition d'un plan v2 (aujourd'hui : un seul, `default`). */
export interface NutritionPlanV2Profile extends MacroSplitBasisPoints {
  readonly profileKey: string;
  readonly dailyCalories: number;
  readonly slots: readonly MealSlotAllocation[];
}

/** Forme canonique d'un plan v2, telle que relue depuis la base. */
export interface NutritionPlanV2 {
  readonly id: string;
  readonly nutritionModelVersion: number;
  readonly name: string;
  readonly profiles: readonly NutritionPlanV2Profile[];
}

export type PlanV2IssueCode =
  | "not_v2"
  | "missing_default_profile"
  | "unknown_profile_key"
  | "calories_missing"
  | "calories_not_positive"
  | "value_out_of_range"
  | "unknown_slot"
  | "duplicate_slot"
  | "missing_slot"
  | "daily_split_incomplete"
  | "protein_distribution_incomplete"
  | "carb_distribution_incomplete"
  | "fat_distribution_incomplete"
  | "disabled_slot_with_allocation"
  | "no_enabled_slot";

export interface PlanV2Issue {
  readonly code: PlanV2IssueCode;
  /** Champ concerné, en nommage base (`protein_bp`, `daily_calories`…). */
  readonly field?: string;
  readonly profileKey?: string;
  readonly slot?: MealSlotKey | string;
  readonly macro?: MacroKey;
  /** Somme attendue en points de base (10 000) quand le code s'y rapporte. */
  readonly expectedBp?: number;
  /** Somme réellement trouvée. */
  readonly actualBp?: number;
  /** Écart signé : négatif = déficit, positif = dépassement. */
  readonly deltaBp?: number;
  /** Message français prêt à afficher pour CE point précis. */
  readonly message: string;
}

export interface PlanV2ValidationResult {
  readonly ok: boolean;
  readonly issues: readonly PlanV2Issue[];
}

const MACRO_LABELS_FR: Readonly<Record<MacroKey, string>> = {
  protein: "protéines",
  carb: "glucides",
  fat: "lipides",
};

const MACRO_ISSUE_CODES: Readonly<Record<MacroKey, PlanV2IssueCode>> = {
  protein: "protein_distribution_incomplete",
  carb: "carb_distribution_incomplete",
  fat: "fat_distribution_incomplete",
};

const MACRO_FIELDS: Readonly<Record<MacroKey, string>> = {
  protein: "protein_bp",
  carb: "carb_bp",
  fat: "fat_bp",
};

function isKnownSlot(slot: string): slot is MealSlotKey {
  return (MEAL_SLOT_KEYS as readonly string[]).includes(slot);
}

/** Contrôles de DOMAINE d'un profil — communs au brouillon et à l'assignation. */
function collectDomainIssues(profile: NutritionPlanV2Profile): PlanV2Issue[] {
  const issues: PlanV2Issue[] = [];

  if (typeof profile.dailyCalories !== "number" || !Number.isFinite(profile.dailyCalories)) {
    issues.push({
      code: "calories_missing",
      field: "daily_calories",
      profileKey: profile.profileKey,
      message: "Les calories quotidiennes sont absentes ou illisibles.",
    });
  } else if (profile.dailyCalories < 0 || profile.dailyCalories > DAILY_CALORIES_MAX) {
    issues.push({
      code: "value_out_of_range",
      field: "daily_calories",
      profileKey: profile.profileKey,
      message: `Les calories quotidiennes doivent rester entre 0 et ${DAILY_CALORIES_MAX}.`,
    });
  }

  for (const macro of MACRO_KEYS) {
    const champ = MACRO_FIELDS[macro];
    const valeur =
      macro === "protein" ? profile.proteinBp : macro === "carb" ? profile.carbBp : profile.fatBp;
    if (!isBasisPoints(valeur)) {
      issues.push({
        code: "value_out_of_range",
        field: champ,
        profileKey: profile.profileKey,
        macro,
        message: `La part de ${MACRO_LABELS_FR[macro]} doit être un entier de points de base entre 0 et ${BASIS_POINTS_TOTAL}.`,
      });
    }
  }

  const vus = new Set<string>();
  for (const allocation of profile.slots) {
    if (!isKnownSlot(allocation.slot)) {
      issues.push({
        code: "unknown_slot",
        profileKey: profile.profileKey,
        slot: allocation.slot,
        message: `Créneau inconnu : « ${String(allocation.slot)} ».`,
      });
      continue;
    }
    if (vus.has(allocation.slot)) {
      issues.push({
        code: "duplicate_slot",
        profileKey: profile.profileKey,
        slot: allocation.slot,
        message: `Le créneau « ${allocation.slot} » apparaît plusieurs fois.`,
      });
      continue;
    }
    vus.add(allocation.slot);

    for (const macro of MACRO_KEYS) {
      if (!isBasisPoints(readSlotBasisPoints(allocation, macro))) {
        issues.push({
          code: "value_out_of_range",
          field: MACRO_FIELDS[macro],
          profileKey: profile.profileKey,
          slot: allocation.slot,
          macro,
          message: `La part de ${MACRO_LABELS_FR[macro]} du créneau « ${allocation.slot} » doit être un entier de points de base entre 0 et ${BASIS_POINTS_TOTAL}.`,
        });
      }
    }
  }

  for (const slot of MEAL_SLOT_KEYS) {
    if (!vus.has(slot)) {
      issues.push({
        code: "missing_slot",
        profileKey: profile.profileKey,
        slot,
        message: `Le créneau « ${slot} » est absent du profil.`,
      });
    }
  }

  return issues;
}

/** Clé du profil créé par la conversion d'un ancien plan (migration 20260811090000). */
export const LEGACY_PROFILE_KEY = "legacy_default";

/**
 * Retrouve le profil PRINCIPAL d'un plan, ou `null`.
 *
 * ORDRE DÉTERMINISTE, identique à celui de la migration 20260811090000 et de
 * la RPC `save_nutrition_plan_v2` :
 *   1. `default` — celui qu'écrivait la RPC avant la PR C ;
 *   2. `legacy_default` — celui que la conversion crée pour un ancien plan ;
 *   3. le premier par ordre alphabétique — ordre total, donc reproductible.
 *
 * Chercher UNIQUEMENT `default`, comme avant la PR C, rendait tout plan
 * converti « non assignable » : la conversion nomme son profil
 * `legacy_default`, et la validation ne le trouvait pas.
 */
export function findDefaultProfile(plan: NutritionPlanV2): NutritionPlanV2Profile | null {
  return (
    plan.profiles.find((p) => p.profileKey === DEFAULT_PROFILE_KEY) ??
    plan.profiles.find((p) => p.profileKey === LEGACY_PROFILE_KEY) ??
    plan.profiles
      .slice()
      .sort((a, b) => a.profileKey.localeCompare(b.profileKey))[0] ??
    null
  );
}

/**
 * Validité d'un BROUILLON : le plan peut-il être enregistré tel quel ?
 * Une répartition incomplète n'est PAS une erreur ici.
 */
export function validatePlanV2Draft(plan: NutritionPlanV2): PlanV2ValidationResult {
  const issues: PlanV2Issue[] = [];

  if (plan.nutritionModelVersion !== NUTRITION_MODEL_VERSION_STRUCTURED) {
    issues.push({
      code: "not_v2",
      field: "nutrition_model_version",
      message: "Ce plan n'est pas au format v2 : la validation v2 ne s'applique pas.",
    });
    return { ok: false, issues };
  }

  for (const profile of plan.profiles) {
    if (typeof profile.profileKey !== "string" || profile.profileKey.length === 0) {
      issues.push({
        code: "unknown_profile_key",
        field: "profile_key",
        message: "Un profil de répartition n'a pas de clé exploitable.",
      });
      continue;
    }
    issues.push(...collectDomainIssues(profile));
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Le plan peut-il être ASSIGNÉ à un élève ? Reprend les contrôles de
 * domaine du brouillon et y ajoute toutes les conditions de complétude.
 */
export function validatePlanV2Assignable(plan: NutritionPlanV2): PlanV2ValidationResult {
  const issues: PlanV2Issue[] = [];

  if (plan.nutritionModelVersion !== NUTRITION_MODEL_VERSION_STRUCTURED) {
    return {
      ok: false,
      issues: [
        {
          code: "not_v2",
          field: "nutrition_model_version",
          message: "Ce plan n'est pas au format v2 : la validation v2 ne s'applique pas.",
        },
      ],
    };
  }

  const profile = findDefaultProfile(plan);
  if (!profile) {
    return {
      ok: false,
      issues: [
        {
          code: "missing_default_profile",
          field: "profile_key",
          message: "Le profil de répartition « default » est absent : ce plan ne peut pas être assigné.",
        },
      ],
    };
  }

  issues.push(...collectDomainIssues(profile));

  // Calories strictement positives.
  if (typeof profile.dailyCalories === "number" && Number.isFinite(profile.dailyCalories)) {
    if (!hasAssignableCalories(profile.dailyCalories)) {
      issues.push({
        code: "calories_not_positive",
        field: "daily_calories",
        profileKey: profile.profileKey,
        message: "Renseigne des calories quotidiennes strictement positives avant d'assigner ce plan.",
      });
    }
  }

  // Répartition quotidienne P/G/L exactement à 10 000.
  const totalQuotidien = profile.proteinBp + profile.carbBp + profile.fatBp;
  if (totalQuotidien !== BASIS_POINTS_TOTAL) {
    issues.push({
      code: "daily_split_incomplete",
      profileKey: profile.profileKey,
      expectedBp: BASIS_POINTS_TOTAL,
      actualBp: totalQuotidien,
      deltaBp: totalQuotidien - BASIS_POINTS_TOTAL,
      message:
        totalQuotidien < BASIS_POINTS_TOTAL
          ? "La répartition quotidienne protéines / glucides / lipides est incomplète."
          : "La répartition quotidienne protéines / glucides / lipides dépasse 100 %.",
    });
  }

  const actifs = profile.slots.filter((s) => s.enabled);
  if (actifs.length === 0) {
    issues.push({
      code: "no_enabled_slot",
      profileKey: profile.profileKey,
      message: "Aucun repas n'est activé : active au moins un créneau avant d'assigner ce plan.",
    });
  }

  // Créneau désactivé portant une allocation non nulle.
  for (const allocation of profile.slots) {
    if (allocation.enabled) continue;
    for (const macro of MACRO_KEYS) {
      const bp = readSlotBasisPoints(allocation, macro);
      if (bp !== 0) {
        issues.push({
          code: "disabled_slot_with_allocation",
          field: MACRO_FIELDS[macro],
          profileKey: profile.profileKey,
          slot: allocation.slot,
          macro,
          actualBp: bp,
          message: `Le créneau « ${allocation.slot} » est désactivé mais porte encore une part de ${MACRO_LABELS_FR[macro]}.`,
        });
      }
    }
  }

  // Répartition par créneau, macro par macro, exactement à 10 000.
  if (actifs.length > 0) {
    for (const macro of MACRO_KEYS) {
      const balance = describeMacroBalance(profile.slots, macro);
      if (balance.status !== "complete") {
        issues.push({
          code: MACRO_ISSUE_CODES[macro],
          field: MACRO_FIELDS[macro],
          profileKey: profile.profileKey,
          macro,
          expectedBp: BASIS_POINTS_TOTAL,
          actualBp: balance.totalBp,
          deltaBp: balance.totalBp - BASIS_POINTS_TOTAL,
          message:
            balance.status === "deficit"
              ? `La répartition des ${MACRO_LABELS_FR[macro]} sur les repas est incomplète.`
              : `La répartition des ${MACRO_LABELS_FR[macro]} sur les repas dépasse 100 %.`,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Message principal affiché quand une répartition par repas est incomplète. */
export const PLAN_V2_DISTRIBUTION_MESSAGE_FR =
  "Complète la répartition des protéines, glucides et lipides sur tous les repas avant d'assigner ce plan.";

const CODES_DE_REPARTITION: ReadonlySet<PlanV2IssueCode> = new Set<PlanV2IssueCode>([
  "protein_distribution_incomplete",
  "carb_distribution_incomplete",
  "fat_distribution_incomplete",
  "daily_split_incomplete",
]);

/**
 * Message français PRINCIPAL à afficher pour un refus d'assignation.
 * `null` si le plan est assignable. Le message générique de répartition
 * prime dès qu'une somme de points de base n'atteint pas 10 000 ; sinon,
 * le premier motif structuré est retourné tel quel.
 */
export function formatPlanV2AssignabilityMessage(
  result: PlanV2ValidationResult,
): string | null {
  if (result.ok) {
    return null;
  }
  if (result.issues.some((issue) => CODES_DE_REPARTITION.has(issue.code))) {
    return PLAN_V2_DISTRIBUTION_MESSAGE_FR;
  }
  return result.issues[0]?.message ?? PLAN_V2_DISTRIBUTION_MESSAGE_FR;
}
