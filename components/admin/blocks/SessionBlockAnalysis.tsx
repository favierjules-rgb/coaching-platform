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
import { calculateSessionMetrics } from "@/lib/training-metrics";
import { strengthExercisesFromBlocks, type BuilderWorkoutSession } from "@/lib/training-block-editing";
import type { MuscleGroupFilter } from "@/types";

/**
 * Analyse de charge de la séance (Lot 4.5) — portage LECTURE SEULE vers le
 * modèle canonique. Les exercices sont agrégés depuis TOUS les blocs strength
 * (`strengthExercisesFromBlocks`), jamais depuis `session.exercises[]`, puis la
 * logique de métriques existante (`calculateSessionMetrics`) et les composants
 * d'affichage partagés sont réutilisés tels quels.
 *
 * Indicateur volontairement NON porté (documenté) : le cardio n'a pas de
 * métrique de charge dans le modèle existant — comme l'ancien panneau, il n'est
 * pas comptabilisé. On n'affiche donc jamais de valeur cardio erronée.
 */
export function SessionBlockAnalysis({ session }: { session: BuilderWorkoutSession }) {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");
  const exercises = strengthExercisesFromBlocks(session.blocks);
  if (exercises.length === 0) return null;

  const metrics = calculateSessionMetrics(
    { id: session.id, muscleGroup: session.muscleGroup, isRestDay: false, exercises },
    selectedMuscleGroup,
  );

  return (
    <div className="rounded-2xl border border-border bg-background/40 p-4">
      <h4 className="mb-1 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-foreground">
        <BarChart3 size={14} className="text-primary" aria-hidden="true" />
        Analyse de la séance
      </h4>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Charge agrégée sur tous les blocs musculation. Le cardio n&apos;est pas comptabilisé ici.
      </p>
      <div className="flex flex-col gap-4">
        <MuscleGroupFilterSelect value={selectedMuscleGroup} onChange={setSelectedMuscleGroup} />
        <UntaggedExercisesAlert show={metrics.hasUntaggedExercises} />
        <AnalysisFilterLabel selected={selectedMuscleGroup} />
        <TrainingStatCards
          totalSets={metrics.totalSets}
          totalVolume={metrics.totalVolume}
          totalTonnageKg={metrics.totalTonnageKg}
          hasEstimatedValues={metrics.hasEstimatedValues}
          hasNotCalculatedValues={metrics.hasNotCalculatedValues}
        />
        {selectedMuscleGroup === "tous" ? (
          <MuscleGroupBars breakdown={metrics.muscleGroupBreakdown} />
        ) : (
          <FilteredExerciseList exercises={metrics.exercises} />
        )}
      </div>
    </div>
  );
}
