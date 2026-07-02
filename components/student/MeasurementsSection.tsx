"use client";

import { useState } from "react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { ProfileSection } from "@/components/student/ProfileSection";
import {
  UpdateMeasurementsModal,
  type CustomMeasurementInput,
} from "@/components/student/UpdateMeasurementsModal";
import {
  bodyMeasurementLabels,
  isMeasurementProgressing,
  measurementDelta,
} from "@/lib/profile";
import type { BodyMeasurement, BodyMeasurementType, CustomMeasurement } from "@/types";

function MeasurementTile({
  label,
  unit,
  startValue,
  currentValue,
  lastUpdatedAt,
  note,
  progressing,
}: {
  label: string;
  unit: string;
  startValue: number;
  currentValue: number;
  lastUpdatedAt: string;
  note?: string;
  progressing: boolean | null;
}) {
  const delta = measurementDelta({ startValue, currentValue });
  const deltaColor =
    progressing === null
      ? "text-foreground"
      : progressing
        ? "text-green-400"
        : "text-red-400";
  return (
    <div className="flex items-center justify-between gap-4 border border-border p-4">
      <div>
        <span className="block text-sm text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">
          {startValue} {unit} → {currentValue} {unit} · maj{" "}
          {new Date(lastUpdatedAt).toLocaleDateString("fr-FR")}
        </span>
        {note && (
          <span className="mt-1 block text-xs text-muted-foreground">{note}</span>
        )}
      </div>
      <span className={`flex flex-shrink-0 items-center gap-1 text-sm font-bold ${deltaColor}`}>
        {delta > 0 ? (
          <TrendingUp size={16} />
        ) : delta < 0 ? (
          <TrendingDown size={16} />
        ) : null}
        {delta > 0 ? "+" : ""}
        {delta} {unit}
      </span>
    </div>
  );
}

interface MeasurementsSectionProps {
  studentId: string;
  initialMeasurements: BodyMeasurement[];
  initialCustomMeasurements: CustomMeasurement[];
}

export function MeasurementsSection({
  studentId,
  initialMeasurements,
  initialCustomMeasurements,
}: MeasurementsSectionProps) {
  const [measurements, setMeasurements] = useState(initialMeasurements);
  const [customMeasurements, setCustomMeasurements] = useState(
    initialCustomMeasurements,
  );

  function handleSave(
    values: Partial<Record<BodyMeasurementType, number>>,
    date: string,
    note: string,
    custom: CustomMeasurementInput | null,
  ) {
    setMeasurements((prev) =>
      prev.map((measurement) => {
        const newValue = values[measurement.type];
        if (newValue === undefined) {
          return measurement;
        }
        return {
          ...measurement,
          currentValue: newValue,
          note: note || measurement.note,
          lastUpdatedAt: date,
        };
      }),
    );

    if (custom) {
      setCustomMeasurements((prev) => [
        ...prev,
        {
          id: `custom-${Date.now()}`,
          studentId,
          name: custom.name,
          unit: custom.unit,
          startValue: custom.value,
          currentValue: custom.value,
          note: custom.note,
          lastUpdatedAt: date,
        },
      ]);
    }
  }

  return (
    <ProfileSection
      title="Mensurations"
      action={
        <UpdateMeasurementsModal measurements={measurements} onSave={handleSave} />
      }
    >
      <div className="flex flex-col gap-3">
        {measurements.map((measurement) => (
          <MeasurementTile
            key={measurement.type}
            label={bodyMeasurementLabels[measurement.type]}
            unit={measurement.unit}
            startValue={measurement.startValue}
            currentValue={measurement.currentValue}
            lastUpdatedAt={measurement.lastUpdatedAt}
            note={measurement.note || undefined}
            progressing={isMeasurementProgressing(measurement)}
          />
        ))}
      </div>

      {customMeasurements.length > 0 && (
        <div className="mt-6">
          <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
            Mesures personnalisées
          </span>
          <div className="flex flex-col gap-3">
            {customMeasurements.map((measurement) => (
              <MeasurementTile
                key={measurement.id}
                label={measurement.name}
                unit={measurement.unit}
                startValue={measurement.startValue}
                currentValue={measurement.currentValue}
                lastUpdatedAt={measurement.lastUpdatedAt}
                note={measurement.note || undefined}
                progressing={null}
              />
            ))}
          </div>
        </div>
      )}
    </ProfileSection>
  );
}
