import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import { assignNutritionPlan, unassignNutritionPlan } from "@/lib/supabase/nutrition-assignment";
import type { AdminMeal, AdminNutritionDay, AdminNutritionPlan, MealSlot } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès aux plans alimentaires Supabase (tables `nutrition_plans`,
 * `nutrition_days`, `meals`). L'assignation utilise `nutrition_plans.student_id`
 * directement comme source de vérité — PAS la table générique `assignments`
 * (celle-ci reste réservée aux programmes, voir lib/supabase/programs.ts).
 * Un plan a au plus un élève assigné à la fois ; `AdminNutritionPlan.assignedStudentIds`
 * (tableau, pour rester compatible avec le type mock partagé) ne contient
 * donc jamais plus d'un id.
 *
 * ⚠️ CE MODULE N'ÉCRIT PLUS AUCUNE STRUCTURE (jours / repas).
 *
 * POURQUOI. Depuis la migration 20260811090000, `nutrition_days.profile_key`
 * est NOT NULL et porte une clé étrangère COMPOSITE
 * `(plan_id, profile_key) → nutrition_plan_profiles(plan_id, profile_key)`.
 * Le chemin d'écriture historique insérait `{ plan_id, day }` SANS
 * `profile_key` : il ne peut donc plus produire une seule ligne valide, et
 * l'insert échouerait en base. Plutôt que de le rafistoler avec une valeur
 * de profil arbitraire — ce qui rattacherait silencieusement des journées au
 * mauvais profil calorique — il a été SUPPRIMÉ (PR C.1).
 *
 * DÉCISION MÉTIER. Toute création ou modification complète d'un plan passe
 * désormais par la RPC transactionnelle `save_nutrition_plan_v2`
 * (lib/supabase/nutrition-v2.ts → `saveNutritionPlanV2`), qui écrit le plan,
 * ses profils, ses créneaux, ses journées et ses repas dans UNE transaction,
 * et qui est la seule à connaître la règle de profil par défaut.
 *
 * CE QUI RESTE ICI : les LECTURES (catalogue admin, plans assignés à un
 * élève, ids par élève), le changement de statut seul — qui ne touche ni
 * `daily_target`, ni les journées, ni les repas, et reste donc légitime sur
 * un plan v2 (archivage) — et l'assignation, elle-même déjà déléguée aux RPC
 * `assign_nutrition_plan` / `unassign_nutrition_plan`.
 *
 * Le suivi jour par jour de l'élève (`nutrition_daily_logs`, « Outil 1 »)
 * vit dans lib/supabase/nutrition-logs.ts et n'est pas concerné : ce module
 * ne l'a jamais lu ni écrit.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

type NutritionPlanRow = Database["public"]["Tables"]["nutrition_plans"]["Row"];
type MealRow = Database["public"]["Tables"]["meals"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) {
      list.push(item);
    } else {
      map.set(k, [item]);
    }
  }
  return map;
}

/**
 * `nutrition_plans.status` a une contrainte réelle différente du texte
 * français utilisé partout ailleurs dans l'app (AdminContentStatus) — même
 * situation que `students.status`, voir lib/supabase/students.ts.
 */
const STATUS_DB_TO_APP: Record<NutritionPlanRow["status"], AdminNutritionPlan["status"]> = {
  prochain: "brouillon",
  actif: "actif",
  ancien: "archivé",
};

/**
 * Exporté pour le constructeur v2 : la RPC `save_nutrition_plan_v2` écrit
 * `nutrition_plans.status` DIRECTEMENT, donc son payload doit porter la
 * valeur BASE ('actif' | 'ancien' | 'prochain'), pas le libellé applicatif.
 * Réutiliser cette table évite une seconde traduction divergente.
 */
export const STATUS_APP_TO_DB: Record<AdminNutritionPlan["status"], NutritionPlanRow["status"]> = {
  brouillon: "prochain",
  actif: "actif",
  "archivé": "ancien",
};

