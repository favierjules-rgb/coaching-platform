"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle } from "lucide-react";

import { ExerciseFeedbackCard } from "@/components/student/ExerciseFeedbackCard";
import { TrainingStatCards } from "@/components/shared/TrainingMetricsSummary";
import { calculatePlannedVsActualMetrics, formatTonnage } from "@/lib/training-metrics";
import type { ActualSetEntry, Exercise, ExerciseFeedback, PlannedVsActualTrainingMetrics, WorkoutFeedback } from "@/types";

const rpeOptions = Array.from({ length: 10 }, (_, index) => index + 1);

function buildInitialFeedback(
  exercises: Exercise[],
  studentId: string,
  sessionId: string,
): Record<string, ExerciseFeedback> {
  return Object.fromEntries(
    exercises.map((exercise) => [
      exercise.id,
      {
        studentId,
        sessionId,
        exerciseId: exercise.id,
        sets: Array.from({ length: exercise.sets }, (_, index) => ({
          studentId,
          sessionId,
          exerciseId: exercise.id,
          setNumber: index + 1,
          loadUsed: "",
          repsDone: "",
        })),
        rpe: null,
        comment: "",
      },
    ]),
  );
}

interface SessionFeedbackSectionProps {
  studentId: string;
  sessionId: string;
  exercises: Exercise[];
  sessionMuscleGroup: string;
}

