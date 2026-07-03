import { AlertTriangle } from "lucide-react";

import { formatSets, formatTonnage, formatVolume, muscleGroupLabels } from "@/lib/training-metrics";
import type { MuscleGroupVolume } from "@/types";

export function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "positive" | "negative" }) {
  const toneClass = tone === "positive" ? "text-green-400" : tone === "negative" ? "text-red-400" : "text-foreground";
  return (
    <div className="border border-border bg-background p-4">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`mt-1 block font-heading text-xl font-extrabold ${toneClass}`}>{value}</span>
    </div>
  );
}

interface TrainingStatCardsProps {
  totalSets: number;
  totalVolume: number;
  totalTonnageKg: number;
  hasEstimatedValues?: boolean;
  hasNotCalculatedValues?: boolean;
}

export function TrainingStatCards({
  totalSets,
  totalVolume,
  totalTonnageKg,
  hasEstimatedValues,
  hasNotCalculatedValues,
}: TrainingStatCardsProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Volume" value={formatVolume(totalVolume)} />
        <StatCard label="Séries totales" value={formatSets(totalSets)} />
        <StatCard label="Tonnage estimé" value={formatTonnage(totalTonnageKg)} />
      </div>
      {(hasEstimatedValues || hasNotCalculatedValues) && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {hasNotCalculatedValues
            ? "Certaines charges (poids du corps, machine sans charge...) ne sont pas incluses dans le tonnage."
            : "Valeurs prévisionnelles : reps et/ou charges saisies en fourchette, moyenne utilisée pour l'estimation."}
        </p>
      )}
    </div>
  );
}

interface MuscleGroupBarsProps {
  breakdown: MuscleGroupVolume[];
  alertThreshold?: number;
}

/**
 * Barres simples séries/groupe musculaire, triées par volume de séries
 * décroissant. Affiche une alerte visuelle si le groupe le plus sollicité
 * dépasse largement la moyenne des autres groupes (déséquilibre).
 */
export function MuscleGroupBars({ breakdown, alertThreshold = 1.8 }: MuscleGroupBarsProps) {
  if (breakdown.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun exercice avec groupe musculaire pour le moment.</p>;
  }

  const sorted = [...breakdown].sort((a, b) => b.sets - a.sets);
  const max = sorted[0].sets;
  const others = sorted.slice(1);
  const avgOthers = others.length > 0 ? others.reduce((sum, m) => sum + m.sets, 0) / others.length : 0;
  const showImbalanceAlert = others.length > 0 && avgOthers > 0 && max / avgOthers >= alertThreshold;

  return (
    <div className="flex flex-col gap-3">
      {showImbalanceAlert && (
        <div className="flex items-center gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {muscleGroupLabels[sorted[0].muscleGroup]} reçoit beaucoup plus de séries que les autres groupes musculaires.
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {sorted.map((entry) => (
          <div key={entry.muscleGroup}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="uppercase tracking-wide text-foreground">{muscleGroupLabels[entry.muscleGroup]}</span>
              <span className="text-muted-foreground">{formatSets(entry.sets)}</span>
            </div>
            <div className="h-2 w-full bg-border">
              <div
                className="h-2 bg-primary transition-all"
                style={{ width: `${max > 0 ? Math.max(4, (entry.sets / max) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
