"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle } from "lucide-react";

import { ExerciseFeedbackCard } from "@/components/student/ExerciseFeedbackCard";
import { TrainingStatCards } from "@/components/shared/TrainingMetricsSummary";
import { useAdminData } from "@/hooks/useAdminData";
import { useSupabaseWorkoutFeedback } from "@/hooks/useSupabaseWorkoutFeedback";
import { calculatePlannedVsActualMetrics, formatTonnage } from "@/lib/training-metrics";
import { isUuid } from "@/lib/uuid";
import type {
  ActualSetEntry,
  AdminExerciseFeedbackEntry,
  AdminStudentFeedback,
  Exercise,
  ExerciseFeedback,
  ExerciseFeedbackPayload,
} from "@/types";

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
        exerciseName: exercise.name,
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

function actualEntriesFromExerciseEntries(entries: AdminExerciseFeedbackEntry[]): ActualSetEntry[] {
  return entries.map((entry) => ({
    exerciseName: entry.exerciseName,
    setNumber: entry.setNumber,
    loadUsed: entry.loadUsed,
    repsDone: entry.repsDone,
  }));
}

function PlannedVsActualSummary({
  exercises,
  sessionId,
  sessionMuscleGroup,
  exerciseEntries,
}: {
  exercises: Exercise[];
  sessionId: string;
  sessionMuscleGroup: string;
  exerciseEntries: AdminExerciseFeedbackEntry[];
}) {
  const plannedVsActual = calculatePlannedVsActualMetrics(
    { id: sessionId, muscleGroup: sessionMuscleGroup, exercises },
    actualEntriesFromExerciseEntries(exerciseEntries),
  );

  if (!plannedVsActual.actual) {
    return null;
  }

  return (
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
  );
}

interface SessionFeedbackSectionProps {
  studentId: string;
  sessionId: string;
  programId: string | null;
  sessionRefLabel: string;
  exercises: Exercise[];
  sessionMuscleGroup: string;
}

/**
 * Formulaire de retour élève par séance. Persisté en mock/localStorage via
 * useAdminData (même source que /admin/retours) : un retour envoyé ici est
 * converti en AdminStudentFeedback (type "entrainement") et apparaît
 * immédiatement côté coach. Si un retour existe déjà pour cette séance
 * (rechargement de page, ou déjà envoyé plus tôt), on affiche directement
 * le récapitulatif au lieu du formulaire vierge — un élève ne peut pas
 * envoyer deux retours pour la même séance.
 */
export function SessionFeedbackSection({
  studentId,
  sessionId,
  programId,
  sessionRefLabel,
  exercises,
  sessionMuscleGroup,
}: SessionFeedbackSectionProps) {
  const { state, addFeedback } = useAdminData();
  const mockExistingFeedback = state.feedback.find(
    (f) => f.studentId === studentId && f.sessionId === sessionId && f.type === "entrainement",
  );

  // Supabase a la priorité dès qu'un compte élève réel est identifié pour
  // l'utilisateur connecté ; sinon (Supabase non configuré, personne
  // connecté, ou compte sans fiche élève) on continue sur le mock/localStorage
  // existant (useAdminData) — voir hooks/useSupabaseWorkoutFeedback.ts.
  const supabaseFeedback = useSupabaseWorkoutFeedback(sessionId);
  const existingFeedback = supabaseFeedback.active ? supabaseFeedback.existingFeedback : mockExistingFeedback;

  const [exerciseFeedback, setExerciseFeedback] = useState(() =>
    buildInitialFeedback(exercises, studentId, sessionId),
  );
  const [completed, setCompleted] = useState(false);
  const [globalRpe, setGlobalRpe] = useState("");
  const [globalComment, setGlobalComment] = useState("");
  const [pain, setPain] = useState("");

  if (!supabaseFeedback.ready) {
    return <p className="text-sm text-muted-foreground">Chargement du retour…</p>;
  }

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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const globalRpeValue = globalRpe === "" ? null : Number(globalRpe);

    if (supabaseFeedback.active) {
      const exercisesPayload: ExerciseFeedbackPayload[] = Object.values(exerciseFeedback)
        .map((exerciseFb, index) => ({
          exerciseName: exerciseFb.exerciseName,
          exerciseOrder: index,
          rpe: exerciseFb.rpe,
          comment: exerciseFb.comment,
          sets: exerciseFb.sets
            .filter((set) => set.loadUsed.trim() || set.repsDone.trim())
            .map((set) => ({ setNumber: set.setNumber, loadUsed: set.loadUsed, repsDone: set.repsDone })),
        }))
        .filter((exerciseFb) => exerciseFb.sets.length > 0);

      await supabaseFeedback.submit({
        sessionRefLabel,
        completed,
        globalRpe: globalRpeValue,
        globalComment,
        pain,
        exercises: exercisesPayload,
        // Renseignées uniquement quand la séance vient d'un vrai programme
        // Supabase (voir lib/supabase/programs.ts) — sessionId/programId
        // mock ("session-upper", "prog-1"...) ne sont pas des uuid valides
        // et resteraient null, comme avant la migration des programmes.
        sessionId: isUuid(sessionId) ? sessionId : null,
        programId: isUuid(programId) ? programId : null,
      });
      return;
    }

    const submittedAt = new Date().toISOString();
    const exerciseEntries: AdminExerciseFeedbackEntry[] = Object.values(exerciseFeedback).flatMap(
      (exerciseFb) =>
        exerciseFb.sets
          .filter((set) => set.loadUsed.trim() || set.repsDone.trim())
          .map((set) => ({
            exerciseId: exerciseFb.exerciseId,
            exerciseName: exerciseFb.exerciseName,
            setNumber: set.setNumber,
            loadUsed: set.loadUsed,
            repsDone: set.repsDone,
            rpe: exerciseFb.rpe,
            comment: exerciseFb.comment,
          })),
    );

    const feedback: Omit<AdminStudentFeedback, "id" | "createdAt" | "updatedAt"> = {
      studentId,
      type: "entrainement",
      sessionId,
      programId,
      refLabel: sessionRefLabel,
      date: submittedAt.slice(0, 10),
      completed,
      rpe: globalRpeValue,
      pain,
      comment: globalComment,
      exerciseEntries,
      status: "a-traiter",
      coachReply: "",
    };

    addFeedback(feedback);
  }

  if (existingFeedback) {
    return (
      <div className="flex flex-col gap-6 animate-fade-in">
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

        <PlannedVsActualSummary
          exercises={exercises}
          sessionId={sessionId}
          sessionMuscleGroup={sessionMuscleGroup}
          exerciseEntries={existingFeedback.exerciseEntries}
        />
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
            className="mt-2 bg-primary py-4 text-center text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            Envoyer le retour
          </button>
        </div>
      </div>
    </form>
  );
}
