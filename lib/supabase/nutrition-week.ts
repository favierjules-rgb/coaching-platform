import type { SupabaseClient } from "@supabase/supabase-js";

import { MEAL_SLOT_KEYS, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type {
  PlanV2Day,
  PlanV2Week,
  PrescribedFoodItem,
  PrescribedMeal,
} from "@/lib/nutrition/plan-v2-week";
import { compareWeekdays, toWeekdayKey } from "@/lib/nutrition/weekdays";
import { readNutritionPlanV2 } from "@/lib/supabase/nutrition-v2";
import type { Database } from "@/types/supabase";

/**
 * LECTURE de la semaine d'un plan v2 : les sept jours, leur profil, et les
 * repas prescrits par le coach (outil 3).
 *
 * TROIS REQUÊTES AU TOTAL, quelle que soit la taille du plan :
 *   1. le plan, ses profils et leurs créneaux — délégué à
 *      `readNutritionPlanV2`, qui en fait déjà trois ;
 *   2. les jours du plan ;
 *   3. les repas de ces jours, en une seule requête `in (...)`.
 * Aucun N+1, aucune requête par jour.
 *
 * ORDRE EXPLICITE partout : les jours par `day` puis réordonnés en lundi →
 * dimanche côté TypeScript (PostgREST ne sait pas trier sur un ordre
 * arbitraire), les repas par créneau puis par nom. Sans cela l'affichage
 * changeait d'un chargement à l'autre.
 *
 * AUCUNE ÉCRITURE. Ce module ne connaît ni `insert`, ni `update`, ni
 * `delete` : la seule écriture d'un plan est la RPC `save_nutrition_plan_v2`.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(contexte: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${contexte} : ${error.message}`);
  }
}

interface DayRowShape {
  id: string;
  plan_id: string;
  day: string;
  status: string;
  profile_key: string;
}

interface MealRowShape {
  id: string;
  nutrition_day_id: string;
  slot: string;
  name: string;
  items: unknown;
  macros: Record<string, number> | null;
  coach_notes: string;
}

function mapItems(brut: unknown): readonly PrescribedFoodItem[] {
  if (!Array.isArray(brut)) return [];
  return brut.map((entrée) => {
    if (typeof entrée === "string") return { name: entrée, quantity: "" };
    const objet = (entrée ?? {}) as { name?: unknown; quantity?: unknown };
    return {
      name: typeof objet.name === "string" ? objet.name : "",
      quantity: typeof objet.quantity === "string" ? objet.quantity : "",
    };
  });
}

function mapMeal(row: MealRowShape): PrescribedMeal | null {
  // Le créneau est contraint en base depuis 20260811090000. Une valeur hors
  // vocabulaire ne peut venir que d'une base non migrée : on l'écarte plutôt
  // que de la rendre telle quelle, ce qui casserait le tri et l'affichage.
  if (!(MEAL_SLOT_KEYS as readonly string[]).includes(row.slot)) return null;
  const macros = row.macros ?? {};
  return {
    id: row.id,
    slot: row.slot as MealSlotKey,
    name: row.name,
    items: mapItems(row.items),
    calories: Number(macros.calories ?? 0),
    protein: Number(macros.protein ?? 0),
    carbs: Number(macros.carbs ?? 0),
    fat: Number(macros.fat ?? 0),
    coachNotes: row.coach_notes ?? "",
  };
}

/**
 * Le plan v2 COMPLET : profils, créneaux, sept jours et repas prescrits.
 * `null` si le plan est introuvable ou invisible (RLS).
 */
export async function readNutritionPlanV2Week(
  supabase: TypedSupabaseClient,
  planId: string,
): Promise<PlanV2Week | null> {
  const plan = await readNutritionPlanV2(supabase, planId);
  if (!plan) return null;

  const { data: dayRows, error: dayError } = await supabase
    .from("nutrition_days")
    .select("id, plan_id, day, status, profile_key")
    .eq("plan_id", planId)
    .order("day", { ascending: true });
  devWarn("readNutritionPlanV2Week (nutrition_days)", dayError);
  const jours = (dayRows ?? []) as unknown as DayRowShape[];

  let repas: MealRowShape[] = [];
  if (jours.length > 0) {
    const { data: mealRows, error: mealError } = await supabase
      .from("meals")
      .select("id, nutrition_day_id, slot, name, items, macros, coach_notes")
      .in(
        "nutrition_day_id",
        jours.map((j) => j.id),
      )
      .order("slot", { ascending: true })
      .order("name", { ascending: true });
    devWarn("readNutritionPlanV2Week (meals)", mealError);
    repas = (mealRows ?? []) as unknown as MealRowShape[];
  }

  const days: readonly PlanV2Day[] = jours
    .map((jour): PlanV2Day | null => {
      const cle = toWeekdayKey(jour.day);
      if (!cle) return null;
      return {
        id: jour.id,
        day: cle,
        profileKey: jour.profile_key,
        status: jour.status,
        meals: repas
          .filter((m) => m.nutrition_day_id === jour.id)
          .map(mapMeal)
          .filter((m): m is PrescribedMeal => m !== null)
          .sort(
            (a, b) =>
              MEAL_SLOT_KEYS.indexOf(a.slot) - MEAL_SLOT_KEYS.indexOf(b.slot) ||
              a.name.localeCompare(b.name, "fr") ||
              a.id.localeCompare(b.id),
          ),
      } satisfies PlanV2Day;
    })
    .filter((j): j is PlanV2Day => j !== null)
    .sort((a, b) => compareWeekdays(a.day, b.day));

  return { planId: plan.id, profiles: plan.profiles, days };
}
