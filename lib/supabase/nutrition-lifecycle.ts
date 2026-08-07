import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isDeletionBlockCode,
  type DeletionBlockCode,
  type PlanDeletionDependencies,
  type RecipeDeletionDependencies,
} from "@/lib/nutrition/lifecycle";
import type { Database } from "@/types/supabase";

/**
 * LE CYCLE DE VIE côté données : lecture agrégée et suppressions définitives.
 *
 * TROIS RÈGLES QUI NE SE NÉGOCIENT PAS
 *
 *   1. Aucune de ces fonctions n'envoie de verdict. `deleteNutritionPlan` et
 *      `deleteNutritionRecipe` ne prennent qu'un identifiant : il n'existe
 *      aucun paramètre `canDelete`, `force` ou `confirmed` à falsifier. La
 *      base recalcule la condition dans la transaction de suppression.
 *   2. Aucun `.delete()` n'est émis depuis le navigateur. Une suppression
 *      touche cinq tables ; enchaîner cinq requêtes laisserait un plan à
 *      moitié effacé au premier échec réseau. C'est le rôle de la RPC.
 *   3. La lecture des compteurs est UNE requête pour toutes les ressources
 *      — pas une par ligne.
 *
 * CE MODULE NE CHANGE PAS DE STATUT. Archiver, publier, restaurer passent par
 * les chemins d'écriture qui existaient déjà (`updateNutritionPlanStatus` pour
 * un plan, `save_nutrition_recipe` pour une recette) : en réécrire un ici
 * créerait un second point d'écriture, et donc une seconde vérité.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

// ────────────────────────────────────────────────────────────────────────────
// L'aperçu — une seule requête
// ────────────────────────────────────────────────────────────────────────────

export interface PlanLifecycleInfo {
  readonly id: string;
  /** Statut brut en base : 'prochain' | 'actif' | 'ancien'. */
  readonly status: string;
  readonly archivedAt: string | null;
  readonly dependencies: PlanDeletionDependencies;
  /** `null` = supprimable. Recalculé côté serveur, jamais côté navigateur. */
  readonly deletionBlock: DeletionBlockCode | null;
}

export interface RecipeLifecycleInfo {
  readonly id: string;
  /** Statut brut en base : 'draft' | 'active' | 'archived'. */
  readonly status: string;
  readonly archivedAt: string | null;
  readonly dependencies: RecipeDeletionDependencies;
  readonly deletionBlock: DeletionBlockCode | null;
}

export interface NutritionLifecycleOverview {
  readonly plans: ReadonlyMap<string, PlanLifecycleInfo>;
  readonly recipes: ReadonlyMap<string, RecipeLifecycleInfo>;
}

const APERÇU_VIDE: NutritionLifecycleOverview = { plans: new Map(), recipes: new Map() };

