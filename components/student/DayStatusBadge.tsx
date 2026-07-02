import type { NutritionDayStatus } from "@/types";

const statusLabels: Record<NutritionDayStatus, string> = {
  "non-commence": "Non commencé",
  "en-cours": "En cours",
  valide: "Validé",
};

const statusStyles: Record<NutritionDayStatus, string> = {
  "non-commence": "border-border text-muted-foreground",
  "en-cours": "border-primary/40 bg-primary/10 text-primary",
  valide: "border-green-500/40 bg-green-500/10 text-green-400",
};

export function DayStatusBadge({ status }: { status: NutritionDayStatus }) {
  return (
    <span
      className={`inline-block whitespace-nowrap border px-2.5 py-1 text-[10px] uppercase tracking-widest ${statusStyles[status]}`}
    >
      {statusLabels[status]}
    </span>
  );
}
