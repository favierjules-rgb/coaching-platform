"use client";

import { useState } from "react";
import { BarChart3 } from "lucide-react";

import {
  AnalysisFilterLabel,
  FilteredExerciseList,
  MuscleGroupBars,
  MuscleGroupFilterSelect,
  TrainingStatCards,
  UntaggedExercisesAlert,
} from "@/components/shared/TrainingMetricsSummary";
import { calculateSessionMetrics, type MetricsSessionInput } from "@/lib/training-metrics";
import type { MuscleGroupFilter } from "@/types";

export function SessionAnalysisSection({ session }: { session: MetricsSessionInput }) {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");
  const plannedMetrics = calculateSessionMetrics(session, selectedMuscleGroup);

  return (
    <div className="mb-8 border border-border bg-card p-6">
      <h2 className="mb-4 flex items-center gap-2 font-heading text-sm font-bold uppercase text-foreground">
        <BarChart3 size={16} className="text-primary" />
        Analyse de la séance (prévu)
      </h2>
      <div className="flex flex-col gap-4">
        <MuscleGroupFilterSelect value={selectedMuscleGroup} onChange={setSelectedMuscleGroup} />
        <UntaggedExercisesAlert show={plannedMetrics.hasUntaggedExercises} />
        <AnalysisFilterLabel selected={selectedMuscleGroup} />
        <TrainingStatCards
          totalSets={plannedMetrics.totalSets}
          totalVolume={plannedMetrics.totalVolume}
          totalTonnageKg={plannedMetrics.totalTonnageKg}
          hasEstimatedValues={plannedMetrics.hasEstimatedValues}
          hasNotCalculatedValues={plannedMetrics.hasNotCalculatedValues}
        />
        {selectedMuscleGroup === "tous" ? (
          <MuscleGroupBars breakdown={plannedMetrics.muscleGroupBreakdown} />
        ) : (
          <FilteredExerciseList exercises={plannedMetrics.exercises} />
        )}
      </div>
    </div>
  );
}
