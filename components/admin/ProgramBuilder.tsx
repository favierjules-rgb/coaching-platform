"use client";

import { useState } from "react";
import { BarChart3, Copy, Plus } from "lucide-react";

import { blankBlock, BlockCard, blockTypeOptions } from "@/components/admin/BlockEditor";
import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
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
import { calculateSessionMetrics } from "@/lib/training-metrics";
import type {
  AdminContentStatus,
  AdminTrainingBlock,
  AdminWorkoutSession,
  ExerciseLibraryItem,
  MuscleGroupFilter,
  ProgramType,
  PublicationStatus,
  TrainingBlockType,
} from "@/types";

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

export const programTypeOptions: { value: ProgramType; label: string; description: string }[] = [
  {
    value: "individual",
    label: "Individuel",
    description: "Chaque élève assigné reçoit sa propre copie, adaptable indépendamment des autres.",
  },
  {
    value: "group",
    label: "Groupe",
    description: "Une seule structure partagée par tous les élèves assignés, synchronisée pour tous.",
  },
  {
    value: "fixed_duration",
    label: "Durée fixe",
    description: "Programme complet créé à l'avance, avec un début et une fin (structure prête pour une future vente).",
  },
];

const publicationStatusOptions: { value: PublicationStatus; label: string }[] = [
  { value: "draft", label: "Brouillon (invisible pour l'élève)" },
  { value: "published", label: "Publié (visible par l'élève assigné)" },
  { value: "archived", label: "Archivé" },
];

