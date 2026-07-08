import type { SupabaseClient } from "@supabase/supabase-js";

import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import type { DailyNutritionLog } from "@/lib/nutrition-weekly";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès à `nutrition_daily_logs` (saisie élève réelle
 * calories/macros par jour, voir supabase/schema.sql section 17ter) pour
 * l'outil "Suivi de la semaine" de /nutrition. `student_id` est toujours
 * `students.id` — jamais `profiles.id`/`auth.users.id`/`student_profiles.id`
 * — comme le reste de lib/supabase/.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type LogRow = Database["public"]["Tables"]["nutrition_daily_logs"]["Row"];

function devWarn(context: string, error: { message: string; code?: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  }
}

function mapLogRow(row: LogRow): DailyNutritionLog {
  return {
    logDate: row.log_date,
    calories: row.calories,
    proteinG: row.protein_g,
    carbsG: row.carbs_g,
    fatG: row.fat_g,
    note: row.note,
  };
}

/** Logs d'un élève pour un plan, filtrés sur un ensemble de dates (la semaine affichée). */
export async function getNutritionLogsForDates(
  supabase: TypedSupabaseClient,
  studentId: string,
  planId: string,
  dates: string[],
): Promise<DailyNutritionLog[]> {
  if (dates.length === 0) {
    return [];
  }
  const { data, error } = await supabase
    .from("nutrition_daily_logs")
    .select("*")
    .eq("student_id", studentId)
    .eq("nutrition_plan_id", planId)
    .in("log_date", dates);
  devWarn("getNutritionLogsForDates", error);
  return (data ?? []).map(mapLogRow);
}

/** Dernier log nutrition d'un élève, tous plans confondus — pour le résumé admin. */
export async function getLatestNutritionLog(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<DailyNutritionLog | null> {
  const { data, error } = await supabase
    .from("nutrition_daily_logs")
    .select("*")
    .eq("student_id", studentId)
    .order("log_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  devWarn("getLatestNutritionLog", error);
  return data ? mapLogRow(data) : null;
}

/**
 * Enregistre (crée ou met à jour) la saisie d'un jour — upsert sur la
 * contrainte unique (student_id, nutrition_plan_id, log_date), un seul log
 * par élève/plan/date quel que soit le nombre de sauvegardes successives.
 */
export async function upsertNutritionDailyLog(
  supabase: TypedSupabaseClient,
  studentId: string,
  planId: string,
  log: { logDate: string; calories: number | null; proteinG: number | null; carbsG: number | null; fatG: number | null; note: string },
): Promise<boolean> {
  const { error } = await supabase
    .from("nutrition_daily_logs")
    .upsert(
      {
        student_id: studentId,
        nutrition_plan_id: planId,
        log_date: log.logDate,
        calories: log.calories,
        protein_g: log.proteinG,
        carbs_g: log.carbsG,
        fat_g: log.fatG,
        note: log.note,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,nutrition_plan_id,log_date" },
    );
  devWarn("upsertNutritionDailyLog", error);
  if (!error) {
    await logActivityEvent(supabase, {
      studentId,
      actorType: "student",
      eventType: "nutrition_log_filled",
      title: "Suivi nutrition rempli",
      description: `Suivi nutrition rempli pour le ${new Date(log.logDate).toLocaleDateString("fr-FR")}.`,
      metadata: buildStudentActivityLink(studentId),
    });
  }
  return !error;
}
