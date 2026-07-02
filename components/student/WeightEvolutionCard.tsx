import { TrendingDown, TrendingUp } from "lucide-react";

import { MockActionModal, MockField } from "@/components/student/MockActionModal";
import { WeightChart } from "@/components/student/WeightChart";
import { computeWeightEvolution } from "@/lib/profile";
import type { StudentProfile, WeightEntry } from "@/types";

export function WeightEvolutionCard({
  profile,
  history,
}: {
  profile: StudentProfile;
  history: WeightEntry[];
}) {
  const evolution = computeWeightEvolution(history, profile);

  return (
    <div className="border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Évolution du poids
        </h2>
        <MockActionModal
          triggerLabel="Mettre à jour mon poids"
          title="Mettre à jour mon poids"
          description="Renseigne ton poids du jour. Cette action est une démonstration : aucune donnée n'est encore enregistrée."
          confirmLabel="Enregistrer"
          successMessage="Poids enregistré. Ton coach pourra le consulter."
        >
          <MockField label="Poids (kg)" type="number" placeholder={`${profile.currentWeightKg}`} />
        </MockActionModal>
      </div>

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

      <WeightChart data={history} />
    </div>
  );
}
