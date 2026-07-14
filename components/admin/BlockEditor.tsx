"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Plus, Trash2 } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { ExerciseSearchPicker } from "@/components/admin/ExerciseSearchPicker";
import { generateId } from "@/lib/admin";
import { muscleGroupLabels, muscleGroupOrder } from "@/lib/training-metrics";
import type {
  AdminExercise,
  AdminTrainingBlock,
  AdminTrainingPrescription,
  ExerciseLibraryItem,
  LoadInputMode,
  LoadUnit,
  TrainingBlockColorKey,
  TrainingBlockType,
  TrainingSetType,
} from "@/types";

/**
 * Éditeur de blocs (chantier "training-builder-v2"). Un bloc regroupe un ou
 * plusieurs exercices avec une logique commune (superset, circuit, EMOM...).
 * Reste utilisable par ProgramBuilder.tsx sans forcer son usage : une séance
 * sans bloc explicite reste éditable via la liste plate historique (voir
 * lib/supabase/programs.ts, upsertBlocksForSession).
 */

export const blockTypeOptions: { value: TrainingBlockType; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "warmup", label: "Échauffement" },
  { value: "strength", label: "Force" },
  { value: "superset", label: "Superset" },
  { value: "tri_set", label: "Tri-set" },
  { value: "giant_set", label: "Giant set" },
  { value: "circuit", label: "Circuit" },
  { value: "emom", label: "EMOM" },
  { value: "amrap", label: "AMRAP" },
  { value: "interval", label: "Intervalles" },
  { value: "cooldown", label: "Retour au calme" },
  { value: "benchmark", label: "Benchmark" },
  { value: "custom", label: "Personnalisé" },
];

export const blockTypeLabels: Record<TrainingBlockType, string> = Object.fromEntries(
  blockTypeOptions.map((o) => [o.value, o.label]),
) as Record<TrainingBlockType, string>;

const colorOptions: { value: TrainingBlockColorKey; label: string; swatch: string }[] = [
  { value: "gray", label: "Gris", swatch: "#71717a" },
  { value: "red", label: "Rouge", swatch: "#d62828" },
  { value: "orange", label: "Orange", swatch: "#f97316" },
  { value: "yellow", label: "Jaune", swatch: "#eab308" },
  { value: "green", label: "Vert", swatch: "#22c55e" },
  { value: "blue", label: "Bleu", swatch: "#3b82f6" },
  { value: "purple", label: "Violet", swatch: "#a855f7" },
];

const setTypeOptions: { value: TrainingSetType; label: string }[] = [
  { value: "normal", label: "Normale" },
  { value: "warmup", label: "Échauffement" },
  { value: "top_set", label: "Top set" },
  { value: "back_off", label: "Back-off" },
  { value: "failure", label: "À l'échec" },
  { value: "optional", label: "Facultative" },
];

const loadUnitOptions: { value: LoadUnit; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "lb", label: "lb" },
];

const loadInputModeOptions: { value: LoadInputMode; label: string }[] = [
  { value: "total", label: "Charge totale" },
  { value: "per_side", label: "Par côté" },
  { value: "per_implement", label: "Par haltère/kettlebell" },
];

const muscleGroupOptions = [
  { value: "", label: "Hérité de la séance" },
  ...muscleGroupOrder.map((group) => ({ value: group, label: muscleGroupLabels[group] })),
];

const MULTI_EXERCISE_TYPES: TrainingBlockType[] = ["superset", "tri_set", "giant_set"];
const ROUNDS_TYPES: TrainingBlockType[] = ["superset", "tri_set", "giant_set", "circuit", "amrap"];
const TIME_CAP_TYPES: TrainingBlockType[] = ["circuit", "amrap", "interval"];
const REST_BETWEEN_ROUNDS_TYPES: TrainingBlockType[] = ["superset", "tri_set", "giant_set", "circuit"];
const EMOM_TYPES: TrainingBlockType[] = ["emom"];
const SCORING_TYPES: TrainingBlockType[] = ["amrap", "circuit", "benchmark", "custom"];

