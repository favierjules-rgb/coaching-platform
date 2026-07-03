"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, BarChart3, Copy, Plus, Trash2 } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { ExerciseSearchPicker } from "@/components/admin/ExerciseSearchPicker";
import { PrimaryButton } from "@/components/admin/Modal";
import {
  AnalysisFilterLabel,
  FilteredExerciseList,
  MuscleGroupBars,
  MuscleGroupFilterSelect,
  TrainingStatCards,
  UntaggedExercisesAlert,
} from "@/components/shared/TrainingMetricsSummary";
import { generateId, weekDays } from "@/lib/admin";
import { calculateSessionMetrics, muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type { AdminContentStatus, AdminExercise, AdminWorkoutSession, ExerciseLibraryItem, MuscleGroupFilter } from "@/types";

const muscleGroupOptions = [
  { value: "", label: "Hérité de la séance" },
  ...muscleGroupOrder.map((group) => ({ value: group, label: muscleGroupLabels[group] })),
];

const statusOptions: { value: AdminContentStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

const levelOptions = [
  { value: "Débutant", label: "Débutant" },
  { value: "Intermédiaire", label: "Intermédiaire" },
  { value: "Avancé", label: "Avancé" },
];

export interface ProgramBuilderData {
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  description: string;
  status: AdminContentStatus;
  sessions: AdminWorkoutSession[];
}

function blankExercise(order: number): AdminExercise {
  return {
    id: generateId("ex"),
    order,
    name: "",
    sets: 3,
    reps: "8-10",
    restSeconds: 60,
    tempo: "2-0-1-0",
    recommendedLoad: "",
    videoUrl: "",
    notes: "",
  };
}

function exerciseFromLibrary(order: number, item: ExerciseLibraryItem): AdminExercise {
  return {
    id: generateId("ex"),
    order,
    name: item.name,
    sets: 3,
    reps: "8-10",
    restSeconds: 60,
    tempo: "2-0-1-0",
    recommendedLoad: "",
    videoUrl: item.videoUrl,
    notes: item.technicalNote,
  };
}

function restDaySession(weekNumber: number, day: string): AdminWorkoutSession {
  return {
    id: generateId("sess"),
    programId: "",
    weekNumber,
    day,
    isRestDay: true,
    name: "Repos",
    muscleGroup: "",
    durationMinutes: 0,
    warmup: "",
    coachNotes: "",
    exercises: [],
  };
}

function ExerciseRow({
  exercise,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  exercise: AdminExercise;
  onChange: (partial: Partial<AdminExercise>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <div className="border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Exercice #{exercise.order}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onMove("up")} disabled={isFirst} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowUp size={14} />
          </button>
          <button type="button" onClick={() => onMove("down")} disabled={isLast} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowDown size={14} />
          </button>
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nom de l'exercice" value={exercise.name} onChange={(v) => onChange({ name: v })} />
        <Field label="Charge conseillée" value={exercise.recommendedLoad} onChange={(v) => onChange({ recommendedLoad: v })} />
        <Field label="Séries" type="number" value={String(exercise.sets)} onChange={(v) => onChange({ sets: Number(v) || 0 })} />
        <Field
          label="Répétitions (ex : 8, 8-10, AMRAP)"
          value={exercise.reps}
          onChange={(v) => onChange({ reps: v })}
        />
        <Field label="Repos (s)" type="number" value={String(exercise.restSeconds)} onChange={(v) => onChange({ restSeconds: Number(v) || 0 })} />
        <Field label="Tempo" value={exercise.tempo} onChange={(v) => onChange({ tempo: v })} />
        <Field label="Lien vidéo" value={exercise.videoUrl} onChange={(v) => onChange({ videoUrl: v })} />
        <SelectField
          label="Groupe musculaire (analyse de charge)"
          value={exercise.muscleGroup ?? ""}
          onChange={(v) => onChange({ muscleGroup: v || undefined })}
          options={muscleGroupOptions}
        />
        <Field label="Notes" value={exercise.notes} onChange={(v) => onChange({ notes: v })} />
      </div>
    </div>
  );
}

function DayCard({
  session,
  nextWeekSession,
  library,
  onUpdate,
  onDuplicate,
}: {
  session: AdminWorkoutSession;
  nextWeekSession: AdminWorkoutSession | undefined;
  library: ExerciseLibraryItem[];
  onUpdate: (updated: AdminWorkoutSession) => void;
  onDuplicate: () => void;
}) {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");

  function toggleRest() {
    if (session.isRestDay) {
      onUpdate({ ...session, isRestDay: false, name: "" });
    } else {
      onUpdate({ ...session, isRestDay: true, name: "Repos", exercises: [] });
    }
  }

  function updateExercise(index: number, partial: Partial<AdminExercise>) {
    const exercises = session.exercises.map((ex, i) => (i === index ? { ...ex, ...partial } : ex));
    onUpdate({ ...session, exercises });
  }

  function removeExercise(index: number) {
    const exercises = session.exercises
      .filter((_, i) => i !== index)
      .map((ex, i) => ({ ...ex, order: i + 1 }));
    onUpdate({ ...session, exercises });
  }

  function moveExercise(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= session.exercises.length) return;
    const exercises = [...session.exercises];
    [exercises[index], exercises[targetIndex]] = [exercises[targetIndex], exercises[index]];
    onUpdate({ ...session, exercises: exercises.map((ex, i) => ({ ...ex, order: i + 1 })) });
  }

  function addExercise() {
    onUpdate({
      ...session,
      exercises: [...session.exercises, blankExercise(session.exercises.length + 1)],
    });
  }

  function addExerciseFromLibrary(item: ExerciseLibraryItem) {
    onUpdate({
      ...session,
      muscleGroup: session.muscleGroup || item.muscleGroup,
      exercises: [...session.exercises, exerciseFromLibrary(session.exercises.length + 1, item)],
    });
  }

  return (
    <div className="border border-border">
      <div className="flex items-center justify-between border-b border-border bg-background/40 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-foreground">{session.day}</span>
        <div className="flex items-center gap-3">
          {!session.isRestDay && nextWeekSession?.isRestDay && (
            <button
              type="button"
              onClick={onDuplicate}
              title="Dupliquer sur la semaine suivante"
              className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
            >
              <Copy size={12} />
              Dupliquer
            </button>
          )}
          <button
            type="button"
            onClick={toggleRest}
            className="text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
          >
            {session.isRestDay ? "Ajouter une séance" : "Marquer repos"}
          </button>
        </div>
      </div>

      {!session.isRestDay && (
        <div className="flex flex-col gap-4 p-4">
          <Field label="Nom de la séance" value={session.name} onChange={(v) => onUpdate({ ...session, name: v })} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Groupe musculaire" value={session.muscleGroup} onChange={(v) => onUpdate({ ...session, muscleGroup: v })} />
            <Field
              label="Durée (min)"
              type="number"
              value={String(session.durationMinutes)}
              onChange={(v) => onUpdate({ ...session, durationMinutes: Number(v) || 0 })}
            />
          </div>
          <TextareaField label="Échauffement" value={session.warmup} onChange={(v) => onUpdate({ ...session, warmup: v })} rows={2} />
          <TextareaField label="Notes coach" value={session.coachNotes} onChange={(v) => onUpdate({ ...session, coachNotes: v })} rows={2} />

          <ExerciseSearchPicker library={library} onPick={addExerciseFromLibrary} />

          <div className="flex flex-col gap-3">
            {session.exercises.map((ex, i) => (
              <ExerciseRow
                key={ex.id}
                exercise={ex}
                onChange={(partial) => updateExercise(i, partial)}
                onRemove={() => removeExercise(i)}
                onMove={(dir) => moveExercise(i, dir)}
                isFirst={i === 0}
                isLast={i === session.exercises.length - 1}
              />
            ))}
            <button
              type="button"
              onClick={addExercise}
              className="flex items-center justify-center gap-2 border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <Plus size={14} />
              Ajouter un exercice vierge
            </button>
          </div>

          {session.exercises.length > 0 && (
            <div className="border border-border bg-background/40 p-4">
              <h4 className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-foreground">
                <BarChart3 size={14} className="text-primary" />
                Analyse de la séance
              </h4>
              {(() => {
                const metrics = calculateSessionMetrics(session, selectedMuscleGroup);
                return (
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
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ProgramBuilder({
  initial,
  library,
  onSave,
  saveLabel,
}: {
  initial: ProgramBuilderData;
  library: ExerciseLibraryItem[];
  onSave: (data: ProgramBuilderData) => void;
  saveLabel: string;
}) {
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [level, setLevel] = useState(initial.level);
  const [durationWeeks, setDurationWeeks] = useState(initial.durationWeeks);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState<AdminContentStatus>(initial.status);
  const [sessions, setSessions] = useState<AdminWorkoutSession[]>(initial.sessions);
  const [weekMessages, setWeekMessages] = useState<Record<number, string>>({});

  const weekNumbers = Array.from(new Set(sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);

  function cloneWeekSessions(sourceWeek: number, targetWeek: number): AdminWorkoutSession[] {
    return sessions
      .filter((s) => s.weekNumber === sourceWeek)
      .map((s) => ({
        ...s,
        id: generateId("sess"),
        weekNumber: targetWeek,
        exercises: s.exercises.map((ex) => ({ ...ex, id: generateId("ex") })),
      }));
  }

  function addWeek(copyPrevious: boolean) {
    const nextWeek = weekNumbers.length > 0 ? Math.max(...weekNumbers) + 1 : 1;
    if (copyPrevious && weekNumbers.length > 0) {
      const sourceWeek = Math.max(...weekNumbers);
      setSessions((prev) => [...prev, ...cloneWeekSessions(sourceWeek, nextWeek)]);
      setWeekMessages((prev) => ({
        ...prev,
        [nextWeek]: `Semaine ${nextWeek} créée à partir de la semaine ${sourceWeek}.`,
      }));
    } else {
      setSessions((prev) => [...prev, ...weekDays.map((day) => restDaySession(nextWeek, day))]);
    }
    setDurationWeeks((prev) => Math.max(prev, nextWeek));
  }

  function duplicateWeek(sourceWeek: number) {
    const nextWeek = Math.max(...weekNumbers) + 1;
    setSessions((prev) => [...prev, ...cloneWeekSessions(sourceWeek, nextWeek)]);
    setWeekMessages((prev) => ({
      ...prev,
      [nextWeek]: `Semaine ${nextWeek} créée à partir de la semaine ${sourceWeek} (dupliquée).`,
    }));
    setDurationWeeks((prev) => Math.max(prev, nextWeek));
  }

  function updateSession(sessionId: string, updated: AdminWorkoutSession) {
    setSessions((prev) => prev.map((s) => (s.id === sessionId ? updated : s)));
  }

  function duplicateSession(session: AdminWorkoutSession) {
    const target = sessions.find((s) => s.weekNumber === session.weekNumber + 1 && s.day === session.day);
    if (!target) return;
    setSessions((prev) =>
      prev.map((s) =>
        s.id === target.id
          ? { ...session, id: target.id, weekNumber: target.weekNumber, exercises: session.exercises.map((ex) => ({ ...ex, id: generateId("ex") })) }
          : s,
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Informations générales
        </h2>
        <div className="flex flex-col gap-4">
          <Field label="Nom du programme" value={name} onChange={setName} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Objectif" value={goal} onChange={setGoal} />
            <SelectField label="Niveau" value={level} onChange={setLevel} options={levelOptions} />
            <Field
              label="Durée (semaines)"
              type="number"
              value={String(durationWeeks)}
              onChange={(v) => setDurationWeeks(Number(v) || 0)}
            />
          </div>
          <TextareaField label="Description" value={description} onChange={setDescription} rows={3} />
          <SelectField
            label="Statut"
            value={status}
            onChange={(v) => setStatus(v as AdminContentStatus)}
            options={statusOptions}
          />
        </div>
      </div>

      <div className="border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Structure semaine par semaine
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addWeek(true)}
              className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
            >
              <Plus size={14} />
              Ajouter une semaine
            </button>
            <button
              type="button"
              onClick={() => addWeek(false)}
              className="flex items-center gap-2 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Créer une semaine vide
            </button>
          </div>
        </div>

        {weekNumbers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune semaine pour le moment. Clique sur &quot;Ajouter une semaine&quot; pour commencer.
          </p>
        ) : (
          <div className="flex flex-col gap-8">
            {weekNumbers.map((weekNumber) => (
              <div key={weekNumber}>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold uppercase tracking-widest text-primary">
                    Semaine {weekNumber}
                  </h3>
                  <button
                    type="button"
                    onClick={() => duplicateWeek(weekNumber)}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
                  >
                    <Copy size={12} />
                    Dupliquer cette semaine
                  </button>
                </div>
                {weekMessages[weekNumber] && (
                  <p className="mb-3 border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
                    {weekMessages[weekNumber]}
                  </p>
                )}
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {sessions
                    .filter((s) => s.weekNumber === weekNumber)
                    .sort((a, b) => weekDays.indexOf(a.day) - weekDays.indexOf(b.day))
                    .map((session) => (
                      <DayCard
                        key={session.id}
                        session={session}
                        nextWeekSession={sessions.find(
                          (s) => s.weekNumber === weekNumber + 1 && s.day === session.day,
                        )}
                        library={library}
                        onUpdate={(updated) => updateSession(session.id, updated)}
                        onDuplicate={() => duplicateSession(session)}
                      />
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <PrimaryButton
        onClick={() =>
          onSave({
            name,
            goal,
            level,
            durationWeeks,
            description,
            status,
            sessions,
          })
        }
      >
        {saveLabel}
      </PrimaryButton>
    </div>
  );
}
