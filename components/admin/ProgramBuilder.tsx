"use client";

import { useRef, useState, type DragEvent } from "react";
import { ArrowDown, ArrowUp, BarChart3, Copy, GripVertical, Layers, Plus, Save, Trash2 } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { BannerUploadField } from "@/components/admin/BannerUploadField";
import { ExerciseSearchPicker } from "@/components/admin/ExerciseSearchPicker";
import { PrimaryButton } from "@/components/admin/Modal";
import { SessionTemplatePicker } from "@/components/admin/SessionTemplatePicker";
import {
  AnalysisFilterLabel,
  FilteredExerciseList,
  MuscleGroupBars,
  MuscleGroupFilterSelect,
  TrainingStatCards,
  UntaggedExercisesAlert,
} from "@/components/shared/TrainingMetricsSummary";
import { generateId, weekDays } from "@/lib/admin";
import {
  blankCardioBlock,
  blankCardioSegment,
  cardioSegmentTypeLabels,
  cardioTypeLabels,
  cloneCardioBlock,
  formatSpeed,
  intensityTargetTypeLabels,
  machineTypeLabels,
  segmentIntensityPreview,
} from "@/lib/cardio";
import { calculateSessionMetrics, muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type {
  AdminCardioBlock,
  AdminCardioSegment,
  AdminContentStatus,
  AdminExercise,
  AdminWorkoutSession,
  CardioSegmentType,
  CardioType,
  ExerciseLibraryItem,
  IntensityTargetType,
  MachineType,
  MuscleGroupFilter,
  SessionTemplate,
  SessionType,
} from "@/types";

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
  /** Photo bannière (chantier module Programmation, étape 4). */
  bannerUrl?: string | null;
  /** Mode groupe + date de démarrage fixe (chantier module Programmation, étape 5). */
  programMode?: "individuel" | "groupe";
  groupStartDate?: string | null;
}

export function blankExercise(order: number): AdminExercise {
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

export function exerciseFromLibrary(order: number, item: ExerciseLibraryItem): AdminExercise {
  return {
    id: generateId("ex"),
    order,
    name: item.name,
    sets: 3,
    reps: "8-10",
    restSeconds: item.defaultRestSeconds ?? 60,
    tempo: item.defaultTempo || "2-0-1-0",
    recommendedLoad: "",
    // Copié par valeur au moment de l'ajout — une future modification de
    // l'exercice source dans la banque ne modifie jamais cette séance déjà
    // enregistrée (voir docs/supabase-exercise-library-model.md).
    videoUrl: item.videoUrl.trim() || item.alternativeVideoUrl.trim(),
    notes: item.technicalNote,
    muscleGroup: item.muscleGroup,
    libraryExerciseId: item.id,
  };
}

export function restDaySession(weekNumber: number, day: string): AdminWorkoutSession {
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
    sessionType: "strength",
    cardioBlocks: [],
  };
}

