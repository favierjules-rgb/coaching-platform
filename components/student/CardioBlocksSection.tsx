import { Activity } from "lucide-react";

import {
  cardioSegmentTypeLabels,
  cardioTypeLabels,
  formatDistanceMeters,
  formatDurationSeconds,
  formatIntensityTargetRaw,
  machineTypeLabels,
} from "@/lib/cardio";
import type { AdminCardioBlock, AdminCardioSegment } from "@/types";

/**
 * Affichage élève en lecture seule des blocs cardio d'une séance (V3 étape
 * 5) — voir components/admin/ProgramBuilder.tsx pour l'éditeur côté coach.
 * Montre les valeurs telles qu'authored par le coach (durée, distance,
 * intensité ciblée...), sans conversion personnalisée à partir du VMA de
 * l'élève : cette conversion (student_profiles.vma_kmh, préparé en étape 1)
 * est une limite documentée de cette version, pas encore branchée — voir
 * docs/training-builder-v3.md.
 */
export function CardioBlocksSection({ blocks }: { blocks: AdminCardioBlock[] }) {
  if (blocks.length === 0) return null;

  return (
    <div className="mb-8 flex flex-col gap-4">
      {blocks.map((block) => (
        <div key={block.id} className="border border-border bg-card p-6">
          <h2 className="mb-1 flex items-center gap-2 font-heading text-sm font-bold uppercase text-foreground">
            <Activity size={16} className="text-primary" />
            {block.title || cardioTypeLabels[block.cardioType]}
          </h2>
          <p className="mb-4 text-xs uppercase tracking-wide text-muted-foreground">
            {cardioTypeLabels[block.cardioType]}
            {block.machineType ? ` · ${machineTypeLabels[block.machineType]}` : ""}
          </p>
          <div className="flex flex-col gap-3">
            {block.segments.map((segment) => (
              <CardioSegmentRow key={segment.id} segment={segment} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CardioSegmentRow({ segment }: { segment: AdminCardioSegment }) {
  const isRepeat = segment.segmentType === "repeat_group";
  const intensityLabel = formatIntensityTargetRaw(segment);

  return (
    <div className="border border-border/60 bg-background/30 p-3">
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
