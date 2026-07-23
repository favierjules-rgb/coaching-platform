import Link from "next/link";
import { ArrowRight, Dumbbell } from "lucide-react";

import { SessionBlockChips } from "@/components/student/SessionBlockChips";
import { derivedSessionTypeLabel } from "@/lib/session-summary";
import { deriveSessionType } from "@/lib/training-blocks";
import type { WorkoutSession } from "@/types";

export function NextSessionHighlight({
  session,
  dayLabel,
}: {
  session: WorkoutSession;
  dayLabel: string;
}) {
  // Contenu dérivé du modèle canonique `blocks[]` (jamais exercises[]/cardioBlocks[]).
  const blocks = session.blocks ?? [];
  const typeLabel = blocks.length ? derivedSessionTypeLabel(deriveSessionType(blocks)) : null;

  return (
    <div className="rounded-card border border-primary/40 bg-primary/5 p-6 shadow-soft">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Prochaine séance
        </h2>
        <span className="font-heading text-xs uppercase tracking-widest text-primary">
          {dayLabel}
        </span>
      </div>

      <div className="mb-4 flex items-center gap-4">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-panel bg-primary">
          <Dumbbell size={20} className="text-primary-foreground" />
        </div>
        <div>
          <div className="text-sm font-medium text-foreground">{session.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {session.durationMinutes} min{typeLabel ? ` · ${typeLabel}` : ""}
          </div>
        </div>
      </div>

      {blocks.length > 0 && (
        <div className="mb-4">
          <SessionBlockChips blocks={blocks} max={4} />
        </div>
      )}

      <Link
        href={`/entrainement/seance/${session.id}`}
        className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-primary text-center text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        Voir la séance <ArrowRight size={14} />
      </Link>
    </div>
  );
}