const experienceLevelOptions = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} / 5` }));

export interface ProgramBuilderData {
  name: string;
  goal: string;
  level: string;
  durationWeeks: number;
  description: string;
  status: AdminContentStatus;
  programType: ProgramType;
  publicationStatus: PublicationStatus;
  coverImagePath: string | null;
  experienceLevel: number | null;
  expectedDaysPerWeek: number | null;
  estimatedSessionDurationMinutes: number | null;
  sessions: AdminWorkoutSession[];
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
    blocks: [],
    exercises: [],
  };
}

/**
 * Nouveaux identifiants pour chaque bloc/exercice/prescription d'une copie
 * (duplication de séance/semaine). Un bloc "standard" synthétisé à la
 * lecture (voir lib/supabase/programs.ts) devient un bloc réel neuf — ses
 * exercices ne sont jamais perdus, seul l'id synthétique change.
 */
function cloneBlocks(blocks: AdminTrainingBlock[]): AdminTrainingBlock[] {
  return blocks.map((block) => {
    const exercises = block.exercises.map((ex) => {
      const newExerciseId = generateId("ex");
      return {
        ...ex,
        id: newExerciseId,
        prescriptions: ex.prescriptions?.map((p) => ({ ...p, id: generateId("presc"), exerciseId: newExerciseId })),
      };
    });
    return { ...block, id: generateId("block"), isSynthesizedStandard: undefined, exercises };
  });
}

function deriveExercises(blocks: AdminTrainingBlock[]) {
  return blocks.flatMap((b) => b.exercises);
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
  const [addBlockType, setAddBlockType] = useState<TrainingBlockType>("standard");

  function toggleRest() {
    if (session.isRestDay) {
      onUpdate({ ...session, isRestDay: false, name: "" });
    } else {
      onUpdate({ ...session, isRestDay: true, name: "Repos", blocks: [], exercises: [] });
    }
  }

  function updateBlock(blockId: string, updated: AdminTrainingBlock) {
    const blocks = session.blocks.map((b) => (b.id === blockId ? updated : b));
    onUpdate({ ...session, blocks, exercises: deriveExercises(blocks) });
  }

  function removeBlock(blockId: string) {
    const blocks = session.blocks.filter((b) => b.id !== blockId).map((b, i) => ({ ...b, position: i + 1 }));
    onUpdate({ ...session, blocks, exercises: deriveExercises(blocks) });
  }

  function moveBlock(blockId: string, direction: "up" | "down") {
    const index = session.blocks.findIndex((b) => b.id === blockId);
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || targetIndex < 0 || targetIndex >= session.blocks.length) return;
    const blocks = [...session.blocks];
    [blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]];
    const repositioned = blocks.map((b, i) => ({ ...b, position: i + 1 }));
    onUpdate({ ...session, blocks: repositioned, exercises: deriveExercises(repositioned) });
  }

  function duplicateBlock(blockId: string) {
    const source = session.blocks.find((b) => b.id === blockId);
    if (!source) return;
    const [copy] = cloneBlocks([source]);
    const blocks = [...session.blocks, { ...copy, position: session.blocks.length + 1 }];
    onUpdate({ ...session, blocks, exercises: deriveExercises(blocks) });
  }

  function addBlock() {
    const block = blankBlock(session.id, session.blocks.length + 1, addBlockType);
    const blocks = [...session.blocks, block];
    onUpdate({ ...session, blocks, exercises: deriveExercises(blocks) });
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

          <div className="flex flex-col gap-3">
            {session.blocks.map((block, i) => (
              <BlockCard
                key={block.id}
                block={block}
                library={library}
                onChange={(updated) => updateBlock(block.id, updated)}
                onRemove={() => removeBlock(block.id)}
                onDuplicate={() => duplicateBlock(block.id)}
                onMove={(dir) => moveBlock(block.id, dir)}
                isFirst={i === 0}
                isLast={i === session.blocks.length - 1}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3 border border-dashed border-border p-3">
            <div className="min-w-[220px] flex-1">
              <SelectField
                label="Type de bloc à ajouter"
                value={addBlockType}
                onChange={(v) => setAddBlockType(v as TrainingBlockType)}
                options={blockTypeOptions}
              />
            </div>
            <button
              type="button"
              onClick={addBlock}
              className="flex items-center gap-2 border border-primary bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
            >
              <Plus size={14} />
              Ajouter bloc
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
  const [programType, setProgramType] = useState<ProgramType>(initial.programType);
  const [publicationStatus, setPublicationStatus] = useState<PublicationStatus>(initial.publicationStatus);
  const [coverImagePath, setCoverImagePath] = useState(initial.coverImagePath ?? "");
  const [experienceLevel, setExperienceLevel] = useState(initial.experienceLevel !== null ? String(initial.experienceLevel) : "");
  const [expectedDaysPerWeek, setExpectedDaysPerWeek] = useState(initial.expectedDaysPerWeek !== null ? String(initial.expectedDaysPerWeek) : "");
  const [estimatedSessionDurationMinutes, setEstimatedSessionDurationMinutes] = useState(
    initial.estimatedSessionDurationMinutes !== null ? String(initial.estimatedSessionDurationMinutes) : "",
  );
  const [sessions, setSessions] = useState<AdminWorkoutSession[]>(initial.sessions);
  const [weekMessages, setWeekMessages] = useState<Record<number, string>>({});

  const weekNumbers = Array.from(new Set(sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);

  function cloneWeekSessions(sourceWeek: number, targetWeek: number): AdminWorkoutSession[] {
    return sessions
      .filter((s) => s.weekNumber === sourceWeek)
      .map((s) => {
        const blocks = cloneBlocks(s.blocks);
        return { ...s, id: generateId("sess"), weekNumber: targetWeek, blocks, exercises: deriveExercises(blocks) };
      });
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
    const blocks = cloneBlocks(session.blocks);
    setSessions((prev) =>
      prev.map((s) =>
        s.id === target.id
          ? { ...session, id: target.id, weekNumber: target.weekNumber, blocks, exercises: deriveExercises(blocks) }
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
          <div>
            <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Type de programmation</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {programTypeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setProgramType(option.value)}
                  aria-pressed={programType === option.value}
                  className={`flex flex-col gap-1 border p-3 text-left transition-colors ${
                    programType === option.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                  }`}
                >
                  <span className="text-xs font-bold uppercase tracking-widest text-foreground">{option.label}</span>
                  <span className="text-[11px] text-muted-foreground">{option.description}</span>
                </button>
              ))}
            </div>
          </div>

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
          <Field label="Image de couverture (URL, optionnel)" value={coverImagePath} onChange={setCoverImagePath} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <SelectField
              label="Niveau d'expérience requis"
              value={experienceLevel}
              onChange={setExperienceLevel}
              options={[{ value: "", label: "Non précisé" }, ...experienceLevelOptions]}
            />
            <Field
              label="Jours par semaine (moyenne)"
              type="number"
              value={expectedDaysPerWeek}
              onChange={setExpectedDaysPerWeek}
            />
            <Field
              label="Durée d'une séance (min, moyenne)"
              type="number"
              value={estimatedSessionDurationMinutes}
              onChange={setEstimatedSessionDurationMinutes}
            />
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Statut"
              value={status}
              onChange={(v) => setStatus(v as AdminContentStatus)}
              options={statusOptions}
            />
            <div>
              <SelectField
                label="Visibilité élève"
                value={publicationStatus}
                onChange={(v) => setPublicationStatus(v as PublicationStatus)}
                options={publicationStatusOptions}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                Contrôle si l&apos;élève assigné voit ce programme, indépendamment du statut ci-dessus.
              </p>
            </div>
          </div>
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
            programType,
            publicationStatus,
            coverImagePath: coverImagePath.trim() || null,
            experienceLevel: experienceLevel === "" ? null : Number(experienceLevel),
            expectedDaysPerWeek: expectedDaysPerWeek === "" ? null : Number(expectedDaysPerWeek),
            estimatedSessionDurationMinutes: estimatedSessionDurationMinutes === "" ? null : Number(estimatedSessionDurationMinutes),
            sessions,
          })
        }
      >
        {saveLabel}
      </PrimaryButton>
    </div>
  );
}
