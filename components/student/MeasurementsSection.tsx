import { TrendingDown, TrendingUp } from "lucide-react";

import { ProfileSection } from "@/components/student/ProfileSection";
import {
  UpdateMeasurementsModal,
  type CustomMeasurementInput,
} from "@/components/student/UpdateMeasurementsModal";
import { bodyMeasurementLabels, isMeasurementProgressing, measurementDelta } from "@/lib/profile";
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
  measurements: BodyMeasurement[];
  customMeasurements: CustomMeasurement[];
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
  onSave,
}: MeasurementsSectionProps) {
  // Défensif : certains profils élèves (admin en particulier) peuvent avoir
  // measurements/customMeasurements undefined si l'enregistrement date
  // d'avant l'ajout de ces champs — on ne doit jamais planter dessus.
  const safeMeasurements = Array.isArray(measurements) ? measurements : [];
  const safeCustomMeasurements = Array.isArray(customMeasurements) ? customMeasurements : [];

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

          {safeCustomMeasurements.length > 0 && (
            <div className="mt-6">
              <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
                Mesures personnalisées
              </span>
              <div className="flex flex-col gap-3">
                {safeCustomMeasurements.map((measurement) => (
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
        </>
      )}
    </ProfileSection>
  );
}
