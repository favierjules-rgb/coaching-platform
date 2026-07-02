import { getVarianceSeverity } from "@/lib/nutrition";

const severityStyles = {
  green: "border-green-500/40 bg-green-500/10 text-green-400",
  orange: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  red: "border-red-500/40 bg-red-500/10 text-red-400",
};

export function VarianceChip({ deltaKcal }: { deltaKcal: number | null }) {
  if (deltaKcal === null) {
    return (
      <span className="inline-block border border-border px-2 py-0.5 text-xs text-muted-foreground">
        —
      </span>
    );
  }

  const severity = getVarianceSeverity(deltaKcal);
  const sign = deltaKcal > 0 ? "+" : "";

  return (
    <span
      className={`inline-block border px-2 py-0.5 text-xs font-medium ${severityStyles[severity]}`}
    >
      {sign}
      {Math.round(deltaKcal)} kcal
    </span>
  );
}
