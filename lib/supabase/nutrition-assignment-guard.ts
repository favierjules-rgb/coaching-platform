import type { SupabaseClient } from "@supabase/supabase-js";

import {
  formatPlanV2AssignabilityMessage,
  validatePlanV2Assignable,
  type PlanV2Issue,
} from "@/lib/nutrition/plan-v2-validation";
import { isStructuredPlan } from "@/lib/nutrition/plan-v2-guards";
import { readNutritionPlanV2 } from "@/lib/supabase/nutrition-v2";
import type { Database } from "@/types/supabase";

/**
 * GARDE UNIQUE d'assignation d'un plan nutrition.
 *
 * POURQUOI UN SEUL POINT. Un plan peut être assigné depuis au moins trois
 * endroits : la liste `/admin/nutrition`, la fiche du plan
 * `/admin/nutrition/[planId]`, et la fiche élève. Dupliquer la règle dans
 * chacun garantirait qu'elle diverge un jour. Tous appellent donc CETTE
 * fonction, en amont de toute écriture.
 *
 * RÈGLES :
 *   - RETRAIT d'assignation : toujours autorisé, quelle que soit la version.
 *     Un plan invalide doit pouvoir être retiré, sans quoi un élève resterait
 *     prisonnier d'un plan qu'on ne peut plus corriger.
 *   - Plan v1 : autorisé selon les règles ACTUELLES, inchangées. Aucune
 *     validation v2 ne s'applique — un plan historique n'a ni profil ni
 *     répartition par créneau.
 *   - Plan v2 : lecture canonique puis `validatePlanV2Assignable`. Le refus
 *     intervient AVANT toute écriture, donc sans jamais désassigner le plan
 *     précédent de l'élève.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

export type NutritionAssignmentDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly message: string; readonly issues: readonly PlanV2Issue[] };

/** Message affiché lorsqu'un plan v2 n'est pas encore complet. */
export const ASSIGN_V2_INCOMPLETE_MESSAGE_FR =
  "Complète la répartition des protéines, glucides et lipides sur tous les repas avant d'assigner ce plan.";

const PLAN_V2_INTROUVABLE_FR =
  "Ce plan utilise la répartition structurée mais son profil est illisible : rouvre-le et enregistre-le avant de l'assigner.";

/**
 * Le plan peut-il être assigné ? À appeler AVANT `setNutritionAssignment`.
 *
 * `modelVersion` évite une requête quand l'appelant connaît déjà la version
 * (elle vient de `AdminNutritionPlan.nutritionModelVersion`, déjà chargée
 * par la liste). Sans elle, la fonction la lit elle-même.
 */
export async function guardNutritionAssignment(
  supabase: TypedSupabaseClient,
  planId: string,
  assigned: boolean,
  modelVersion?: number | null,
): Promise<NutritionAssignmentDecision> {
  // Retrait : jamais bloqué.
  if (!assigned) {
    return { allowed: true };
  }

  let version = modelVersion;
  if (version === undefined) {
    const { data } = await supabase
      .from("nutrition_plans")
      .select("nutrition_model_version")
      .eq("id", planId)
      .maybeSingle();
    version = data?.nutrition_model_version ?? null;
  }

  // Plan v1 (ou version absente : DEFAULT 1, aucun backfill) : règles actuelles.
  if (!isStructuredPlan(version)) {
    return { allowed: true };
  }

  const plan = await readNutritionPlanV2(supabase, planId);
  if (!plan) {
    return { allowed: false, message: PLAN_V2_INTROUVABLE_FR, issues: [] };
  }

  const validation = validatePlanV2Assignable(plan);
  if (validation.ok) {
    return { allowed: true };
  }

  return {
    allowed: false,
    message: formatPlanV2AssignabilityMessage(validation) ?? ASSIGN_V2_INCOMPLETE_MESSAGE_FR,
    issues: validation.issues,
  };
}