/* ─── Row -> AdminNutritionPlan (composition) ─── */

function mapMealRow(row: MealRow): AdminMeal {
  const macros = row.macros ?? {};
  return {
    id: row.id,
    slot: row.slot as MealSlot,
    name: row.name,
    items: row.items ?? [],
    calories: macros.calories ?? 0,
    protein: macros.protein ?? 0,
    carbs: macros.carbs ?? 0,
    fat: macros.fat ?? 0,
    coachNotes: row.coach_notes,
  };
}

function mapNutritionPlanRow(row: NutritionPlanRow, days: AdminNutritionDay[], assignedStudentIds: string[]): AdminNutritionPlan {
  const dailyTarget = row.daily_target ?? {};
  return {
    id: row.id,
    name: row.name,
    // `select("*")` remonte déjà la colonne : on l'expose simplement au
    // modèle admin pour que l'interface puisse router v1 / v2. Aucune
    // requête supplémentaire, aucune migration.
    nutritionModelVersion: row.nutrition_model_version,
    description: row.description,
    goalType: row.goal_type,
    caloriesPerDay: dailyTarget.calories ?? 0,
    protein: dailyTarget.protein ?? 0,
    carbs: dailyTarget.carbs ?? 0,
    fat: dailyTarget.fat ?? 0,
    // OBJECTIF HEBDOMADAIRE — la BASE fait autorité.
    //
    // Depuis la migration 20260805090000, `save_nutrition_plan_v2` écrit
    // elle-même `weekly_target_calories = daily_calories * 7`, à la création
    // comme à la modification, dans la même transaction que le plan, le
    // profil et les six créneaux. La ligne lue ici porte donc la vraie
    // valeur.
    //
    // Le repli ci-dessous n'est plus la correction : c'est un FILET
    // DÉFENSIF, pour un plan v2 qui aurait été écrit avant cette migration
    // (aucun en Production) ou par un chemin qui contournerait la RPC. Les
    // plans v1 conservent EXACTEMENT leur comportement d'origine (`?? 0`).
    weeklyTargetCalories:
      row.weekly_target_calories ??
      (row.nutrition_model_version === 2 ? (dailyTarget.calories ?? 0) * 7 : 0),
    status: STATUS_DB_TO_APP[row.status] ?? "brouillon",
    coachNotes: row.coach_notes,
    hydrationTip: row.hydration_tip,
    supplements: row.supplements ?? [],
    shoppingList: row.shopping_list ?? [],
    days,
    assignedStudentIds,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Charge et compose un ensemble de plans complets (jours/repas/assignation) en un minimum de requêtes. */
async function loadNutritionPlans(supabase: TypedSupabaseClient, planRows: NutritionPlanRow[]): Promise<AdminNutritionPlan[]> {
  if (planRows.length === 0) {
    return [];
  }
  const planIds = planRows.map((p) => p.id);

  const daysResult = await supabase.from("nutrition_days").select("*").in("plan_id", planIds);
  devWarn("loadNutritionPlans (nutrition_days)", daysResult.error);
  const dayRows = daysResult.data ?? [];

  const dayIds = dayRows.map((d) => d.id);
  const { data: mealRowsRaw, error: mealsError } =
    dayIds.length > 0
      ? await supabase.from("meals").select("*").in("nutrition_day_id", dayIds)
      : { data: [] as MealRow[], error: null };
  devWarn("loadNutritionPlans (meals)", mealsError);
  const mealRows = mealRowsRaw ?? [];

  const daysByPlan = groupBy(dayRows, (d) => d.plan_id);
  const mealsByDay = groupBy(mealRows, (m) => m.nutrition_day_id);

  return planRows.map((planRow) => {
    const days: AdminNutritionDay[] = (daysByPlan.get(planRow.id) ?? []).map((dayRow) => ({
      id: dayRow.id,
      planId: dayRow.plan_id,
      day: dayRow.day,
      meals: (mealsByDay.get(dayRow.id) ?? []).map(mapMealRow),
    }));
    const assignedStudentIds = planRow.student_id ? [planRow.student_id] : [];
    return mapNutritionPlanRow(planRow, days, assignedStudentIds);
  });
}

/* ─── Lecture ─── */

/** Liste de tous les plans alimentaires Supabase pour /admin/nutrition, plus récents en premier. */
export async function getNutritionPlans(supabase: TypedSupabaseClient): Promise<AdminNutritionPlan[]> {
  const { data, error } = await supabase.from("nutrition_plans").select("*").order("created_at", { ascending: false });
  devWarn("getNutritionPlans", error);
  return loadNutritionPlans(supabase, data ?? []);
}

/**
 * Tous les plans réellement assignés à un élève (nutrition_plans.student_id),
 * plus récemment modifié en premier — pour la vue élève /nutrition
 * (équivalent réel de la liste mock `nutritionPlans`). Tableau vide si aucun
 * plan n'est assigné.
 */
export async function getAssignedNutritionPlansForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminNutritionPlan[]> {
  const { data: planRows, error: plansError } = await supabase
    .from("nutrition_plans")
    .select("*")
    .eq("student_id", studentId)
    .order("updated_at", { ascending: false });
  devWarn("getAssignedNutritionPlansForStudent (nutrition_plans)", plansError);
  if (!planRows || planRows.length === 0) {
    return [];
  }

  return loadNutritionPlans(supabase, planRows);
}

/** Plan à mettre en avant ("plan actif") pour un élève, ou `null` si aucun plan n'est assigné. */
export async function getAssignedNutritionPlanForStudent(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<AdminNutritionPlan | null> {
  const plans = await getAssignedNutritionPlansForStudent(supabase, studentId);
  if (plans.length === 0) {
    return null;
  }
  return plans.find((p) => p.status === "actif") ?? plans[0];
}

/**
 * Ids des plans assignés à chaque élève (batch), pour peupler
 * AdminStudent.assignedNutritionPlanIds — voir lib/supabase/students.ts.
 * Source : nutrition_plans.student_id directement (un plan = au plus un élève).
 */
export async function getAssignedNutritionPlanIdsByStudent(
  supabase: TypedSupabaseClient,
  studentIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (studentIds.length === 0) {
    return map;
  }
  const { data, error } = await supabase
    .from("nutrition_plans")
    .select("id, student_id")
    .in("student_id", studentIds);
  devWarn("getAssignedNutritionPlanIdsByStudent", error);
  for (const row of data ?? []) {
    if (!row.student_id) continue;
    const list = map.get(row.student_id) ?? [];
    list.push(row.id);
    map.set(row.student_id, list);
  }
  return map;
}

/* ─── Écriture ─── */

/*
 * ┌───────────────────────────────────────────────────────────────────────┐
 * │ CE QUI A ÉTÉ SUPPRIMÉ ICI, ET POURQUOI (PR C.1)                       │
 * ├───────────────────────────────────────────────────────────────────────┤
 * │ `insertNutritionStructure`  insérait `nutrition_days { plan_id, day }` │
 * │                             puis `meals` en direct ;                  │
 * │ `planFields`                composait la charge utile v1 ;            │
 * │ `createNutritionPlan`       créait un plan + sa structure ;           │
 * │ `updateNutritionPlan`       remplaçait la structure en delete+insert ; │
 * │ `evaluateLegacyWriteForPlan` gardait ce chemin contre les plans v2.   │
 * │                                                                       │
 * │ Les quatre premières écrivaient `nutrition_days` SANS `profile_key`,  │
 * │ colonne devenue NOT NULL avec clé étrangère composite vers            │
 * │ `nutrition_plan_profiles` (migration 20260811090000) : elles ne       │
 * │ peuvent plus produire une ligne valide. La cinquième n'avait plus     │
 * │ d'objet une fois les quatre autres parties.                           │
 * │                                                                       │
 * │ Aucune n'avait d'appelant applicatif : l'écran de création            │
 * │ (app/admin/nutrition/nouveau) et l'écran de plan                      │
 * │ (app/admin/nutrition/[planId]) passent tous deux par                  │
 * │ `saveNutritionPlanV2` depuis la PR précédente.                        │
 * │                                                                       │
 * │ La règle de compatibilité v1/v2 elle-même n'est PAS supprimée : elle  │
 * │ reste dans lib/nutrition/plan-v2-guards.ts, module pur, et reste      │
 * │ testée (scripts/tests/nutrition-plan-v2-guards.mts, cas 1 à 5).       │
 * └───────────────────────────────────────────────────────────────────────┘
 */

/**
 * Change le seul statut d'un plan (brouillon / actif / archivé).
 *
 * Volontairement conservée pour les DEUX modèles : ce `update` ne touche ni
 * `daily_target`, ni `nutrition_days`, ni `meals`. Archiver un plan v2 est
 * une opération légitime, et la lui interdire casserait le bouton
 * « Archiver » de l'écran de plan.
 */
export async function updateNutritionPlanStatus(
  supabase: TypedSupabaseClient,
  planId: string,
  status: AdminNutritionPlan["status"],
): Promise<boolean> {
  const { error } = await supabase
    .from("nutrition_plans")
    .update({ status: STATUS_APP_TO_DB[status], updated_at: new Date().toISOString() })
    .eq("id", planId);
  devWarn("updateNutritionPlanStatus", error);
  return !error;
}

/**
 * Assigne/retire un plan alimentaire réel à un élève réel.
 * `nutrition_plans.student_id` est la source de vérité unique de
 * l'assignation nutrition (PAS la table `assignments`, réservée aux
 * programmes).
 *
 * ⚠️ CETTE FONCTION N'ÉCRIT PLUS DIRECTEMENT. Elle délègue aux RPC
 * `assign_nutrition_plan` / `unassign_nutrition_plan`
 * (lib/supabase/nutrition-assignment.ts, migration 20260806090000).
 *
 * POURQUOI. L'ancienne version faisait un UPDATE sur le seul plan ciblé :
 * assigner un plan B à un élève qui avait déjà un plan A laissait les DEUX
 * lignes avec le même `student_id`, et l'espace élève affichait deux plans
 * « ACTIF ». La RPC verrouille, valide AVANT d'écrire, retire les autres
 * plans de l'élève puis assigne le nouveau — dans UNE transaction. Un refus
 * ne modifie aucune ligne ; il n'existe aucune fenêtre sans plan.
 *
 * La signature est INCHANGÉE pour que tous les appelants existants
 * (`useContentAssignment` et les cinq points d'entrée) soient reroutés sans
 * modification.
 */
export async function setNutritionAssignment(
  supabase: TypedSupabaseClient,
  studentId: string,
  planId: string,
  assigned: boolean,
): Promise<boolean> {
  const résultat = assigned
    ? await assignNutritionPlan(supabase, planId, studentId)
    : await unassignNutritionPlan(supabase, planId);
  const error = résultat.ok ? null : { message: résultat.message, code: résultat.code };
  devWarn("setNutritionAssignment", error);
  if (!error && assigned) {
    const { data: plan } = await supabase.from("nutrition_plans").select("name").eq("id", planId).maybeSingle();
    await logActivityEvent(supabase, {
      studentId,
      actorType: "coach",
      eventType: "nutrition_assigned",
      title: "Plan nutrition assigné",
      description: plan?.name ? `Plan nutrition "${plan.name}" assigné.` : "Un plan nutrition a été assigné.",
      metadata: buildStudentActivityLink(studentId),
    });
  }
  return !error;
}
