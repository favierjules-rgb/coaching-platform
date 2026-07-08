import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type { NutritionPlanBuilderData } from "@/components/admin/NutritionPlanBuilder";
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
 * Même principe que lib/supabase/programs.ts : lectures toujours "vides"
 * plutôt que d'exception, écritures en delete+reinsert pour la structure
 * (jours/repas) car NutritionPlanBuilder renvoie systématiquement le jeu
 * complet des 7 jours.
 *
 * Le suivi jour par jour de l'élève ("actual", validation de journée,
 * ajustement calorique — hooks/useNutritionTracking.ts côté mock) reste
 * volontairement hors périmètre : non demandé pour cette étape (lecture
 * seule côté élève), et une future migration séparée.
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

const STATUS_APP_TO_DB: Record<AdminNutritionPlan["status"], NutritionPlanRow["status"]> = {
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
    goalType: row.goal_type,
    caloriesPerDay: dailyTarget.calories ?? 0,
    protein: dailyTarget.protein ?? 0,
    carbs: dailyTarget.carbs ?? 0,
    fat: dailyTarget.fat ?? 0,
    weeklyTargetCalories: row.weekly_target_calories ?? 0,
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

/** Insère les jours/repas d'un plan déjà créé (partagé par create/update). */
async function insertNutritionStructure(
  supabase: TypedSupabaseClient,
  planId: string,
  days: AdminNutritionDay[],
): Promise<void> {
  for (const day of days) {
    const { data: dayRow, error: dayError } = await supabase
      .from("nutrition_days")
      .insert({ plan_id: planId, day: day.day })
      .select("id")
      .single();
    devWarn("insertNutritionStructure (nutrition_days)", dayError);
    if (!dayRow) continue;

    if (day.meals.length > 0) {
      const { error: mealsError } = await supabase.from("meals").insert(
        day.meals.map((meal) => ({
          nutrition_day_id: dayRow.id,
          slot: meal.slot,
          name: meal.name,
          items: meal.items,
          macros: { calories: meal.calories, protein: meal.protein, carbs: meal.carbs, fat: meal.fat },
          coach_notes: meal.coachNotes,
        })),
      );
      devWarn("insertNutritionStructure (meals)", mealsError);
    }
  }
}

function planFields(data: NutritionPlanBuilderData) {
  return {
    name: data.name,
    goal_type: data.goalType,
    daily_target: { calories: data.caloriesPerDay, protein: data.protein, carbs: data.carbs, fat: data.fat },
    weekly_target_calories: data.weeklyTargetCalories,
    status: STATUS_APP_TO_DB[data.status],
    coach_notes: data.coachNotes,
    hydration_tip: data.hydrationTip,
    supplements: data.supplements,
    shopping_list: data.shoppingList,
  };
}

/** Crée un nouveau plan alimentaire réel avec toute sa structure (jours/repas). */
export async function createNutritionPlan(supabase: TypedSupabaseClient, data: NutritionPlanBuilderData): Promise<string | null> {
  const { data: planRow, error: planError } = await supabase
    .from("nutrition_plans")
    .insert(planFields(data))
    .select("id")
    .single();
  devWarn("createNutritionPlan", planError);
  if (!planRow) {
    return null;
  }

  await insertNutritionStructure(supabase, planRow.id, data.days);
  return planRow.id;
}

/**
 * Met à jour un plan existant : les champs du plan sont modifiés en place,
 * mais sa structure (jours/repas) est entièrement remplacée (delete +
 * reinsert) — NutritionPlanBuilder renvoie systématiquement le jeu complet
 * des 7 jours, et la suppression des nutrition_days cascade jusqu'aux repas
 * (voir supabase/schema.sql). Même choix que updateProgram.
 */
export async function updateNutritionPlan(
  supabase: TypedSupabaseClient,
  planId: string,
  data: NutritionPlanBuilderData,
): Promise<boolean> {
  const { error: updateError } = await supabase
    .from("nutrition_plans")
    .update({ ...planFields(data), updated_at: new Date().toISOString() })
    .eq("id", planId);
  devWarn("updateNutritionPlan", updateError);

  const { error: deleteError } = await supabase.from("nutrition_days").delete().eq("plan_id", planId);
  devWarn("updateNutritionPlan (delete previous structure)", deleteError);

  await insertNutritionStructure(supabase, planId, data.days);
  return !updateError;
}

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
 * Assigne/retire un plan alimentaire réel à un élève réel en écrivant
 * directement `nutrition_plans.student_id` — source de vérité unique pour
 * l'assignation nutrition (PAS la table `assignments`, réservée aux
 * programmes). Assigner = `student_id = studentId` ; retirer =
 * `student_id = null`. Un plan n'a jamais plus d'un élève assigné à la fois.
 */
export async function setNutritionAssignment(
  supabase: TypedSupabaseClient,
  studentId: string,
  planId: string,
  assigned: boolean,
): Promise<boolean> {
  const { error } = await supabase
    .from("nutrition_plans")
    .update({ student_id: assigned ? studentId : null, updated_at: new Date().toISOString() })
    .eq("id", planId);
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