function supersetLabelFor(index: number): string {
  return `A${index + 1}`;
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
    // Copié par valeur — une future modification de l'exercice source dans
    // la banque ne modifie jamais cette séance déjà enregistrée.
    videoUrl: item.videoUrl.trim() || item.alternativeVideoUrl.trim(),
    notes: item.technicalNote,
    muscleGroup: item.muscleGroup,
    libraryExerciseId: item.id,
  };
}

export function blankBlock(sessionId: string, position: number, blockType: TrainingBlockType = "standard"): AdminTrainingBlock {
  return {
    id: generateId("block"),
    sessionId,
    blockType,
    title: "",
    description: "",
    scoringType: null,
    colorKey: "gray",
    rounds: ROUNDS_TYPES.includes(blockType) ? 3 : null,
    timeCapSeconds: null,
    durationSeconds: null,
    workSeconds: null,
    restSeconds: null,
    restBetweenRoundsSeconds: null,
    emomMinutes: EMOM_TYPES.includes(blockType) ? 12 : null,
    position,
    mediaPath: null,
    versionNumber: 1,
    exercises: [],
  };
}

function blankPrescription(exerciseId: string, setNumber: number): AdminTrainingPrescription {
  return {
    id: generateId("presc"),
    exerciseId,
    setNumber,
    setType: "normal",
    targetReps: null,
    repsMin: null,
    repsMax: null,
    durationSeconds: null,
    distanceMeters: null,
    targetLoad: null,
    loadUnit: "kg",
    loadInputMode: "total",
    targetPercentage: null,
    targetRpe: null,
    targetRir: null,
    bodyweightPercentage: null,
    tempoEccentric: null,
    tempoBottomPause: null,
    tempoConcentric: null,
    tempoTopPause: null,
    restSeconds: null,
    coachNotes: "",
    position: setNumber,
  };
}

function NumberField({
  label,
  value,
  onChange,
  min,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  min?: number;
}) {
  return (
    <Field
      label={label}
      type="number"
      value={value === null ? "" : String(value)}
      onChange={(v) => {
        if (v.trim() === "") {
          onChange(null);
          return;
        }
        const parsed = Number(v);
        onChange(Number.isNaN(parsed) ? null : min !== undefined ? Math.max(parsed, min) : parsed);
      }}
    />
  );
}

