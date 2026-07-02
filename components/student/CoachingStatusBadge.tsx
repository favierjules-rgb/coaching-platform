import type { CoachingStatus } from "@/types";
import { coachingStatusLabels } from "@/lib/profile";

const statusStyles: Record<CoachingStatus, string> = {
  actif: "border-primary text-primary",
  pause: "border-amber-500/60 text-amber-400",
  terminé: "border-border text-muted-foreground",
};

export function CoachingStatusBadge({ status }: { status: CoachingStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-2 border px-3 py-1 text-xs uppercase tracking-widest ${statusStyles[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {coachingStatusLabels[status]}
    </span>
  );
}
