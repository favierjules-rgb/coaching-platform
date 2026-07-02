import { AlertTriangle } from "lucide-react";

import { ProfileSection, TagList } from "@/components/student/ProfileSection";
import type { InjuryNote } from "@/types";

export function InjurySection({ injury }: { injury: InjuryNote }) {
  return (
    <ProfileSection title="Blessures et contraintes">
      <div className="flex flex-col gap-4">
        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Blessures actuelles
          </span>
          {injury.currentInjuries.length > 0 ? (
            <TagList items={injury.currentInjuries} />
          ) : (
            <p className="text-sm text-muted-foreground">Aucune blessure actuelle.</p>
          )}
        </div>

        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Anciennes blessures
          </span>
          <TagList items={injury.pastInjuries} />
        </div>

        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Douleurs récurrentes
          </span>
          <TagList items={injury.recurringPain} />
        </div>

        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Mouvements à éviter
          </span>
          <TagList items={injury.movementsToAvoid} />
        </div>

        <div className="flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0 text-amber-400" />
          <p className="text-sm text-amber-400">{injury.coachRemarks}</p>
        </div>
      </div>
    </ProfileSection>
  );
}
