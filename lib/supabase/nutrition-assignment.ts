import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

/**
 * ASSIGNATION NUTRITION — point d'écriture UNIQUE.
 *
 * POURQUOI CE MODULE EXISTE. Le bug corrigé ici : deux plans nutritionnels
 * assignés au même élève, tous deux affichés « ACTIF ». Trois causes
 * cumulées, toutes vérifiées par test :
 *
 *   1. l'ancienne écriture (`setNutritionAssignment`) faisait un UPDATE sur
 *      le SEUL plan ciblé, sans jamais regarder les autres plans de l'élève ;
 *   2. la garde applicative validait « ce plan est-il complet ? », jamais
 *      « cet élève a-t-il déjà un plan ? » ;
 *   3. la base ne portait AUCUN invariant : rien n'empêchait N lignes de
 *      partager le même `student_id`.
 *
 * LA RÈGLE PRODUIT. Un élève n'a qu'un seul plan nutritionnel assigné à un
 * instant donné. Assigner un nouveau plan valide retire automatiquement le
 * précédent — atomiquement, sans fenêtre où l'élève se retrouve sans plan.
 *
 * COMMENT. Tout passe par les RPC `assign_nutrition_plan` /
 * `unassign_nutrition_plan` (migration 20260806090000), qui verrouillent,
 * valident AVANT d'écrire, puis désassignent et assignent dans UNE
 * transaction. Aucun enchaînement client « désassigner puis assigner » :
 * ce serait deux écritures séparées, donc une fenêtre d'incohérence.
 *
 * L'invariant est en outre garanti par un index unique partiel
 * `UNIQUE (student_id) WHERE student_id IS NOT NULL` : même une écriture
 * directe fautive serait rejetée par la base.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** Codes d'échec distingués par l'interface. */
export type NutritionAssignmentErrorCode =
  | "not_authorized"
  | "plan_not_found"
  | "student_not_found"
  | "plan_not_assignable"
  | "duplicate_assignment"
  | "unknown";

export type NutritionAssignmentResult =
  | {
      readonly ok: true;
      readonly planId: string;
      readonly studentId: string | null;
      /** Plans retirés à cet élève dans la MÊME transaction. */
      readonly unassignedPlanIds: readonly string[];
      readonly assigned: boolean;
    }
  | {
      readonly ok: false;
      readonly code: NutritionAssignmentErrorCode;
      readonly message: string;
    };

/** Message affiché quand un plan v2 n'est pas encore complet. */
export const ASSIGN_REFUSED_INCOMPLETE_FR =
  "Complète la répartition des protéines, glucides et lipides sur tous les repas avant d'assigner ce plan.";

/** Message affiché quand la base refuse l'écriture alors que l'interface l'avait autorisée. */
export const ASSIGN_REFUSED_BY_DATABASE_FR =
  "L'assignation a été refusée : le plan a probablement été modifié entre-temps. Recharge la page puis réessaie.";

const MESSAGES_FR: Record<NutritionAssignmentErrorCode, string> = {
  not_authorized: "Tu n'as pas les droits nécessaires pour assigner un plan nutritionnel.",
  plan_not_found: "Ce plan nutritionnel est introuvable : il a peut-être été supprimé.",
  student_not_found: "Cet élève est introuvable : il a peut-être été supprimé.",
  plan_not_assignable: ASSIGN_REFUSED_INCOMPLETE_FR,
  duplicate_assignment: ASSIGN_REFUSED_BY_DATABASE_FR,
  unknown: ASSIGN_REFUSED_BY_DATABASE_FR,
};

/**
 * Traduit une erreur PostgreSQL en code + message français.
 *
 * Fonction PURE : testable sans Supabase, et seul endroit où la forme des
 * messages de la RPC est interprétée.
 */
export function describeNutritionAssignmentError(raw: string | null | undefined): {
  code: NutritionAssignmentErrorCode;
  message: string;
} {
  const texte = raw ?? "";
  const code: NutritionAssignmentErrorCode = texte.includes("NOT_AUTHORIZED")
    ? "not_authorized"
    : texte.includes("PLAN_NOT_ASSIGNABLE")
      ? "plan_not_assignable"
      : texte.includes("PLAN_NOT_FOUND")
        ? "plan_not_found"
        : texte.includes("STUDENT_NOT_FOUND")
          ? "student_not_found"
          : texte.includes("nutrition_plans_one_plan_per_student")
            ? "duplicate_assignment"
            : "unknown";
  return { code, message: MESSAGES_FR[code] };
}

interface RpcShape {
  plan?: { id?: string; student_id?: string | null };
  unassigned_plan_ids?: unknown;
  assigned?: boolean;
}

/** Convertit le retour canonique des RPC. Fonction PURE. */
export function parseNutritionAssignmentResult(data: unknown): NutritionAssignmentResult {
  const shape = (data ?? {}) as RpcShape;
  const planId = shape.plan?.id;
  if (typeof planId !== "string") {
    return { ok: false, code: "unknown", message: MESSAGES_FR.unknown };
  }
  const retires = Array.isArray(shape.unassigned_plan_ids)
    ? shape.unassigned_plan_ids.filter((id): id is string => typeof id === "string")
    : [];
  return {
    ok: true,
    planId,
    studentId: shape.plan?.student_id ?? null,
    unassignedPlanIds: retires,
    assigned: shape.assigned === true,
  };
}

// Les RPC ne sont pas déclarées dans les types générés (`Functions:
// Record<string, never>`) — même situation et même contournement que
// lib/supabase/nutrition-v2.ts. `.bind(supabase)` est OBLIGATOIRE :
// `SupabaseClient.rpc` s'appuie sur `this`.
function boundRpc(supabase: TypedSupabaseClient) {
  return (
    supabase.rpc as unknown as (
      fn: "assign_nutrition_plan" | "unassign_nutrition_plan",
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
}

/**
 * Assigne un plan à un élève. UNE transaction : verrouillage, validation
 * complète, retrait des autres plans de l'élève, puis assignation. Un refus
 * ne modifie AUCUNE ligne — l'ancien plan de l'élève reste en place.
 *
 * Idempotente : réassigner le même plan au même élève ne le désassigne pas.
 */
export async function assignNutritionPlan(
  supabase: TypedSupabaseClient,
  planId: string,
  studentId: string,
): Promise<NutritionAssignmentResult> {
  const { data, error } = await boundRpc(supabase)("assign_nutrition_plan", {
    p_plan_id: planId,
    p_student_id: studentId,
  });
  if (error) {
    return { ok: false, ...describeNutritionAssignmentError(error.message) };
  }
  return parseNutritionAssignmentResult(data);
}

/**
 * Retire l'assignation d'un plan. TOUJOURS autorisé, y compris sur un plan
 * invalide — sans quoi un élève resterait prisonnier d'un plan qu'on ne peut
 * plus corriger. Idempotent.
 */
export async function unassignNutritionPlan(
  supabase: TypedSupabaseClient,
  planId: string,
): Promise<NutritionAssignmentResult> {
  const { data, error } = await boundRpc(supabase)("unassign_nutrition_plan", {
    p_plan_id: planId,
  });
  if (error) {
    return { ok: false, ...describeNutritionAssignmentError(error.message) };
  }
  return parseNutritionAssignmentResult(data);
}
