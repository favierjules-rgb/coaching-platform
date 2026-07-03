"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react";

import { ProfileSection } from "@/components/student/ProfileSection";
import {
  UpdateMeasurementsModal,
  type CustomMeasurementInput,
} from "@/components/student/UpdateMeasurementsModal";
import {
  bodyMeasurementLabels,
  formatMeasurementDate,
  formatMeasurementValue,
  isMeasurementProgressing,
  measurementDelta,
} from "@/lib/profile";
import type {
  BodyMeasurement,
  BodyMeasurementType,
  CustomMeasurement,
  MeasurementLogEntry,
} from "@/types";

function MeasurementTile({
  measurementKey,
  label,
  unit,
  startValue,
  currentValue,
  lastUpdatedAt,
  note,
  progressing,
  history,
}: {
  measurementKey: string;
  label: string;
  unit: string;
  startValue: number | null | undefined;
  currentValue: number | null | undefined;
  lastUpdatedAt: string | null | undefined;
  note?: string;
  progressing: boolean | null;
  history: MeasurementLogEntry[];
}) {
  const [showHistory, setShowHistory] = useState(false);
  const delta = measurementDelta({ startValue, currentValue });
  const deltaColor =
    progressing === null
      ? "text-foreground"
      : progressing
        ? "text-green-400"
        : "text-red-400";

  const entries = history
    .filter((entry) => entry.key === measurementKey)
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());

  return (
    <div className="border border-border p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <span className="block text-sm text-foreground">{label || "Mensuration"}</span>
          <span className="text-xs text-muted-foreground">
            {formatMeasurementValue(startValue, unit)} → {formatMeasurementValue(currentValue, unit)} · maj{" "}
            {formatMeasurementDate(lastUpdatedAt)}
          </span>
          {note && (
            <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
          )}
        </div>
        <span className={`flex flex-shrink-0 items-center gap-1 text-sm font-bold ${deltaColor}`}>
          {delta !== null && delta > 0 ? (
            <TrendingUp size={16} />
          ) : delta !== null && delta < 0 ? (
            <TrendingDown size={16} />
          ) : null}
          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta} ${unit}`}
        </span>
      </div>

      {entries.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <button
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary"
          >
            {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Historique ({entries.length})
          </button>
          {showHistory && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
                >
                  <span>{formatMeasurementDate(entry.measuredAt)}</span>
                  <span className="text-foreground">{formatMeasurementValue(entry.value, entry.unit)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

interface MeasurementsSectionProps {
  measurements: BodyMeasurement[];
  customMeasurements: CustomMeasurement[];
  measurementHistory?: MeasurementLogEntry[];
  onSave: (
    values: Partial<Record<BodyMeasurementType, number>>,
    date: string,
    note: string,
    custom: CustomMeasurementInput | null,
  ) => void;
}

/**
 * Purement présentationnel : l'état (measurements/customMeasurements) vient
 * du hook partagé useStudentProfile, monté une seule fois plus haut sur la
 * page, pour que la mise à jour reste visible sur toute la page.
 */
export function MeasurementsSection({
  measurements,
  customMeasurements,
  measurementHistory,
  onSave,
}: MeasurementsSectionProps) {
  // Défensif : certains profils élèves (admin en particulier) peuvent avoir
  // measurements/customMeasurements undefined si l'enregistrement date
  // d'avant l'ajout de ces champs — on ne doit jamais planter dessus.
  const safeMeasurements = Array.isArray(measurements) ? measurements : [];
  const safeCustomMeasurements = Array.isArray(customMeasurements) ? customMeasurements : [];
  const safeHistory = Array.isArray(measurementHistory) ? measurementHistory : [];

  return (
    <ProfileSection
      title="Mensurations"
      action={<UpdateMeasurementsModal measurements={safeMeasurements} onSave={onSave} />}
    >
      {safeMeasurements.length === 0 && safeCustomMeasurements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune mensuration enregistrée pour le moment.</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {safeMeasurements.map((measurement) => (
              <MeasurementTile
                key={measurement.type}
                measurementKey={measurement.type}
                label={bodyMeasurementLabels[measurement.type] ?? "Mensuration"}
                unit={measurement.unit}
                startValue={measurement.startValue}
                currentValue={measurement.currentValue}
                lastUpdatedAt={measurement.lastUpdatedAt}
                note={measurement.note || undefined}
                progressing={isMeasurementProgressing(measurement)}
                history={safeHistory}
              />
            ))}
          </div>

          {safeCustomMeasurements.length > 0 && (
            <div className="mt-6">
              <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
                Mesures personnalisées
              </span>
              <div className="flex flex-col gap-3">
                {safeCustomMeasurements.map((measurement) => (
                  <MeasurementTile
                    key={measurement.id}
                    measurementKey={measurement.id}
                    label={measurement.name || "Mesure personnalisée"}
                    unit={measurement.unit}
                    startValue={measurement.startValue}
                    currentValue={measurement.currentValue}
                    lastUpdatedAt={measurement.lastUpdatedAt}
                    note={measurement.note || undefined}
                    progressing={null}
                    history={safeHistory}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </ProfileSection>
  );
}
