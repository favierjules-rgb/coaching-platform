import { CaloriesWeekChart } from "@/components/shared/CaloriesWeekChart";
import { formatDate } from "@/lib/admin";
import type { StudentNutritionAnalytics } from "@/lib/supabase/progress";

/** Nutrition (section 5) — basé uniquement sur nutrition_daily_logs + le plan assigné, jamais de moyenne calculée sur des jours non remplis. */
export function ProgressNutritionSection({ nutrition }: { nutrition: StudentNutritionAnalytics }) {
  if (!nutrition.hasActivePlan) {
    return <p className="text-sm text-muted-foreground">Aucun plan nutrition assigné pour le moment.</p>;
  }

  if (nutrition.daysFilledThisWeek === 0) {
    return (
      <div>
        <p className="text-sm text-muted-foreground">Aucun log nutrition rempli cette semaine.</p>
        {nutrition.lastLogAt && (
          <p className="mt-1 text-xs text-muted-foreground">Dernier log enregistré le {formatDate(nutrition.lastLogAt)}.</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" role="list" aria-label="Statistiques nutrition">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Objectif kcal/jour</span>
          <span className="text-lg font-bold text-foreground">{nutrition.targetCaloriesPerDay}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Consommées (semaine)</span>
          <span className="text-lg font-bold text-foreground">{nutrition.weekCaloriesConsumed} kcal</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Moyenne kcal/jour</span>
          <span className="text-lg font-bold text-foreground">{nutrition.averageCalories}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Jours remplis</span>
          <span className="text-lg font-bold text-foreground">{nutrition.daysFilledThisWeek} / 7</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Écart vs objectif</span>
          <span className={`text-lg font-bold ${nutrition.averageVariancePercent !== null && nutrition.averageVariancePercent > 0 ? "text-amber-400" : "text-foreground"}`}>
            {nutrition.averageVariancePercent !== null ? `${nutrition.averageVariancePercent > 0 ? "+" : ""}${nutrition.averageVariancePercent}%` : "—"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Protéines moy.</span>
          <span className="text-base font-bold text-foreground">{nutrition.averageProtein !== null ? `${nutrition.averageProtein} g` : "—"}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Glucides moy.</span>
          <span className="text-base font-bold text-foreground">{nutrition.averageCarbs !== null ? `${nutrition.averageCarbs} g` : "—"}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Lipides moy.</span>
          <span className="text-base font-bold text-foreground">{nutrition.averageFat !== null ? `${nutrition.averageFat} g` : "—"}</span>
        </div>
      </div>

      <CaloriesWeekChart weekDates={nutrition.weekDates} logs={nutrition.weekLogs} targetCaloriesPerDay={nutrition.targetCaloriesPerDay} />
    </div>
  );
}
