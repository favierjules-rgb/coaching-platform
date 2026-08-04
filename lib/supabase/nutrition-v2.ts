import type { SupabaseClient } from "@supabase/supabase-js";

import {
  DEFAULT_PROFILE_KEY,
  NUTRITION_MODEL_VERSION_STRUCTURED,
  type NutritionPlanV2,
  type NutritionPlanV2Profile,
} from "@/lib/nutrition/plan-v2-validation";
import { evaluateStructuredWrite } from "@/lib/nutrition/plan-v2-guards";
import { computeDailyMacroTargets } from "@/lib/nutrition/macro-targets";
import {
  MEAL_SLOT_DEFAULT_ORDER,
  MEAL_SLOT_KEYS,
  type MealSlotAllocation,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès au modèle nutrition v2 (répartition structurée).
 *
 * DEUX RESPONSABILITÉS, RIEN DE PLUS :
 *   1. LECTURE CANONIQUE d'un plan v2 (plan + profil `default` + six
 *      créneaux) — `readNutritionPlanV2` ;
 *   2. SAUVEGARDE ATOMIQUE via la RPC `save_nutrition_plan_v2`
 *      (migration 20260804090000) — `saveNutritionPlanV2`.
 *
 * SOURCES DE VÉRITÉ. Pour un plan v2 : les calories structurées, les parts
 * P/G/L et les parts par créneau, toutes en points de base entiers. Les
 * grammes, les calories par repas et `nutrition_plans.daily_target` en sont
 * DÉRIVÉS. `daily_target` reste écrit pour que le suivi nutritionnel
 * existant (lib/supabase/nutrition.ts, hooks de suivi hebdomadaire)
 * continue de fonctionner sans modification — mais ce n'est JAMAIS une
 * seconde source éditable : la RPC le régénère à chaque sauvegarde, dans la
 * même transaction.
 *
 * AUCUNE CONVERSION AU CHARGEMENT. Lire un plan v1 avec ce module renvoie
 * `null` : il n'est pas silencieusement promu en v2. Seule une sauvegarde
 * v2 explicite effectue la conversion.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(
  contexte: string,
  error: { message: string; code?: string; details?: string; hint?: string } | null,
): void {
  if (error) {
    console.error(
      `[Supabase] ${contexte} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}`,
    );
  }
}

/* ─────────────────────── Compatibilité daily_target ─────────────────────── */

/** Forme EXACTE attendue par le code existant (voir lib/supabase/nutrition.ts). */
export interface LegacyDailyTarget {
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
}

/**
 * Reconstruit le `daily_target` de compatibilité depuis un profil v2.
 * Fonction PURE, miroir exact du calcul fait par la RPC : elle sert de
 * point de contrôle testable de la parité SQL / TypeScript.
 *
 * Grammes arrondis à l'entier : le suivi existant manipule des entiers, et
 * ce JSONB n'est qu'une projection d'affichage — jamais une entrée de
 * calcul.
 */
export function buildLegacyDailyTarget(profile: NutritionPlanV2Profile): LegacyDailyTarget {
  const targets = computeDailyMacroTargets({
    dailyCalories: profile.dailyCalories,
    proteinBp: profile.proteinBp,
    carbBp: profile.carbBp,
    fatBp: profile.fatBp,
  });
  return {
    calories: Math.round(targets.dailyCalories),
    protein: Math.round(targets.grams.proteinGrams),
    carbs: Math.round(targets.grams.carbGrams),
    fat: Math.round(targets.grams.fatGrams),
  };
}

/* ─────────────────────── Lecture canonique ─────────────────────── */

interface ProfileRowShape {
  id: string;
  plan_id: string;
  profile_key: string;
  daily_calories: number;
  protein_bp: number;
  carb_bp: number;
  fat_bp: number;
}

interface SlotRowShape {
  profile_id: string;
  slot: string;
  enabled: boolean;
  protein_bp: number;
  carb_bp: number;
  fat_bp: number;
  display_order: number;
}

function isKnownSlot(slot: string): slot is MealSlotKey {
  return (MEAL_SLOT_KEYS as readonly string[]).includes(slot);
}

/**
 * Compose un profil canonique à partir de ses lignes. Les créneaux absents
 * en base sont matérialisés désactivés à zéro : la forme canonique porte
 * TOUJOURS les six créneaux, dans l'ordre d'affichage — l'appelant n'a
 * jamais à gérer un tableau partiel.
 */
