import Link from "next/link";

import { ProgressBar } from "@/components/student/ProgressBar";
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

      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
        <span>{program.durationWeeks} semaines</span>
        <span>Niveau {program.level}</span>
        <span>{program.sessionsPerWeek} séances / semaine</span>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">Progression</span>
          <span>{program.progressPercent}%</span>
        </div>
        <ProgressBar percent={program.progressPercent} />
      </div>

      <Link
        href={`/entrainement/${program.id}`}
        className="mt-2 block border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
      >
        Voir le programme
      </Link>
    </div>
  );
}