export function SessionFeedbackSection({
  studentId,
  sessionId,
  exercises,
  sessionMuscleGroup,
}: SessionFeedbackSectionProps) {
  const [exerciseFeedback, setExerciseFeedback] = useState(() =>
    buildInitialFeedback(exercises, studentId, sessionId),
  );
  const [completed, setCompleted] = useState(false);
  const [globalRpe, setGlobalRpe] = useState("");
  const [globalComment, setGlobalComment] = useState("");
  const [pain, setPain] = useState("");
  const [sent, setSent] = useState(false);
  const [plannedVsActual, setPlannedVsActual] = useState<PlannedVsActualTrainingMetrics | null>(null);

  function handleSetChange(
    exerciseId: string,
    setNumber: number,
    field: "loadUsed" | "repsDone",
    value: string,
  ) {
    setExerciseFeedback((prev) => ({
      ...prev,
      [exerciseId]: {
        ...prev[exerciseId],
        sets: prev[exerciseId].sets.map((set) =>
          set.setNumber === setNumber ? { ...set, [field]: value } : set,
        ),
      },
    }));
  }

  function handleRpeChange(exerciseId: string, value: string) {
    setExerciseFeedback((prev) => ({
      ...prev,
      [exerciseId]: {
        ...prev[exerciseId],
        rpe: value === "" ? null : Number(value),
      },
    }));
  }

  function handleCommentChange(exerciseId: string, value: string) {
    setExerciseFeedback((prev) => ({
      ...prev,
      [exerciseId]: { ...prev[exerciseId], comment: value },
    }));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const workoutFeedback: WorkoutFeedback = {
      studentId,
      sessionId,
      completed,
      exercises: Object.values(exerciseFeedback),
      globalRpe: globalRpe === "" ? null : Number(globalRpe),
      globalComment,
      pain,
      submittedAt: new Date().toISOString(),
    };

    // Donnée mockée pour l'instant : aucun envoi réel n'est effectué.
    // La forme de `workoutFeedback` est prête à être envoyée à Supabase.
    console.log(workoutFeedback);

    const actualEntries: ActualSetEntry[] = workoutFeedback.exercises.flatMap((exerciseFb) => {
      const exercise = exercises.find((ex) => ex.id === exerciseFb.exerciseId);
      if (!exercise) return [];
      return exerciseFb.sets
        .filter((set) => set.loadUsed.trim() || set.repsDone.trim())
        .map((set) => ({
          exerciseName: exercise.name,
          setNumber: set.setNumber,
          loadUsed: set.loadUsed,
          repsDone: set.repsDone,
        }));
    });
    setPlannedVsActual(
      calculatePlannedVsActualMetrics({ id: sessionId, muscleGroup: sessionMuscleGroup, exercises }, actualEntries),
    );
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-6">
        <div className="border border-primary/30 bg-card p-8 text-center">
          <CheckCircle size={32} className="mx-auto mb-3 text-primary" />
          <h3 className="mb-1 font-heading text-base font-bold uppercase text-foreground">
            Retour envoyé
          </h3>
          <p className="text-sm text-muted-foreground">
            Ton coach recevra ton retour, exercice par exercice, avant la
            prochaine séance.
          </p>
        </div>

        {plannedVsActual?.actual && (
          <div className="border border-border bg-card p-6">
            <h3 className="mb-4 font-heading text-sm font-bold uppercase text-foreground">
              Prévu vs réalisé
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="border border-border p-4">
                <span className="mb-2 block text-[11px] uppercase tracking-widest text-muted-foreground">Prévu</span>
                <TrainingStatCards
                  totalSets={plannedVsActual.planned.totalSets}
                  totalVolume={plannedVsActual.planned.totalVolume}
                  totalTonnageKg={plannedVsActual.planned.totalTonnageKg}
                />
              </div>
              <div className="border border-primary/40 p-4">
                <span className="mb-2 block text-[11px] uppercase tracking-widest text-primary">Réalisé</span>
                <TrainingStatCards
                  totalSets={plannedVsActual.actual.totalSets}
                  totalVolume={plannedVsActual.actual.totalVolume}
                  totalTonnageKg={plannedVsActual.actual.totalTonnageKg}
                />
              </div>
            </div>
            {plannedVsActual.tonnageDeltaKg !== null && (
              <p className="mt-4 text-sm text-foreground">
                Tonnage réalisé : {formatTonnage(plannedVsActual.actual.totalTonnageKg)} / prévu :{" "}
                {formatTonnage(plannedVsActual.planned.totalTonnageKg)}{" "}
                <span className={plannedVsActual.tonnageDeltaKg >= 0 ? "text-green-400" : "text-red-400"}>
                  ({plannedVsActual.tonnageDeltaKg >= 0 ? "+" : ""}
                  {Math.round(plannedVsActual.tonnageDeltaKg).toLocaleString("fr-FR")} kg)
                </span>
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div>
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Exercices
        </h2>
        <div className="flex flex-col gap-4">
          {exercises.map((exercise, index) => (
            <ExerciseFeedbackCard
              key={exercise.id}
              exercise={exercise}
              index={index}
              feedback={exerciseFeedback[exercise.id]}
              onSetChange={(setNumber, field, value) =>
                handleSetChange(exercise.id, setNumber, field, value)
              }
              onRpeChange={(value) => handleRpeChange(exercise.id, value)}
              onCommentChange={(value) => handleCommentChange(exercise.id, value)}
            />
          ))}
        </div>
      </div>

      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Résumé de la séance
        </h2>

        <div className="flex flex-col gap-5">
          <label className="flex items-center gap-3 border border-border bg-background px-4 py-3 text-sm text-foreground">
            <input
              type="checkbox"
              checked={completed}
              onChange={(event) => setCompleted(event.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            Séance terminée
          </label>

          <div>
            <label
              htmlFor="global-rpe"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              RPE global
            </label>
            <select
              id="global-rpe"
              value={globalRpe}
              onChange={(event) => setGlobalRpe(event.target.value)}
              className="w-full appearance-none border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            >
              <option value="" disabled>
                Choisir une note sur 10
              </option>
              {rpeOptions.map((value) => (
                <option key={value} value={value}>
                  {value} / 10
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="global-comment"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Commentaire général
            </label>
            <textarea
              id="global-comment"
              rows={3}
              value={globalComment}
              onChange={(event) => setGlobalComment(event.target.value)}
              placeholder="Comment s'est passée la séance dans son ensemble ?"
              className="w-full resize-none border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <div>
            <label
              htmlFor="pain"
              className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
            >
              Douleur ou gêne éventuelle
            </label>
            <input
              id="pain"
              value={pain}
              onChange={(event) => setPain(event.target.value)}
              placeholder="Ex : légère gêne à l'épaule droite"
              className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
            />
          </div>

          <button
            type="submit"
            className="mt-2 bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
          >
            Envoyer le retour
          </button>
        </div>
      </div>
    </form>
  );
}