/** Tableau de prescriptions par série (mode détaillé) — voir docs/training-builder-v2.md pour la convention load_input_mode/tonnage. */
function PrescriptionTable({
  exerciseId,
  prescriptions,
  onChange,
}: {
  exerciseId: string;
  prescriptions: AdminTrainingPrescription[];
  onChange: (updated: AdminTrainingPrescription[]) => void;
}) {
  function updateRow(index: number, partial: Partial<AdminTrainingPrescription>) {
    onChange(prescriptions.map((p, i) => (i === index ? { ...p, ...partial } : p)));
  }
  function removeRow(index: number) {
    onChange(
      prescriptions
        .filter((_, i) => i !== index)
        .map((p, i) => ({ ...p, setNumber: i + 1, position: i + 1 })),
    );
  }
  function addRow() {
    onChange([...prescriptions, blankPrescription(exerciseId, prescriptions.length + 1)]);
  }

  return (
    <div className="mt-3 border border-border bg-background/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h5 className="text-[11px] font-bold uppercase tracking-widest text-foreground">Prescriptions par série (mode détaillé)</h5>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-2">Série</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Reps</th>
              <th className="py-1 pr-2">Charge</th>
              <th className="py-1 pr-2">Unité</th>
              <th className="py-1 pr-2">Mode</th>
              <th className="py-1 pr-2">% 1RM</th>
              <th className="py-1 pr-2">RPE</th>
              <th className="py-1 pr-2">RIR</th>
              <th className="py-1 pr-2">Repos (s)</th>
              <th className="py-1 pr-2">Notes</th>
              <th className="py-1"></th>
            </tr>
          </thead>
          <tbody>
            {prescriptions.map((p, index) => (
              <tr key={p.id} className="border-b border-border/60">
                <td className="py-1.5 pr-2 font-bold text-foreground">#{p.setNumber}</td>
                <td className="py-1.5 pr-2">
                  <select
                    aria-label={`Type de la série ${p.setNumber}`}
                    value={p.setType}
                    onChange={(e) => updateRow(index, { setType: e.target.value as TrainingSetType })}
                    className="w-full border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    {setTypeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`Répétitions de la série ${p.setNumber}`}
                    type="number"
                    value={p.targetReps ?? ""}
                    onChange={(e) => updateRow(index, { targetReps: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-16 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`Charge de la série ${p.setNumber}`}
                    type="number"
                    value={p.targetLoad ?? ""}
                    onChange={(e) => updateRow(index, { targetLoad: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-16 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    aria-label={`Unité de charge de la série ${p.setNumber}`}
                    value={p.loadUnit}
                    onChange={(e) => updateRow(index, { loadUnit: e.target.value as LoadUnit })}
                    className="border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    {loadUnitOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <select
                    aria-label={`Convention de charge de la série ${p.setNumber}`}
                    value={p.loadInputMode}
                    onChange={(e) => updateRow(index, { loadInputMode: e.target.value as LoadInputMode })}
                    className="border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  >
                    {loadInputModeOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`Pourcentage de 1RM de la série ${p.setNumber}`}
                    type="number"
                    value={p.targetPercentage ?? ""}
                    onChange={(e) => updateRow(index, { targetPercentage: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-14 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`RPE de la série ${p.setNumber}`}
                    type="number"
                    step="0.5"
                    value={p.targetRpe ?? ""}
                    onChange={(e) => updateRow(index, { targetRpe: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-14 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`RIR de la série ${p.setNumber}`}
                    type="number"
                    step="0.5"
                    value={p.targetRir ?? ""}
                    onChange={(e) => updateRow(index, { targetRir: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-14 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`Repos après la série ${p.setNumber}`}
                    type="number"
                    value={p.restSeconds ?? ""}
                    onChange={(e) => updateRow(index, { restSeconds: e.target.value === "" ? null : Number(e.target.value) })}
                    className="w-16 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    aria-label={`Notes coach pour la série ${p.setNumber}`}
                    type="text"
                    value={p.coachNotes}
                    onChange={(e) => updateRow(index, { coachNotes: e.target.value })}
                    className="w-32 border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                  />
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    onClick={() => removeRow(index)}
                    aria-label={`Supprimer la série ${p.setNumber}`}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={addRow}
        className="mt-2 flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
      >
        <Plus size={12} />
        Ajouter une série
      </button>
    </div>
  );
}

function BlockExerciseRow({
  exercise,
  supersetLabelText,
  onChange,
  onRemove,
  onMove,
  isFirst,
  isLast,
}: {
  exercise: AdminExercise;
  supersetLabelText?: string;
  onChange: (partial: Partial<AdminExercise>) => void;
  onRemove: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [detailedMode, setDetailedMode] = useState((exercise.prescriptions?.length ?? 0) > 0);

  function toggleDetailedMode() {
    if (!detailedMode && (!exercise.prescriptions || exercise.prescriptions.length === 0)) {
      const setCount = Math.max(exercise.sets || 1, 1);
      onChange({ prescriptions: Array.from({ length: setCount }, (_, i) => blankPrescription(exercise.id, i + 1)) });
    }
    // Le passage en mode simple ne supprime jamais `exercise.prescriptions` —
    // les données restent en mémoire (et seront réécrites telles quelles à
    // la sauvegarde) même si le tableau n'est plus affiché.
    setDetailedMode((prev) => !prev);
  }

  return (
    <div className="border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          {supersetLabelText ? `${supersetLabelText} — Exercice #${exercise.order}` : `Exercice #${exercise.order}`}
          {exercise.libraryExerciseId && (
            <span className="border border-primary/40 px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-primary">
              Depuis la banque
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onMove("up")} disabled={isFirst} aria-label="Monter l'exercice" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowUp size={14} />
          </button>
          <button type="button" onClick={() => onMove("down")} disabled={isLast} aria-label="Descendre l'exercice" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowDown size={14} />
          </button>
          <button type="button" onClick={onRemove} aria-label="Supprimer l'exercice" className="text-red-400 hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Nom de l'exercice" value={exercise.name} onChange={(v) => onChange({ name: v })} />
        <Field label="Charge conseillée" value={exercise.recommendedLoad} onChange={(v) => onChange({ recommendedLoad: v })} />
        <Field label="Séries" type="number" value={String(exercise.sets)} onChange={(v) => onChange({ sets: Number(v) || 0 })} />
        <Field label="Répétitions (ex : 8, 8-10, AMRAP)" value={exercise.reps} onChange={(v) => onChange({ reps: v })} />
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

      <div className="mt-3">
        <CheckboxField label="Mode détaillé (une prescription par série)" checked={detailedMode} onChange={toggleDetailedMode} />
      </div>
      {detailedMode && (
        <PrescriptionTable
          exerciseId={exercise.id}
          prescriptions={exercise.prescriptions ?? []}
          onChange={(prescriptions) => onChange({ prescriptions })}
        />
      )}
    </div>
  );
}

export function BlockCard({
  block,
  library,
  onChange,
  onRemove,
  onDuplicate,
  onMove,
  isFirst,
  isLast,
}: {
  block: AdminTrainingBlock;
  library: ExerciseLibraryItem[];
  onChange: (updated: AdminTrainingBlock) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMove: (direction: "up" | "down") => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [collapsed, setCollapsed] = useState(false);

  function updateExercise(index: number, partial: Partial<AdminExercise>) {
    const exercises = block.exercises.map((ex, i) => (i === index ? { ...ex, ...partial } : ex));
    onChange({ ...block, exercises });
  }
  function removeExercise(index: number) {
    const exercises = block.exercises.filter((_, i) => i !== index).map((ex, i) => ({ ...ex, order: i + 1 }));
    onChange({ ...block, exercises });
  }
  function moveExercise(index: number, direction: "up" | "down") {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= block.exercises.length) return;
    const exercises = [...block.exercises];
    [exercises[index], exercises[targetIndex]] = [exercises[targetIndex], exercises[index]];
    onChange({ ...block, exercises: exercises.map((ex, i) => ({ ...ex, order: i + 1 })) });
  }
  function addExercise() {
    onChange({ ...block, exercises: [...block.exercises, blankExercise(block.exercises.length + 1)] });
  }
  function addExerciseFromLibraryItem(item: ExerciseLibraryItem) {
    onChange({ ...block, exercises: [...block.exercises, exerciseFromLibrary(block.exercises.length + 1, item)] });
  }

  const showRounds = ROUNDS_TYPES.includes(block.blockType);
  const showTimeCap = TIME_CAP_TYPES.includes(block.blockType);
  const showRestBetweenRounds = REST_BETWEEN_ROUNDS_TYPES.includes(block.blockType);
  const showEmomMinutes = EMOM_TYPES.includes(block.blockType);
  const showScoring = SCORING_TYPES.includes(block.blockType);
  const isMultiExercise = MULTI_EXERCISE_TYPES.includes(block.blockType);
  const color = colorOptions.find((c) => c.value === block.colorKey) ?? colorOptions[0];

  return (
    <div className="border border-border" style={{ borderLeftWidth: 4, borderLeftColor: color.swatch }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/40 px-4 py-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setCollapsed((prev) => !prev)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "Déplier le bloc" : "Replier le bloc"}
            className="text-muted-foreground hover:text-foreground"
          >
            {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          <span className="text-xs font-bold uppercase tracking-widest text-foreground">
            {blockTypeLabels[block.blockType]}
            {block.title ? ` — ${block.title}` : ""}
          </span>
          {block.isSynthesizedStandard && (
            <span className="border border-border px-1.5 py-0.5 text-[10px] normal-case tracking-normal text-muted-foreground">
              Ancienne séance (compatibilité)
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => onMove("up")} disabled={isFirst} aria-label="Monter le bloc" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowUp size={14} />
          </button>
          <button type="button" onClick={() => onMove("down")} disabled={isLast} aria-label="Descendre le bloc" className="text-muted-foreground hover:text-foreground disabled:opacity-30">
            <ArrowDown size={14} />
          </button>
          <button type="button" onClick={onDuplicate} className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary">
            <Copy size={12} />
            Dupliquer
          </button>
          <button type="button" onClick={onRemove} aria-label="Supprimer le bloc" className="text-red-400 hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="flex flex-col gap-4 p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Type de bloc"
              value={block.blockType}
              onChange={(v) => onChange({ ...block, blockType: v as TrainingBlockType })}
              options={blockTypeOptions}
            />
            <Field label="Titre" value={block.title} onChange={(v) => onChange({ ...block, title: v })} placeholder="Ex : AMRAP 12'" />
          </div>
          <TextareaField label="Description" value={block.description} onChange={(v) => onChange({ ...block, description: v })} rows={2} />

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {showRounds && <NumberField label="Nombre de tours" value={block.rounds} onChange={(v) => onChange({ ...block, rounds: v })} min={1} />}
            {showTimeCap && <NumberField label="Time cap (s)" value={block.timeCapSeconds} onChange={(v) => onChange({ ...block, timeCapSeconds: v })} min={0} />}
            {showEmomMinutes && <NumberField label="Durée EMOM (min)" value={block.emomMinutes} onChange={(v) => onChange({ ...block, emomMinutes: v })} min={1} />}
            <NumberField
              label={isMultiExercise ? "Repos entre exercices (s)" : "Repos (s)"}
              value={block.restSeconds}
              onChange={(v) => onChange({ ...block, restSeconds: v })}
              min={0}
            />
            {showRestBetweenRounds && (
              <NumberField label="Repos après chaque tour (s)" value={block.restBetweenRoundsSeconds} onChange={(v) => onChange({ ...block, restBetweenRoundsSeconds: v })} min={0} />
            )}
            {showScoring && <Field label="Scoring" value={block.scoringType ?? ""} onChange={(v) => onChange({ ...block, scoringType: v || null })} placeholder="Ex : rounds + reps" />}
          </div>

          {block.blockType === "emom" && (
            <p className="border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
              EMOM : liste les exercices dans l&apos;ordre — chaque exercice correspond à une minute, répétée en boucle jusqu&apos;à la durée totale ci-dessus.
            </p>
          )}

          <Field label="Média (lien vidéo, optionnel)" value={block.mediaPath ?? ""} onChange={(v) => onChange({ ...block, mediaPath: v || null })} />

          <div>
            <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">Couleur du bloc</span>
            <div className="flex flex-wrap gap-2">
              {colorOptions.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onChange({ ...block, colorKey: c.value })}
                  aria-label={`Couleur ${c.label}`}
                  aria-pressed={block.colorKey === c.value}
                  className={`h-7 w-7 rounded-full border-2 ${block.colorKey === c.value ? "border-foreground" : "border-transparent"}`}
                  style={{ backgroundColor: c.swatch }}
                />
              ))}
            </div>
          </div>

          <ExerciseSearchPicker library={library} onPick={addExerciseFromLibraryItem} />

          <div className="flex flex-col gap-3">
            {block.exercises.map((ex, i) => (
              <BlockExerciseRow
                key={ex.id}
                exercise={ex}
                supersetLabelText={isMultiExercise ? supersetLabelFor(i) : undefined}
                onChange={(partial) => updateExercise(i, partial)}
                onRemove={() => removeExercise(i)}
                onMove={(dir) => moveExercise(i, dir)}
                isFirst={i === 0}
                isLast={i === block.exercises.length - 1}
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
        </div>
      )}
    </div>
  );
}