function ExerciseRow({
  exercise,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  exercise: AdminExercise;
  onChange: (partial: Partial<AdminExercise>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
}) {
  return (
    <div className="border border-border p-4" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span
            draggable
            onDragStart={onDragStart}
            title="Glisser pour réordonner"
            className="cursor-grab text-muted-foreground hover:text-foreground"
          >
            <GripVertical size={14} />
          </span>
          Exercice #{exercise.order}
          {exercise.libraryExerciseId && (
            <span className="border border-primary/40 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-primary">
              Depuis la banque
            </span>
          )}
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

function CardioSegmentRow({
  segment,
  referenceVmaKmh,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  segment: AdminCardioSegment;
  referenceVmaKmh: number;
  onChange: (partial: Partial<AdminCardioSegment>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
  onDragStart: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
}) {
  const isRepeat = segment.segmentType === "repeat_group";
  const preview = segmentIntensityPreview(segment, referenceVmaKmh);
  const showPreview =
    segment.intensityTargetType === "vma_percentage" ||
    segment.intensityTargetType === "speed_kmh" ||
    segment.intensityTargetType === "pace";

  return (
    <div className="border border-border/60 bg-background/30 p-3" onDragOver={onDragOver} onDrop={onDrop}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          <span
            draggable
            onDragStart={onDragStart}
            title="Glisser pour réordonner"
            className="cursor-grab text-muted-foreground hover:text-foreground"
          >
            <GripVertical size={12} />
          </span>
          Segment #{segment.order}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onMove("up")} disabled={isFirst} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowUp size={13} />
          </button>
          <button type="button" onClick={() => onMove("down")} disabled={isLast} className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowDown size={13} />
          </button>
          <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300">
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Titre (optionnel)" value={segment.title} onChange={(v) => onChange({ title: v })} placeholder="Ex : Corps de séance" />
        <SelectField
          label="Type"
          value={segment.segmentType}
          onChange={(v) => onChange({ segmentType: v as CardioSegmentType })}
          options={Object.entries(cardioSegmentTypeLabels).map(([value, label]) => ({ value, label }))}
        />

        {isRepeat && (
          <Field
            label="Répétitions"
            type="number"
            value={String(segment.repetitions ?? 1)}
            onChange={(v) => onChange({ repetitions: Number(v) || 1 })}
          />
        )}

        <Field
          label={isRepeat ? "Durée effort (s)" : "Durée (s)"}
          type="number"
          value={segment.durationSeconds !== undefined ? String(segment.durationSeconds) : ""}
          onChange={(v) => onChange({ durationSeconds: v ? Number(v) : undefined })}
        />
        <Field
          label={isRepeat ? "Distance effort (m)" : "Distance (m)"}
          type="number"
          value={segment.distanceMeters !== undefined ? String(segment.distanceMeters) : ""}
          onChange={(v) => onChange({ distanceMeters: v ? Number(v) : undefined })}
        />

        {isRepeat && (
          <>
            <Field
              label="Durée récup (s)"
              type="number"
              value={segment.recoveryDurationSeconds !== undefined ? String(segment.recoveryDurationSeconds) : ""}
              onChange={(v) => onChange({ recoveryDurationSeconds: v ? Number(v) : undefined })}
            />
            <Field
              label="Distance récup (m)"
              type="number"
              value={segment.recoveryDistanceMeters !== undefined ? String(segment.recoveryDistanceMeters) : ""}
              onChange={(v) => onChange({ recoveryDistanceMeters: v ? Number(v) : undefined })}
            />
          </>
        )}

        <Field
          label="Dénivelé + (m)"
          type="number"
          value={segment.elevationGainMeters !== undefined ? String(segment.elevationGainMeters) : ""}
          onChange={(v) => onChange({ elevationGainMeters: v ? Number(v) : undefined })}
        />
        <Field
          label="Inclinaison (%)"
          type="number"
          value={segment.inclinePercentage !== undefined ? String(segment.inclinePercentage) : ""}
          onChange={(v) => onChange({ inclinePercentage: v ? Number(v) : undefined })}
        />
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Intensité ciblée"
            value={segment.intensityTargetType}
            onChange={(v) => onChange({ intensityTargetType: v as IntensityTargetType })}
            options={Object.entries(intensityTargetTypeLabels).map(([value, label]) => ({ value, label }))}
          />

          {segment.intensityTargetType === "vma_percentage" && (
            <Field
              label="% VMA"
              type="number"
              value={segment.targetVmaPercentage !== undefined ? String(segment.targetVmaPercentage) : ""}
              onChange={(v) => onChange({ targetVmaPercentage: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "speed_kmh" && (
            <Field
              label="Vitesse (km/h)"
              type="number"
              step="0.1"
              value={segment.targetSpeedKmh !== undefined ? String(segment.targetSpeedKmh) : ""}
              onChange={(v) => onChange({ targetSpeedKmh: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "pace" && (
            <Field
              label="Allure (s/km)"
              type="number"
              value={segment.targetPaceSecondsPerKm !== undefined ? String(segment.targetPaceSecondsPerKm) : ""}
              onChange={(v) => onChange({ targetPaceSecondsPerKm: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "heart_rate_percentage" && (
            <Field
              label="% FC max"
              type="number"
              value={segment.targetHrPercentage !== undefined ? String(segment.targetHrPercentage) : ""}
              onChange={(v) => onChange({ targetHrPercentage: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "heart_rate_zone" && (
            <Field label="Zone FC (ex : Z2)" value={segment.targetHrZone ?? ""} onChange={(v) => onChange({ targetHrZone: v || undefined })} />
          )}
          {segment.intensityTargetType === "power" && (
            <Field
              label="Puissance (W)"
              type="number"
              value={segment.targetPowerWatts !== undefined ? String(segment.targetPowerWatts) : ""}
              onChange={(v) => onChange({ targetPowerWatts: v ? Number(v) : undefined })}
            />
          )}
          {segment.intensityTargetType === "rpe" && (
            <Field
              label="RPE (0-10)"
              type="number"
              value={segment.intensityMin !== undefined ? String(segment.intensityMin) : ""}
              onChange={(v) => onChange({ intensityMin: v ? Number(v) : undefined })}
            />
          )}
        </div>

        {showPreview && (
          <p className="mt-2 text-xs text-muted-foreground">
            Aperçu (VMA réf. {referenceVmaKmh} km/h) : {formatSpeed(preview.speedKmh)}
            {preview.paceLabel ? ` — ${preview.paceLabel}` : ""}
          </p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field
          label="Cadence cible (spm, optionnel)"
          type="number"
          value={segment.targetCadence !== undefined ? String(segment.targetCadence) : ""}
          onChange={(v) => onChange({ targetCadence: v ? Number(v) : undefined })}
        />
        <Field label="Notes" value={segment.coachNotes ?? ""} onChange={(v) => onChange({ coachNotes: v || undefined })} />
      </div>
    </div>
  );
}

function CardioBlockRow({
  block,
  referenceVmaKmh,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  block: AdminCardioBlock;
  referenceVmaKmh: number;
  onChange: (updated: AdminCardioBlock) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  function updateSegment(index: number, partial: Partial<AdminCardioSegment>) {
    const segments = block.segments.map((s, i) => (i === index ? { ...s, ...partial } : s));
    onChange({ ...block, segments });
  }

  function removeSegment(index: number) {
    const segments = block.segments.filter((_, i) => i !== index).map((s, i) => ({ ...s, order: i + 1 }));
    onChange({ ...block, segments });
  }

  function moveSegment(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= block.segments.length) return;
    const segments = [...block.segments];
    [segments[index], segments[targetIndex]] = [segments[targetIndex], segments[index]];
    onChange({ ...block, segments: segments.map((s, i) => ({ ...s, order: i + 1 })) });
  }

  function addSegment() {
    onChange({ ...block, segments: [...block.segments, blankCardioSegment(block.segments.length + 1)] });
  }

  // Réordonnancement par glisser-déposer (en plus des flèches haut/bas
  // conservées pour l'accessibilité clavier) — l'index source est retenu
  // dans une ref le temps du drag, sans re-render intermédiaire.
  const dragSegmentIndex = useRef<number | null>(null);

  function reorderSegments(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const segments = [...block.segments];
    const [moved] = segments.splice(fromIndex, 1);
    segments.splice(toIndex, 0, moved);
    onChange({ ...block, segments: segments.map((s, i) => ({ ...s, order: i + 1 })) });
  }

  return (
    <div className="border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Bloc cardio #{block.order}</span>
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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Titre du bloc" value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder="Ex : Séance VMA" />
        <SelectField
          label="Type de cardio"
          value={block.cardioType}
          onChange={(v) => onChange({ ...block, cardioType: v as CardioType })}
          options={Object.entries(cardioTypeLabels).map(([value, label]) => ({ value, label }))}
        />
        <SelectField
          label="Machine (si salle)"
          value={block.machineType ?? ""}
          onChange={(v) => onChange({ ...block, machineType: (v || undefined) as MachineType | undefined })}
          options={[
            { value: "", label: "Extérieur / course à pied" },
            ...Object.entries(machineTypeLabels).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-3">
        {block.segments.map((segment, i) => (
          <CardioSegmentRow
            key={segment.id}
            segment={segment}
            referenceVmaKmh={referenceVmaKmh}
            onChange={(partial) => updateSegment(i, partial)}
            onRemove={() => removeSegment(i)}
            onMove={(dir) => moveSegment(i, dir)}
            isFirst={i === 0}
            isLast={i === block.segments.length - 1}
            onDragStart={() => {
              dragSegmentIndex.current = i;
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => {
              if (dragSegmentIndex.current !== null) {
                reorderSegments(dragSegmentIndex.current, i);
                dragSegmentIndex.current = null;
              }
            }}
          />
        ))}
        <button
          type="button"
          onClick={addSegment}
          className="flex items-center justify-center gap-2 border border-dashed border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus size={13} />
          Ajouter un segment
        </button>
      </div>
    </div>
  );
}

export function DayCard({
  session,
  nextWeekSession,
  library,
  onUpdate,
  onDuplicate,
  templates,
  onSaveAsTemplate,
}: {
  session: AdminWorkoutSession;
  nextWeekSession: AdminWorkoutSession | undefined;
  library: ExerciseLibraryItem[];
  onUpdate: (updated: AdminWorkoutSession) => void;
  onDuplicate: () => void;
  // Optionnels : la banque de séances (V3 étape 4) n'est câblée que depuis
  // ProgramBuilderFullscreen — le composant ProgramBuilder legacy plus bas
  // dans ce fichier (mort, non utilisé) continue d'appeler DayCard sans ces
  // props, ce qui reste valide.
  templates?: SessionTemplate[];
  onSaveAsTemplate?: (session: AdminWorkoutSession, name: string, description: string) => Promise<boolean>;
}) {
  const [selectedMuscleGroup, setSelectedMuscleGroup] = useState<MuscleGroupFilter>("tous");
  // VMA purement indicative pour l'aperçu vitesse/allure des segments cardio
  // (voir lib/cardio.ts) — jamais persistée, seulement un outil d'aide à la
  // rédaction pour le coach pendant la construction du bloc.
  const [referenceVmaKmh, setReferenceVmaKmh] = useState(15);

  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showSaveTemplateForm, setShowSaveTemplateForm] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [templateDescription, setTemplateDescription] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Normalisation : sessionType/cardioBlocks sont optionnels dans le type
  // (compat mock/anciennes séances — voir types/index.ts) mais toujours
  // définis une fois qu'on écrit via onUpdate.
  const sessionType: SessionType = session.sessionType ?? "strength";
  const cardioBlocks = session.cardioBlocks ?? [];
  const showExercises = sessionType !== "cardio";
  const showCardio = sessionType !== "strength";

  function toggleRest() {
    if (session.isRestDay) {
      onUpdate({ ...session, isRestDay: false, name: "" });
    } else {
      onUpdate({ ...session, isRestDay: true, name: "Repos", exercises: [], cardioBlocks: [] });
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

  // Réordonnancement par glisser-déposer, en complément des flèches
  // haut/bas (conservées pour l'accessibilité clavier) — même principe que
  // dans CardioBlockRow pour les segments.
  const dragExerciseIndex = useRef<number | null>(null);

  function reorderExercises(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const exercises = [...session.exercises];
    const [moved] = exercises.splice(fromIndex, 1);
    exercises.splice(toIndex, 0, moved);
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

  function updateCardioBlock(index: number, updated: AdminCardioBlock) {
    const blocks = cardioBlocks.map((b, i) => (i === index ? updated : b));
    onUpdate({ ...session, cardioBlocks: blocks });
  }

  function removeCardioBlock(index: number) {
    const blocks = cardioBlocks.filter((_, i) => i !== index).map((b, i) => ({ ...b, order: i + 1 }));
    onUpdate({ ...session, cardioBlocks: blocks });
  }

  function moveCardioBlock(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= cardioBlocks.length) return;
    const blocks = [...cardioBlocks];
    [blocks[index], blocks[targetIndex]] = [blocks[targetIndex], blocks[index]];
    onUpdate({ ...session, cardioBlocks: blocks.map((b, i) => ({ ...b, order: i + 1 })) });
  }

  function addCardioBlock() {
    onUpdate({ ...session, cardioBlocks: [...cardioBlocks, blankCardioBlock(cardioBlocks.length + 1)] });
  }

  // Applique le contenu d'un modèle de la banque de séances à cette séance :
  // toujours de nouveaux ids (generateId/cloneCardioBlock) pour ne jamais
  // partager une référence avec le modèle source ou avec une autre séance
  // déjà construite depuis ce même modèle.
  function applyTemplate(template: SessionTemplate) {
    onUpdate({
      ...session,
      isRestDay: false,
      name: session.name.trim() ? session.name : template.name,
      sessionType: template.sessionType,
      muscleGroup: template.muscleGroup || session.muscleGroup,
      durationMinutes: template.durationMinutes ?? session.durationMinutes,
      warmup: template.content.warmup,
      coachNotes: template.content.coachNotes,
      exercises: template.content.exercises.map((ex, i) => ({ ...ex, id: generateId("ex"), order: i + 1 })),
      cardioBlocks: template.content.cardioBlocks.map((block) => cloneCardioBlock(block)),
    });
    setShowTemplatePicker(false);
  }

  async function saveAsTemplate() {
    if (!onSaveAsTemplate || !templateName.trim()) return;
    setSavingTemplate(true);
    const ok = await onSaveAsTemplate(session, templateName.trim(), templateDescription.trim());
    setSavingTemplate(false);
    if (ok) {
      setTemplateName("");
      setTemplateDescription("");
      setShowSaveTemplateForm(false);
    }
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
          <BannerUploadField
            label="Photo bannière de la séance"
            kind="sessions"
            entityId={session.id}
            value={session.bannerUrl}
            onChange={(bannerUrl) => onUpdate({ ...session, bannerUrl })}
          />
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
          <SelectField
            label="Type de séance"
            value={sessionType}
            onChange={(v) => onUpdate({ ...session, sessionType: v as SessionType })}
            options={[
              { value: "strength", label: "Musculation" },
              { value: "cardio", label: "Cardio" },
              { value: "mixed", label: "Mixte (muscu + cardio)" },
            ]}
          />
          <TextareaField label="Échauffement" value={session.warmup} onChange={(v) => onUpdate({ ...session, warmup: v })} rows={2} />
          <TextareaField label="Notes coach" value={session.coachNotes} onChange={(v) => onUpdate({ ...session, coachNotes: v })} rows={2} />

          {(templates || onSaveAsTemplate) && (
            <div className="flex flex-col gap-3 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-4">
                {templates && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowTemplatePicker((v) => !v);
                      setShowSaveTemplateForm(false);
                    }}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
                  >
                    <Layers size={12} />
                    Utiliser un modèle
                  </button>
                )}
                {onSaveAsTemplate && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSaveTemplateForm((v) => !v);
                      setShowTemplatePicker(false);
                    }}
                    className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
                  >
                    <Save size={12} />
                    Enregistrer comme modèle
                  </button>
                )}
              </div>

              {showTemplatePicker && templates && <SessionTemplatePicker templates={templates} onPick={applyTemplate} />}

              {showSaveTemplateForm && onSaveAsTemplate && (
                <div className="flex flex-col gap-2 border border-dashed border-border p-3">
                  <Field label="Nom du modèle" value={templateName} onChange={setTemplateName} placeholder="Ex : Haut du corps - Force" />
                  <Field label="Description (optionnel)" value={templateDescription} onChange={setTemplateDescription} />
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={saveAsTemplate}
                      disabled={savingTemplate || !templateName.trim()}
                      className="border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {savingTemplate ? "Enregistrement..." : "Enregistrer"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowSaveTemplateForm(false)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Annuler
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {showExercises && (
            <>
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
                    onDragStart={() => {
                      dragExerciseIndex.current = i;
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragExerciseIndex.current !== null) {
                        reorderExercises(dragExerciseIndex.current, i);
                        dragExerciseIndex.current = null;
                      }
                    }}
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
            </>
          )}

          {showCardio && (
            <div className="flex flex-col gap-3 border-t border-border pt-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-xs font-bold uppercase tracking-widest text-foreground">Blocs cardio</h4>
                <div className="w-40">
                  <Field
                    label="VMA réf. aperçu (km/h)"
                    type="number"
                    step="0.1"
                    value={String(referenceVmaKmh)}
                    onChange={(v) => setReferenceVmaKmh(Number(v) || 0)}
                  />
                </div>
              </div>

              {cardioBlocks.map((block, i) => (
                <CardioBlockRow
                  key={block.id}
                  block={block}
                  referenceVmaKmh={referenceVmaKmh}
                  onChange={(updated) => updateCardioBlock(i, updated)}
                  onRemove={() => removeCardioBlock(i)}
                  onMove={(dir) => moveCardioBlock(i, dir)}
                  isFirst={i === 0}
                  isLast={i === cardioBlocks.length - 1}
                />
              ))}
              <button
                type="button"
                onClick={addCardioBlock}
                className="flex items-center justify-center gap-2 border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Plus size={14} />
                Ajouter un bloc cardio
              </button>
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
        cardioBlocks: (s.cardioBlocks ?? []).map(cloneCardioBlock),
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
          ? {
              ...session,
              id: target.id,
              weekNumber: target.weekNumber,
              exercises: session.exercises.map((ex) => ({ ...ex, id: generateId("ex") })),
              cardioBlocks: (session.cardioBlocks ?? []).map(cloneCardioBlock),
            }
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
