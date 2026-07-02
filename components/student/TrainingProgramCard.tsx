import { StatusBadge } from "@/components/student/StatusBadge";
import type { TrainingProgram } from "@/types";

export function TrainingProgramCard({ program }: { program: TrainingProgram }) {
  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-heading text-lg font-bold uppercase text-foreground">
          {program.name}
        </h3>
        <StatusBadge status={program.status} />
      </div>
      <p className="text-sm text-muted-foreground">{program.goal}</p>
      <div className="mt-auto flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{program.durationWeeks} semaines</span>
        <span>Niveau {program.level}</span>
      </div>
    </div>
  );
}