function entier(valeur: unknown): number {
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function texteOuNull(valeur: unknown): string | null {
  return typeof valeur === "string" && valeur !== "" ? valeur : null;
}

function blocage(valeur: unknown): DeletionBlockCode | null {
  return isDeletionBlockCode(valeur) ? valeur : null;
}

/**
 * Traduit le retour de `nutrition_lifecycle_overview()`. Fonction PURE :
 * testable sans Supabase, et seul endroit où la forme du JSON est interprétée.
 *
 * TOLÉRANTE PAR CONSTRUCTION. Une entrée mal formée est ignorée plutôt que de
 * faire échouer tout l'aperçu : un compteur manquant dégrade l'affichage, il
 * ne doit pas empêcher le coach d'ouvrir sa page. La sécurité, elle, ne dépend
 * pas de ce qui est lu ici.
 */
export function parseNutritionLifecycleOverview(data: unknown): NutritionLifecycleOverview {
  const racine = (data ?? {}) as { plans?: unknown; recipes?: unknown };
  const plans = new Map<string, PlanLifecycleInfo>();
  const recipes = new Map<string, RecipeLifecycleInfo>();

  if (Array.isArray(racine.plans)) {
    for (const brut of racine.plans) {
      const ligne = (brut ?? {}) as Record<string, unknown>;
      const id = texteOuNull(ligne.id);
      if (!id) continue;
      plans.set(id, {
        id,
        status: typeof ligne.status === "string" ? ligne.status : "",
        archivedAt: texteOuNull(ligne.archived_at),
        dependencies: {
          assignedStudents: entier(ligne.assigned_students),
          dailyLogs: entier(ligne.daily_logs),
        },
        deletionBlock: blocage(ligne.deletion_block),
      });
    }
  }

  if (Array.isArray(racine.recipes)) {
    for (const brut of racine.recipes) {
      const ligne = (brut ?? {}) as Record<string, unknown>;
      const id = texteOuNull(ligne.id);
      if (!id) continue;
      recipes.set(id, {
        id,
        status: typeof ligne.status === "string" ? ligne.status : "",
        archivedAt: texteOuNull(ligne.archived_at),
        dependencies: { studentsWithAccess: entier(ligne.students_with_access) },
        deletionBlock: blocage(ligne.deletion_block),
      });
    }
  }

  return { plans, recipes };
}

// Les RPC ne sont pas déclarées dans les types générés (`Functions:
// Record<string, never>`) — même situation et même contournement que
// lib/supabase/nutrition-v2.ts. `.bind(supabase)` est OBLIGATOIRE :
// `SupabaseClient.rpc` s'appuie sur `this`.
type NomRpcCycleDeVie =
  | "nutrition_lifecycle_overview"
  | "delete_nutrition_plan"
  | "delete_nutrition_recipe";

function boundRpc(supabase: TypedSupabaseClient) {
  return (
    supabase.rpc as unknown as (
      fn: NomRpcCycleDeVie,
      args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
}

/**
 * Statut, date d'archivage, dépendances et motif de blocage de TOUTES les
 * ressources visibles — en un aller-retour.
 *
 * Un échec rend un aperçu VIDE plutôt que de lever : l'absence de compteur
 * doit dégrader l'affichage, jamais bloquer la page. Et un aperçu vide ne
 * rend rien supprimable, puisque l'absence d'entrée est traitée comme « on ne
 * sait pas ».
 */
export async function readNutritionLifecycleOverview(
  supabase: TypedSupabaseClient,
): Promise<NutritionLifecycleOverview> {
  const { data, error } = await boundRpc(supabase)("nutrition_lifecycle_overview");
  if (error) return APERÇU_VIDE;
  return parseNutritionLifecycleOverview(data);
}

// ────────────────────────────────────────────────────────────────────────────
// Les suppressions définitives
// ────────────────────────────────────────────────────────────────────────────

export interface DeletionSuccess {
  readonly ok: true;
  readonly id: string;
  readonly name: string;
  /** Ce que la base a réellement supprimé, table par table. */
  readonly deleted: Readonly<Record<string, number>>;
}

export interface DeletionRefusal {
  readonly ok: false;
  readonly reason: DeletionBlockCode;
  readonly dependencies: {
    readonly assignedStudents: number;
    readonly dailyLogs: number;
    readonly studentsWithAccess: number;
  };
}

export type DeletionResult = DeletionSuccess | DeletionRefusal;

/** Refus par défaut : tout ce qui n'est pas un succès explicite est un refus. */
const REFUS_INCONNU: DeletionRefusal = {
  ok: false,
  reason: "forbidden",
  dependencies: { assignedStudents: 0, dailyLogs: 0, studentsWithAccess: 0 },
};

/**
 * Traduit le retour des deux RPC de suppression. Fonction PURE.
 *
 * LE DÉFAUT EST LE REFUS. Une réponse illisible, tronquée ou inattendue ne
 * doit jamais être interprétée comme un succès : l'écran afficherait
 * « supprimé » sur une ressource toujours présente.
 */
export function parseDeletionResult(data: unknown, idAttendu: string): DeletionResult {
  const ligne = (data ?? {}) as Record<string, unknown>;
  const deps = (ligne.dependencies ?? {}) as Record<string, unknown>;

  if (ligne.ok === true) {
    const supprimé = (ligne.deleted ?? {}) as Record<string, unknown>;
    const compté: Record<string, number> = {};
    for (const [clé, valeur] of Object.entries(supprimé)) compté[clé] = entier(valeur);
    return {
      ok: true,
      id: texteOuNull(ligne.plan_id) ?? texteOuNull(ligne.recipe_id) ?? idAttendu,
      name: typeof ligne.name === "string" ? ligne.name : "",
      deleted: compté,
    };
  }

  const motif = blocage(ligne.reason);
  if (!motif) return REFUS_INCONNU;
  return {
    ok: false,
    reason: motif,
    dependencies: {
      assignedStudents: entier(deps.assigned_students),
      dailyLogs: entier(deps.daily_logs),
      studentsWithAccess: entier(deps.students_with_access),
    },
  };
}

/**
 * Supprime DÉFINITIVEMENT un plan alimentaire.
 *
 * Ne prend qu'un identifiant : le navigateur ne transmet aucune autorisation.
 * La base revérifie, dans la même transaction, que le plan n'est affecté à
 * personne et qu'aucune journée de suivi ne s'y rattache — puis supprime les
 * repas, jours, cibles de créneau et profils explicitement, jamais par
 * cascade aveugle.
 */
export async function deleteNutritionPlan(
  supabase: TypedSupabaseClient,
  planId: string,
): Promise<DeletionResult> {
  const { data, error } = await boundRpc(supabase)("delete_nutrition_plan", {
    p_plan_id: planId,
  });
  if (error) {
    // La RPC répond par un objet structuré pour tous les refus METIER. Une
    // erreur PostgreSQL est donc soit un refus de privilège, soit un incident :
    // dans les deux cas, rien n'a été supprimé.
    return REFUS_INCONNU;
  }
  return parseDeletionResult(data, planId);
}

/** Supprime DÉFINITIVEMENT une recette. Mêmes garanties. */
export async function deleteNutritionRecipe(
  supabase: TypedSupabaseClient,
  recipeId: string,
): Promise<DeletionResult> {
  const { data, error } = await boundRpc(supabase)("delete_nutrition_recipe", {
    p_recipe_id: recipeId,
  });
  if (error) return REFUS_INCONNU;
  return parseDeletionResult(data, recipeId);
}
