import { TrendingDown, TrendingUp } from "lucide-react";

import { MockActionModal, MockField } from "@/components/student/MockActionModal";
import { ProfileSection } from "@/components/student/ProfileSection";
import {
  bodyMeasurementLabels,
  isMeasurementProgressing,
  measurementDeltaCm,
} from "@/lib/profile";
import type { BodyMeasurement } from "@/types";

export function MeasurementsSection({
  measurements,
}: {
  measurements: BodyMeasurement[];
}) {
  return (
    <ProfileSection
      title="Mensurations"
      action={
        <MockActionModal
          triggerLabel="Mettre à jour mes mensurations"
          title="Mettre à jour mes mensurations"
          description="Renseigne tes mensurations du jour. Cette action est une démonstration : aucune donnée n'est encore enregistrée."
          confirmLabel="Enregistrer"
          successMessage="Mensurations enregistrées. Ton coach pourra les consulter."
        >
          <MockField label="Tour de taille (cm)" type="number" />
          <MockField label="Tour de bras (cm)" type="number" />
        </MockActionModal>
      }
    >
      <div className="flex flex-col">
        {measurements.map((measurement) => {
          const delta = measurementDeltaCm(measurement);
          const progressing = isMeasurementProgressing(measurement);
          return (
            <div
              key={measurement.type}
              className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0"
            >
              <div>
                <span className="block text-sm text-foreground">
                  {bodyMeasurementLabels[measurement.type]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {measurement.startValueCm} cm → {measurement.currentValueCm} cm ·
                  maj {new Date(measurement.lastUpdatedAt).toLocaleDateString("fr-FR")}
                </span>
              </div>
              <span
                className={`flex items-center gap-1 text-sm font-bold ${
                  progressing ? "text-green-400" : "text-red-400"
                }`}
              >
                {delta > 0 ? (
                  <TrendingUp size={16} />
                ) : delta < 0 ? (
                  <TrendingDown size={16} />
                ) : null}
                {delta > 0 ? "+" : ""}
                {delta} cm
              </span>
            </div>
          );
        })}
      </div>
    </ProfileSection>
  );
}