export function composeProfile(
  profileRow: ProfileRowShape,
  slotRows: readonly SlotRowShape[],
): NutritionPlanV2Profile {
  const parSlot = new Map<MealSlotKey, SlotRowShape>();
  for (const row of slotRows) {
    if (isKnownSlot(row.slot)) {
      parSlot.set(row.slot, row);
    }
  }
  const slots: MealSlotAllocation[] = MEAL_SLOT_KEYS.map((slot) => {
    const row = parSlot.get(slot);
    if (!row) {
      return {
        slot,
        enabled: false,
        proteinBp: 0,
        carbBp: 0,
        fatBp: 0,
        displayOrder: MEAL_SLOT_DEFAULT_ORDER[slot],
      };
    }
    return {
      slot,
      enabled: row.enabled,
      proteinBp: row.protein_bp,
      carbBp: row.carb_bp,
      fatBp: row.fat_bp,
      displayOrder: row.display_order,
    };
  }).sort((a, b) => a.displayOrder - b.displayOrder);

  return {
    profileKey: profileRow.profile_key,
    dailyCalories: profileRow.daily_calories,
    proteinBp: profileRow.protein_bp,
    carbBp: profileRow.carb_bp,
    fatBp: profileRow.fat_bp,
    slots,
  };
}

/**
 * Lecture CANONIQUE d'un plan v2 : plan + profil `default` + six créneaux.
 *
 * Renvoie `null` si le plan est absent, invisible (RLS) ou encore en v1 —
 * jamais de conversion implicite. L'appelant qui veut lire un plan v1
 * continue d'utiliser lib/supabase/nutrition.ts, inchangé.
 */
export async function readNutritionPlanV2(
  supabase: TypedSupabaseClient,
  planId: string,
): Promise<NutritionPlanV2 | null> {
  const { data: planRow, error: planError } = await supabase
    .from("nutrition_plans")
    .select("id, name, nutrition_model_version")
    .eq("id", planId)
    .maybeSingle();
  devWarn("readNutritionPlanV2 (nutrition_plans)", planError);
  if (!planRow) {
    return null;
  }
  if (planRow.nutrition_model_version !== NUTRITION_MODEL_VERSION_STRUCTURED) {
    return null;
  }

  const { data: profileRows, error: profileError } = await supabase
    .from("nutrition_plan_profiles")
    .select("id, plan_id, profile_key, daily_calories, protein_bp, carb_bp, fat_bp")
    .eq("plan_id", planId);
  devWarn("readNutritionPlanV2 (nutrition_plan_profiles)", profileError);
  const profils = profileRows ?? [];
  if (profils.length === 0) {
    return {
      id: planRow.id,
      nutritionModelVersion: planRow.nutrition_model_version,
      name: planRow.name,
      profiles: [],
    };
  }

  const { data: slotRows, error: slotError } = await supabase
    .from("nutrition_meal_slot_targets")
    .select("profile_id, slot, enabled, protein_bp, carb_bp, fat_bp, display_order")
    .in(
      "profile_id",
      profils.map((p) => p.id),
    );
  devWarn("readNutritionPlanV2 (nutrition_meal_slot_targets)", slotError);
  const creneaux = slotRows ?? [];

  return {
    id: planRow.id,
    nutritionModelVersion: planRow.nutrition_model_version,
    name: planRow.name,
    profiles: profils.map((profil) =>
      composeProfile(
        profil,
        creneaux.filter((c) => c.profile_id === profil.id),
      ),
    ),
  };
}

/* ─────────────────────── Sauvegarde atomique ─────────────────────── */

export interface SaveNutritionPlanV2Input {
  /** `null` pour créer un plan, sinon l'identifiant du plan à écrire. */
  readonly planId: string | null;
  readonly name: string;
  readonly goalType?: string;
  readonly status?: string;
  readonly description?: string;
  readonly coachNotes?: string;
  readonly hydrationTip?: string;
  readonly profileKey?: string;
  readonly dailyCalories: number;
  readonly proteinBp: number;
  readonly carbBp: number;
  readonly fatBp: number;
  readonly slots: readonly MealSlotAllocation[];
}

export interface SaveNutritionPlanV2Success {
  readonly ok: true;
  readonly plan: NutritionPlanV2;
  readonly dailyTarget: LegacyDailyTarget;
  /** Le plan est passé de v1 à v2 lors de cette sauvegarde. */
  readonly converted: boolean;
}

export interface SaveNutritionPlanV2Failure {
  readonly ok: false;
  readonly message: string;
}

