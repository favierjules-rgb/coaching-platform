import { Check, X } from "lucide-react";

import { InfoRow, ProfileSection, TagList } from "@/components/student/ProfileSection";
import { goalIndicatorLabels } from "@/lib/profile";
import type { GoalIndicator, StudentGoal } from "@/types";

const allIndicators: GoalIndicator[] = [
  "poids",
  "mensurations",
  "photos",
  "performance",
  "énergie",
  "digestion",
  "sommeil",
];

const priorityLabels: Record<StudentGoal["priority"], string> = {
  haute: "Haute",
  moyenne: "Moyenne",
  basse: "Basse",
};

export function GoalsSection({ goal }: { goal: StudentGoal }) {
  return (
    <ProfileSection title="Objectifs">
      <div className="flex flex-col gap-4">
        <InfoRow label="Objectif principal" value={goal.mainGoal} />
        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Objectifs secondaires
          </span>
          <TagList items={goal.secondaryGoals} />
        </div>
        <InfoRow
          label="Date cible"
          value={new Date(goal.targetDate).toLocaleDateString("fr-FR")}
        />
        <InfoRow label="Priorité actuelle" value={priorityLabels[goal.priority]} />

        <div>
          <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
            Indicateurs suivis
          </span>
          <div className="flex flex-wrap gap-2">
            {allIndicators.map((indicator) => {
              const tracked = goal.trackedIndicators.includes(indicator);
              return (
                <span
                  key={indicator}
                  className={`flex items-center gap-1.5 border px-3 py-1 text-xs ${
                    tracked
                      ? "border-primary text-primary"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {tracked ? <Check size={12} /> : <X size={12} />}
                  {goalIndicatorLabels[indicator]}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </ProfileSection>
  );
}
