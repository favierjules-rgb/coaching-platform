"use client";

import { useState } from "react";

import {
  AnalysisFilterLabel,
  FilteredExerciseList,
  MuscleGroupBars,
  MuscleGroupFilterSelect,
  TrainingStatCards,
  UntaggedExercisesAlert,
} from "@/components/shared/TrainingMetricsSummary";
import { calculateTrainingMetrics, formatSets, type MetricsSessionInput } from "@/lib/training-metrics";
import type { MuscleGroupFilter } from "@/types";

export function WeekAnalysisSection({ sessions }: { sessions: MetricsSessionInput[] }) {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");
  const weekMetrics = calculateTrainingMetrics(sessions, selectedMuscleGroup);
  const dayLoad = sessions
    .map((s) => ({ day: s.day ?? s.id, sets: s.exercises.reduce((sum, ex) => sum + ex.sets, 0) }))
    .sort((a, b) => b.sets - a.sets);

  return (
    <div className="mb-8 rounded-card border border-border bg-card p-6 shadow-soft">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Analyse de la semaine</h2>
      <div className="flex flex-col gap-6">
        <MuscleGroupFilterSelect value={selectedMuscleGroup} onChange={setSelectedMuscleGroup} />
        <UntaggedExercisesAlert show={weekMetrics.hasUntaggedExercises} />
        <AnalysisFilterLabel selected={selectedMuscleGroup} />

        <TrainingStatCards
          totalSets={weekMetrics.totalSets}
          totalVolume={weekMetrics.totalVolume}
          totalTonnageKg={weekMetrics.totalTonnageKg}
        />

        {selectedMuscleGroup === "tous" ? (
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Séries par groupe musculaire
            </h3>
            <MuscleGroupBars breakdown={weekMetrics.muscleGroupBreakdown} />
          </div>
        ) : (
          <FilteredExerciseList exercises={weekMetrics.exercises} />
        )}

        {dayLoad.length > 0 && (
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Jours les plus chargés
            </h3>
            <div className="flex flex-wrap gap-2">
              {dayLoad.map((d) => (
                <span key={d.day} className="rounded-full border border-border bg-surface-soft/50 px-3 py-1.5 text-xs text-foreground">
                  {d.day} · {formatSets(d.sets)}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