export type SaveNutritionPlanV2Result = SaveNutritionPlanV2Success | SaveNutritionPlanV2Failure;

/** Construit le payload JSON attendu par la RPC. Fonction pure, testable. */
export function buildSaveNutritionPlanV2Payload(
  input: SaveNutritionPlanV2Input,
): Record<string, unknown> {
  return {
    plan_id: input.planId,
    plan: {
      name: input.name,
      goal_type: input.goalType ?? null,
      status: input.status ?? null,
      description: input.description ?? null,
      coach_notes: input.coachNotes ?? null,
      hydration_tip: input.hydrationTip ?? null,
    },
    profile: {
      profile_key: input.profileKey ?? DEFAULT_PROFILE_KEY,
      daily_calories: input.dailyCalories,
      protein_bp: input.proteinBp,
      carb_bp: input.carbBp,
      fat_bp: input.fatBp,
    },
    slots: input.slots.map((allocation) => ({
      slot: allocation.slot,
      enabled: allocation.enabled,
      protein_bp: allocation.proteinBp,
      carb_bp: allocation.carbBp,
      fat_bp: allocation.fatBp,
      display_order: allocation.displayOrder,
    })),
  };
}

interface CanonicalRpcShape {
  plan?: { id?: string; name?: string; nutrition_model_version?: number; converted?: boolean };
  profile?: ProfileRowShape;
  slots?: SlotRowShape[];
  daily_target?: LegacyDailyTarget;
}

/**
 * Convertit le retour canonique de la RPC en objets applicatifs.
 * Fonction PURE : testable sans Supabase, et seul point où la forme du
 * JSON de la RPC est interprétée.
 */
export function parseCanonicalRpcResult(payload: unknown): SaveNutritionPlanV2Result {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, message: "Retour de la RPC illisible." };
  }
  const brut = payload as CanonicalRpcShape;
  const plan = brut.plan;
  const profile = brut.profile;
  if (!plan?.id || !profile) {
    return { ok: false, message: "Retour de la RPC incomplet : plan ou profil absent." };
  }
  const composed = composeProfile(profile, brut.slots ?? []);
  return {
    ok: true,
    converted: plan.converted === true,
    plan: {
      id: plan.id,
      nutritionModelVersion: plan.nutrition_model_version ?? NUTRITION_MODEL_VERSION_STRUCTURED,
      name: plan.name ?? "",
      profiles: [composed],
    },
    dailyTarget: brut.daily_target ?? buildLegacyDailyTarget(composed),
  };
}

/**
 * Sauvegarde ATOMIQUE d'un plan v2 : plan, profil `default`, six créneaux et
 * `daily_target` de compatibilité écrits dans UNE SEULE transaction
 * PostgreSQL. Toute erreur annule l'intégralité de l'écriture.
 *
 * `supabase-js` n'offre pas de transaction multi-requêtes : c'est
 * exactement la raison d'être de la RPC, comme pour
 * `save_training_session_blocks`.
 */
export async function saveNutritionPlanV2(
  supabase: TypedSupabaseClient,
  input: SaveNutritionPlanV2Input,
): Promise<SaveNutritionPlanV2Result> {
  // Conversion v1 → v2 : autorisée, mais UNIQUEMENT par ce chemin explicite.
  if (input.planId) {
    const { data: planRow, error } = await supabase
      .from("nutrition_plans")
      .select("nutrition_model_version")
      .eq("id", input.planId)
      .maybeSingle();
    devWarn("saveNutritionPlanV2 (lecture de version)", error);
    if (planRow) {
      const decision = evaluateStructuredWrite(planRow.nutrition_model_version);
      if (!decision.allowed) {
        return { ok: false, message: decision.message };
      }
    }
  }

  // La RPC n'est pas déclarée dans les types générés (`Functions:
  // Record<string, never>`) — même situation et même contournement que
  // lib/supabase/training-session-blocks.ts. `.bind(supabase)` est
  // OBLIGATOIRE : `SupabaseClient.rpc` s'appuie sur `this`.
  const rpc = (
    supabase.rpc as unknown as (
      fn: "save_nutrition_plan_v2",
      args: { p_payload: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);

  const { data, error } = await rpc("save_nutrition_plan_v2", {
    p_payload: buildSaveNutritionPlanV2Payload(input),
  });
  if (error) {
    devWarn("saveNutritionPlanV2 (RPC)", error);
    return { ok: false, message: error.message };
  }
  return parseCanonicalRpcResult(data);
}
