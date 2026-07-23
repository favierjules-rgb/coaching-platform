import { getVarianceSeverity } from "@/lib/nutrition";

const severityStyles = {
  green: "border-success/40 bg-success/10 text-success",
  orange: "border-warning/40 bg-warning/10 text-warning",
  red: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function VarianceChip({ deltaKcal }: { deltaKcal: number | null }) {
  if (deltaKcal === null) {
    return (
      <span className="inline-block rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
        —
      </span>
    );
  }

  const severity = getVarianceSeverity(deltaKcal);
  const sign = deltaKcal > 0 ? "+" : "";

  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${severityStyles[severity]}`}
    >
      {sign}
      {Math.round(deltaKcal)} kcal
    </span>
  );
}
