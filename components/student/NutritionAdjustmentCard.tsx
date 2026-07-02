import type { NutritionAdjustment, NutritionAdjustmentTone } from "@/types";

const toneBorder: Record<NutritionAdjustmentTone, string> = {
  "no-data": "border-border",
  "on-track": "border-green-500/50 bg-green-500/5",
  over: "border-amber-500/50 bg-amber-500/5",
  under: "border-amber-500/50 bg-amber-500/5",
  "week-complete": "border-primary bg-primary/10",
};

function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("fr-FR");
}

export function NutritionAdjustmentCard({
  adjustment,
}: {
  adjustment: NutritionAdjustment;
}) {
  const { summary } = adjustment;

  return (
    <div className={`border p-6 ${toneBorder[adjustment.tone]}`}>
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
        Ajustement semaine
      </h2>

      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div>
          <div className="font-heading text-xl font-bold text-foreground">
            {formatKcal(summary.weeklyTargetCalories)}
          </div>
          <div className="text-xs text-muted-foreground">
            Objectif semaine (kcal)
          </div>
        </div>
        <div>
          <div className="font-heading text-xl font-bold text-foreground">
            {formatKcal(summary.consumedCalories)}
          </div>
          <div className="text-xs text-muted-foreground">
            Consommé actuellement
          </div>
        </div>
        <div>
          <div className="font-heading text-xl font-bold text-foreground">
            {formatKcal(summary.remainingCalories)}
          </div>
          <div className="text-xs text-muted-foreground">Reste à consommer</div>
        </div>
        <div>
          <div className="font-heading text-xl font-bold text-foreground">
            {summary.daysRemaining}
          </div>
          <div className="text-xs text-muted-foreground">Jours restants</div>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-foreground">
        {adjustment.message}
      </p>
    </div>
  );
}
