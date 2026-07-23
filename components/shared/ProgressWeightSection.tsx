import { WeightChart } from "@/components/shared/WeightChart";
import { formatDate } from "@/lib/admin";
import type { StudentWeightProgress } from "@/lib/supabase/progress";

function DeltaLabel({ label, deltaKg }: { label: string; deltaKg: number | null }) {
  const text = deltaKg === null ? "Pas assez de recul" : `${deltaKg > 0 ? "+" : ""}${deltaKg} kg`;
  return (
    <div>
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="text-lg font-bold text-foreground">{text}</span>
    </div>
  );
}

/** Évolution du poids (section 2) — graphique + résumé textuel systématique (jamais uniquement le graphique, pour l'accessibilité). */
export function ProgressWeightSection({ weight }: { weight: StudentWeightProgress }) {
  if (weight.history.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune donnée disponible pour le moment.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Départ</span>
          <span className="text-lg font-bold text-foreground">{weight.startWeightKg ?? "—"} kg</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Actuel</span>
          <span className="text-lg font-bold text-foreground">{weight.currentWeightKg ?? "—"} kg</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Objectif</span>
          <span className="text-lg font-bold text-foreground">{weight.targetWeightKg ?? "Non renseigné"}{weight.targetWeightKg !== null ? " kg" : ""}</span>
        </div>
        <DeltaLabel label="Variation 7 jours" deltaKg={weight.delta7dKg} />
        <DeltaLabel label="Variation 30 jours" deltaKg={weight.delta30dKg} />
        <DeltaLabel label="Variation totale" deltaKg={weight.deltaTotalKg} />
      </div>

      <div>
        <WeightChart data={weight.history} />
        <p className="mt-2 text-xs text-muted-foreground">
          {weight.history.length} pesée{weight.history.length > 1 ? "s" : ""} enregistrée{weight.history.length > 1 ? "s" : ""}
          {weight.lastWeighInAt ? ` · Dernière pesée le ${formatDate(weight.lastWeighInAt)}` : ""}.
        </p>
      </div>
    </div>
  );
}
