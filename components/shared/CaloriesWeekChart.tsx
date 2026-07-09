import { WEEKDAY_LABELS, type DailyNutritionLog } from "@/lib/nutrition-weekly";

/** Barres simples en CSS (pas de nouvelle dépendance graphique) — une barre par jour de la semaine courante, résumé textuel toujours affiché à côté (accessibilité : jamais uniquement le graphique). */
export function CaloriesWeekChart({
  weekDates,
  logs,
  targetCaloriesPerDay,
}: {
  weekDates: string[];
  logs: DailyNutritionLog[];
  targetCaloriesPerDay: number | null;
}) {
  const logsByDate = new Map(logs.map((log) => [log.logDate, log]));
  const values = weekDates.map((date) => logsByDate.get(date)?.calories ?? null);
  const maxValue = Math.max(targetCaloriesPerDay ?? 0, ...values.filter((v): v is number => v !== null), 1);

  return (
    <div>
      <div className="flex items-end gap-2" role="img" aria-label="Calories consommées par jour cette semaine, comparées à l'objectif quotidien">
        {weekDates.map((date, index) => {
          const value = values[index];
          const heightPercent = value !== null ? Math.max(4, Math.round((value / maxValue) * 100)) : 0;
          const overTarget = value !== null && targetCaloriesPerDay !== null && value > targetCaloriesPerDay;
          return (
            <div key={date} className="flex flex-1 flex-col items-center gap-1">
              <div className="relative flex h-32 w-full items-end justify-center border-b border-border">
                {value !== null ? (
                  <div
                    className={`w-full max-w-8 ${overTarget ? "bg-amber-500" : "bg-primary"}`}
                    style={{ height: `${heightPercent}%` }}
                  />
                ) : (
                  <div className="w-full max-w-8 border border-dashed border-border" style={{ height: "4%" }} />
                )}
              </div>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{WEEKDAY_LABELS[index].slice(0, 3)}</span>
              <span className="text-[11px] font-bold text-foreground">{value !== null ? value : "—"}</span>
            </div>
          );
        })}
      </div>
      {targetCaloriesPerDay !== null && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Objectif quotidien : {targetCaloriesPerDay} kcal. Barres orange = jour au-dessus de l&apos;objectif.
        </p>
      )}
    </div>
  );
}
