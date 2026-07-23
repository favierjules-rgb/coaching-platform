import { Activity } from "lucide-react";

import { BLOCK_COLOR_STYLES } from "@/components/admin/blocks/block-view-model";
import {
  cardioSegmentTypeLabels,
  cardioTypeLabels,
  formatDistanceMeters,
  formatDurationSeconds,
  formatIntensityTargetRaw,
  machineTypeLabels,
} from "@/lib/cardio";
import type { StudentCardioBlockView } from "@/lib/student-session-blocks";
import { normalizeColorKey } from "@/lib/training-block-editing";
import type { AdminCardioSegment } from "@/types";

/**
 * Carte d'un bloc CARDIO dans le détail d'une séance élève, rendue EXACTEMENT
 * à sa position dans la liste ordonnée (plus de section cardio globale placée
 * systématiquement avant/après les exercices). Lecture seule : mêmes valeurs
 * qu'authored par le coach (durée, distance, D+, intensité…).
 */
export function StudentCardioBlockCard({ block }: { block: StudentCardioBlockView }) {
  const color = BLOCK_COLOR_STYLES[normalizeColorKey(block.colorKey, "blue")];
  return (
    <section className={`rounded-card border border-l-4 border-border ${color.borderLeft} ${color.softBg} p-5 shadow-soft`}>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${color.dot}`} aria-hidden="true" />
        <Activity size={15} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Cardio</span>
        <h2 className="font-heading text-sm font-bold uppercase text-foreground">
          · {block.title || cardioTypeLabels[block.cardioType]}
        </h2>
      </div>
      <p className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
        {cardioTypeLabels[block.cardioType]}
        {block.machineType ? ` · ${machineTypeLabels[block.machineType]}` : ""}
      </p>
      <div className="flex flex-col gap-3">
        {block.segments.map((segment) => (
          <CardioSegmentRow key={segment.id} segment={segment} />
        ))}
      </div>
    </section>
  );
}

function CardioSegmentRow({ segment }: { segment: AdminCardioSegment }) {
  const isRepeat = segment.segmentType === "repeat_group";
  const intensityLabel = formatIntensityTargetRaw(segment);

  return (
    <div className="rounded-panel border border-border/60 bg-surface-soft/40 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-foreground">
          {segment.title || cardioSegmentTypeLabels[segment.segmentType]}
        </span>
        {isRepeat && segment.repetitions ? (
          <span className="text-xs uppercase tracking-wide text-muted-foreground">× {segment.repetitions}</span>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        {segment.durationSeconds ? (
          <span>
            {isRepeat ? "Effort " : "Durée "}
            {formatDurationSeconds(segment.durationSeconds)}
          </span>
        ) : null}
        {segment.distanceMeters ? (
          <span>
            {isRepeat ? "Distance effort " : "Distance "}
            {formatDistanceMeters(segment.distanceMeters)}
          </span>
        ) : null}
        {isRepeat && (segment.recoveryDurationSeconds || segment.recoveryDistanceMeters) ? (
          <span>
            Récup {formatDurationSeconds(segment.recoveryDurationSeconds)}
            {segment.recoveryDistanceMeters ? ` / ${formatDistanceMeters(segment.recoveryDistanceMeters)}` : ""}
          </span>
        ) : null}
        {segment.elevationGainMeters ? <span>D+ {segment.elevationGainMeters} m</span> : null}
        {segment.inclinePercentage ? <span>Inclinaison {segment.inclinePercentage}%</span> : null}
        {segment.targetCadence ? <span>Cadence {segment.targetCadence} spm</span> : null}
      </div>

      <p className="mt-2 text-sm font-medium text-primary">Intensité : {intensityLabel}</p>

      {segment.coachNotes ? <p className="mt-1 text-xs text-muted-foreground">{segment.coachNotes}</p> : null}
    </div>
  );
}
