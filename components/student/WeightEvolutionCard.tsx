import { TrendingDown, TrendingUp } from "lucide-react";

import { UpdateWeightModal } from "@/components/student/UpdateWeightModal";
import { WeightChart } from "@/components/student/WeightChart";
import { computeWeightEvolution } from "@/lib/profile";
import type { StudentProfile, WeightEntry } from "@/types";

interface WeightEvolutionCardProps {
  profile: StudentProfile;
  history: WeightEntry[] | null | undefined;
  onUpdateWeight: (weightKg: number) => void;
  onUpdateTarget: (targetKg: number) => void;
}

export function WeightEvolutionCard({
  profile,
  history,
  onUpdateWeight,
  onUpdateTarget,
}: WeightEvolutionCardProps) {
  const safeHistory = Array.isArray(history) ? history : [];
  const evolution = computeWeightEvolution(safeHistory, profile);

  return (
    <div className="border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Évolution du poids
        </h2>
        <UpdateWeightModal
          currentWeightKg={profile?.currentWeightKg ?? 0}
          targetWeightKg={profile?.targetWeightKg ?? 0}
          onUpdateWeight={onUpdateWeight}
          onUpdateTarget={onUpdateTarget}
        />
      </div>

      {!evolution.hasData ? (
        <p className="text-sm text-muted-foreground">
          Pas encore assez de données pour afficher l&apos;évolution du poids.
        </p>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                Départ
              </span>
              <span className="font-heading text-2xl font-bold text-foreground">
                {evolution.startWeightKg} kg
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                Actuel
              </span>
              <span className="font-heading text-2xl font-bold text-primary">
                {evolution.currentWeightKg} kg
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                Objectif
              </span>
              <span className="font-heading text-2xl font-bold text-foreground">
                {evolution.targetWeightKg} kg
              </span>
            </div>
            <div>
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                Différence
              </span>
              <span
                className={`flex items-center gap-1 font-heading text-2xl font-bold ${
                  evolution.deltaFromStartKg >= 0 ? "text-green-400" : "text-red-400"
                }`}
              >
                {evolution.deltaFromStartKg >= 0 ? (
                  <TrendingUp size={18} />
                ) : (
                  <TrendingDown size={18} />
                )}
                {evolution.deltaFromStartKg >= 0 ? "+" : ""}
                {evolution.deltaFromStartKg} kg
              </span>
            </div>
          </div>

          <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Progression vers l&apos;objectif</span>
            <span className="text-foreground">{evolution.progressPercent}%</span>
          </div>
          <div className="mb-6 h-2 w-full border border-border bg-background">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${evolution.progressPercent}%` }}
            />
          </div>

          <WeightChart data={safeHistory} />
        </>
      )}
    </div>
  );
}
