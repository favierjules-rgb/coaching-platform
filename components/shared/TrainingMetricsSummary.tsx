"use client";

import { AlertTriangle } from "lucide-react";

import { formatSets, formatTonnage, formatVolume, muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type { ExerciseMetrics, MuscleGroupFilter, MuscleGroupVolume } from "@/types";

export function StatCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "positive" | "negative" }) {
  const toneClass = tone === "positive" ? "text-success" : tone === "negative" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded-panel border border-border bg-surface-soft p-4">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`mt-1 block font-heading text-xl font-extrabold ${toneClass}`}>{value}</span>
    </div>
  );
}

interface TrainingStatCardsProps {
  totalSets: number;
  totalVolume: number;
  totalTonnageKg: number;
  hasEstimatedValues?: boolean;
  hasNotCalculatedValues?: boolean;
}

export function TrainingStatCards({
  totalSets,
  totalVolume,
  totalTonnageKg,
  hasEstimatedValues,
  hasNotCalculatedValues,
}: TrainingStatCardsProps) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Volume" value={formatVolume(totalVolume)} />
        <StatCard label="Séries totales" value={formatSets(totalSets)} />
        <StatCard label="Tonnage estimé" value={formatTonnage(totalTonnageKg)} />
      </div>
      {(hasEstimatedValues || hasNotCalculatedValues) && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {hasNotCalculatedValues
            ? "Certaines charges (poids du corps, machine sans charge...) ne sont pas incluses dans le tonnage."
            : "Valeurs prévisionnelles : reps et/ou charges saisies en fourchette, moyenne utilisée pour l'estimation."}
        </p>
      )}
    </div>
  );
}

interface MuscleGroupBarsProps {
  breakdown: MuscleGroupVolume[];
  alertThreshold?: number;
}

/**
 * Barres simples séries/groupe musculaire, triées par volume de séries
 * décroissant. Affiche une alerte visuelle si le groupe le plus sollicité
 * dépasse largement la moyenne des autres groupes (déséquilibre).
 */
export function MuscleGroupBars({ breakdown, alertThreshold = 1.8 }: MuscleGroupBarsProps) {
  if (breakdown.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun exercice avec groupe musculaire pour le moment.</p>;
  }

  const sorted = [...breakdown].sort((a, b) => b.sets - a.sets);
  const max = sorted[0].sets;
  const others = sorted.slice(1);
  const avgOthers = others.length > 0 ? others.reduce((sum, m) => sum + m.sets, 0) / others.length : 0;
  const showImbalanceAlert = others.length > 0 && avgOthers > 0 && max / avgOthers >= alertThreshold;

  return (
    <div className="flex flex-col gap-3">
      {showImbalanceAlert && (
        <div className="flex items-center gap-2 rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle size={14} className="flex-shrink-0" />
          {muscleGroupLabels[sorted[0].muscleGroup]} reçoit beaucoup plus de séries que les autres groupes musculaires.
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {sorted.map((entry) => (
          <div key={entry.muscleGroup}>
            <div className="mb-1 flex items-center justify-between gap-2 text-xs">
              <span className="uppercase tracking-wide text-foreground">{muscleGroupLabels[entry.muscleGroup]}</span>
              <span className="text-muted-foreground">{formatSets(entry.sets)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-border">
              <div
                className="h-2 rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${max > 0 ? Math.max(4, (entry.sets / max) * 100) : 0}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Sélecteur "Groupe musculaire à analyser" — réutilisé sur les 5 blocs d'analyse entraînement. */
export function MuscleGroupFilterSelect({
  value,
  onChange,
}: {
  value: MuscleGroupFilter;
  onChange: (value: MuscleGroupFilter) => void;
}) {
  return (
    <div>
      <label className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
        Groupe musculaire à analyser
      </label>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as MuscleGroupFilter)}
        className="w-full appearance-none rounded-control border border-border bg-surface-soft px-4 py-2.5 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 sm:w-64"
      >
        <option value="tous">Tous les groupes</option>
        {muscleGroupOrder.map((group) => (
          <option key={group} value={group}>
            {muscleGroupLabels[group]}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Alerte "certains exercices n'ont pas de groupe musculaire renseigné". */
export function UntaggedExercisesAlert({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="flex items-center gap-2 rounded-control border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
      <AlertTriangle size={14} className="flex-shrink-0" />
      Certains exercices n&apos;ont pas de groupe musculaire renseigné.
    </div>
  );
}

/** Bandeau "Analyse filtrée : X" affiché quand un groupe précis est sélectionné. */
export function AnalysisFilterLabel({ selected }: { selected: MuscleGroupFilter }) {
  if (selected === "tous") return null;
  return (
    <p className="text-xs font-bold uppercase tracking-widest text-primary">
      Analyse filtrée : {muscleGroupLabels[selected]}
    </p>
  );
}

/** Liste des exercices concernés par le groupe musculaire sélectionné. */
export function FilteredExerciseList({ exercises }: { exercises: ExerciseMetrics[] }) {
  if (exercises.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun exercice pour ce groupe musculaire.</p>;
  }
  return (
    <div>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Exercices concernés</h3>
      <ul className="flex flex-col gap-1.5">
        {exercises.map((ex) => (
          <li
            key={ex.exerciseId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-border px-3 py-2 text-sm text-foreground"
          >
            <span>{ex.name}</span>
            <span className="text-xs text-muted-foreground">
              {ex.sets} séries × {ex.averageReps} reps{ex.notCalculated ? "" : ` · ${formatTonnage(ex.tonnageKg)}`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
