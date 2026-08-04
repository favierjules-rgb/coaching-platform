/**
 * Gardes de compatibilité v1 / v2 — bibliothèque PURE.
 *
 * PROBLÈME. Le chemin d'écriture v1 (`updateNutritionPlan` dans
 * lib/supabase/nutrition.ts) écrit `nutrition_plans.daily_target`
 * directement. Sur un plan v2, ce JSONB n'est plus une source éditable :
 * il est REGÉNÉRÉ par la RPC depuis le profil `default`. Laisser une
 * écriture v1 le modifier désynchroniserait silencieusement le suivi
 * nutritionnel de l'élève de la répartition réelle du plan.
 *
 * MATRICE RETENUE (décision Jules — refus explicite) :
 *
 *   écriture v1 sur plan v1 ........................ autorisée
 *   écriture v1 sur plan v2 ........................ REFUSÉE explicitement
 *   RPC v2 sur plan v2 ............................. autorisée
 *   RPC v2 sur plan v1 (conversion explicite) ...... autorisée
 *   conversion automatique au chargement ........... jamais
 *
 * Aucune conversion n'a lieu à la lecture : un plan v1 lu reste v1, et
 * seule une sauvegarde v2 explicite le fait passer en version 2.
 */
import {
  NUTRITION_MODEL_VERSION_LEGACY,
  NUTRITION_MODEL_VERSION_STRUCTURED,
} from "./plan-v2-validation";

export { NUTRITION_MODEL_VERSION_LEGACY, NUTRITION_MODEL_VERSION_STRUCTURED };

/** Version du modèle d'un plan, telle que lue en base. */
export type NutritionModelVersion = number;

export type WriteRefusalReason =
  /** Chemin v1 visant un plan déjà passé en v2. */
  | "legacy_write_on_v2_plan"
  /** Version du modèle absente ou non reconnue. */
  | "unknown_model_version";

export type WriteDecision =
  | { readonly allowed: true; readonly conversion: boolean }
  | { readonly allowed: false; readonly reason: WriteRefusalReason; readonly message: string };

/** Message unique de refus — repris tel quel par la couche Supabase et l'UI. */
export const LEGACY_WRITE_ON_V2_MESSAGE_FR =
  "Ce plan utilise la répartition structurée (v2) : il doit être enregistré par la sauvegarde v2, pas par l'éditeur historique.";

const UNKNOWN_VERSION_MESSAGE_FR =
  "Version du modèle nutrition inconnue : enregistrement refusé par précaution.";

/** Vrai si la version lue correspond au format structuré. */
export function isStructuredPlan(version: NutritionModelVersion | null | undefined): boolean {
  return version === NUTRITION_MODEL_VERSION_STRUCTURED;
}

/**
 * Vrai si la version lue correspond au format historique. `null`/`undefined`
 * est traité comme v1 : la colonne a pour DEFAULT 1 et aucun backfill n'a
 * eu lieu, donc une valeur absente désigne bien un plan historique.
 */
export function isLegacyPlan(version: NutritionModelVersion | null | undefined): boolean {
  return version === null || version === undefined || version === NUTRITION_MODEL_VERSION_LEGACY;
}

/**
 * Une écriture par le CHEMIN V1 est-elle autorisée sur ce plan ?
 * Refus explicite dès que le plan est en v2 — jamais de délégation
 * implicite, jamais d'écriture partielle.
 */
export function evaluateLegacyWrite(
  version: NutritionModelVersion | null | undefined,
): WriteDecision {
  if (isStructuredPlan(version)) {
    return {
      allowed: false,
      reason: "legacy_write_on_v2_plan",
      message: LEGACY_WRITE_ON_V2_MESSAGE_FR,
    };
  }
  if (isLegacyPlan(version)) {
    return { allowed: true, conversion: false };
  }
  return {
    allowed: false,
    reason: "unknown_model_version",
    message: UNKNOWN_VERSION_MESSAGE_FR,
  };
}

/**
 * Une écriture par la RPC V2 est-elle autorisée sur ce plan ?
 * Oui sur un plan v2 ; oui sur un plan v1, et il s'agit alors d'une
 * CONVERSION EXPLICITE v1 → v2 (`conversion: true`) — le seul chemin de
 * conversion existant.
 */
export function evaluateStructuredWrite(
  version: NutritionModelVersion | null | undefined,
): WriteDecision {
  if (isStructuredPlan(version)) {
    return { allowed: true, conversion: false };
  }
  if (isLegacyPlan(version)) {
    return { allowed: true, conversion: true };
  }
  return {
    allowed: false,
    reason: "unknown_model_version",
    message: UNKNOWN_VERSION_MESSAGE_FR,
  };
}

/** Un plan v2 ne doit jamais être converti en v1 au chargement. */
export function shouldConvertOnRead(): false {
  return false;
}
