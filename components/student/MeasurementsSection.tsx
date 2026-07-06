"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, TrendingDown, TrendingUp } from "lucide-react";

import { ProfileSection } from "@/components/student/ProfileSection";
import {
  UpdateMeasurementsModal,
  type CustomMeasurementInput,
} from "@/components/student/UpdateMeasurementsModal";
import {
  formatMeasurementDate,
  formatMeasurementValue,
  isFiniteNumber,
  isMeasurementProgressing,
  isValidMeasurementDate,
  measurementDelta,
  resolveBodyMeasurementLabel,
} from "@/lib/profile";
import type {
  BodyMeasurement,
  BodyMeasurementType,
  CustomMeasurement,
  MeasurementLogEntry,
} from "@/types";

/** Forme normalisée, déjà validée, consommée par le rendu — voir normalizeStandardMeasurements/normalizeCustomMeasurements. */
interface DisplayMeasurement {
  key: string;
  measurementKey: string;
  label: string;
  unit: string;
  startValue: number;
  currentValue: number;
  lastUpdatedAt: string;
  note: string;
  progressing: boolean | null;
}

/**
 * Filtre les mensurations standards avant affichage : type reconnu (français
 * ou clé Supabase anglaise), valeurs de départ/actuelle chiffrables, date de
 * dernière mise à jour valide — sinon la mensuration est purement exclue
 * plutôt que d'afficher une carte "Mensuration" / "Non renseigné". Dédoublonne
 * par type en ne gardant que la ligne la plus récemment mise à jour (des
 * doublons peuvent apparaître sur d'anciennes données mock/localStorage).
 */
function normalizeStandardMeasurements(measurements: BodyMeasurement[]): DisplayMeasurement[] {
  const byType = new Map<string, DisplayMeasurement>();

  measurements.forEach((measurement, index) => {
    const label = resolveBodyMeasurementLabel(measurement.type);
    if (!label) return;
    if (!isFiniteNumber(measurement.startValue) || !isFiniteNumber(measurement.currentValue)) return;
    if (!isValidMeasurementDate(measurement.lastUpdatedAt)) return;

    const existing = byType.get(measurement.type);
    if (existing && new Date(existing.lastUpdatedAt).getTime() >= new Date(measurement.lastUpdatedAt).getTime()) {
      return;
    }

    byType.set(measurement.type, {
      key: measurement.id || `${measurement.type}-${measurement.lastUpdatedAt}-${index}`,
      measurementKey: measurement.type,
      label,
      unit: measurement.unit,
      startValue: measurement.startValue,
      currentValue: measurement.currentValue,
      lastUpdatedAt: measurement.lastUpdatedAt,
      note: measurement.note,
      progressing: isMeasurementProgressing(measurement),
    });
  });

  return Array.from(byType.values());
}

/** Même logique que normalizeStandardMeasurements, pour les mesures personnalisées (label = nom réel, jamais générique). */
function normalizeCustomMeasurements(measurements: CustomMeasurement[]): DisplayMeasurement[] {
  const byKey = new Map<string, DisplayMeasurement>();

  measurements.forEach((measurement, index) => {
    const label = measurement.name?.trim();
    if (!label) return;
    if (!isFiniteNumber(measurement.startValue) || !isFiniteNumber(measurement.currentValue)) return;
    if (!isValidMeasurementDate(measurement.lastUpdatedAt)) return;

    const dedupeKey = measurement.id || label.toLowerCase();
    const existing = byKey.get(dedupeKey);
    if (existing && new Date(existing.lastUpdatedAt).getTime() >= new Date(measurement.lastUpdatedAt).getTime()) {
      return;
    }

    byKey.set(dedupeKey, {
      key: measurement.id || `${label}-${measurement.lastUpdatedAt}-${index}`,
      measurementKey: measurement.id,
      label,
      unit: measurement.unit,
      startValue: measurement.startValue,
      currentValue: measurement.currentValue,
      lastUpdatedAt: measurement.lastUpdatedAt,
      note: measurement.note,
      progressing: null,
    });
  });

  return Array.from(byKey.values());
}

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

  // Aucune évolution exploitable tant qu'un seul relevé existe (première
  // mesure) : mieux vaut l'indiquer clairement plutôt qu'afficher "+0".
  const isFirstMeasurement = entries.length <= 1 && delta === 0;

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
          {isFirstMeasurement ? (
            <span className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Première mesure
            </span>
          ) : (
            <>
              {delta !== null && delta > 0 ? (
                <TrendingUp size={16} />
              ) : delta !== null && delta < 0 ? (
                <TrendingDown size={16} />
              ) : null}
              {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta} ${unit}`}
            </>
          )}
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

  // Mensurations invalides/incomplètes (type non reconnu, valeurs non
  // chiffrables, date invalide) ou en double : exclues avant affichage
  // plutôt que de montrer une carte "Mensuration" / "Non renseigné".
  const displayMeasurements = normalizeStandardMeasurements(safeMeasurements);
  const displayCustomMeasurements = normalizeCustomMeasurements(safeCustomMeasurements);

  return (
    <ProfileSection
      title="Mensurations"
      action={<UpdateMeasurementsModal measurements={safeMeasurements} onSave={onSave} />}
    >
      {displayMeasurements.length === 0 && displayCustomMeasurements.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucune mensuration enregistrée pour le moment.</p>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {displayMeasurements.map((measurement) => (
              <MeasurementTile
                key={measurement.key}
                measurementKey={measurement.measurementKey}
                label={measurement.label}
                unit={measurement.unit}
                startValue={measurement.startValue}
                currentValue={measurement.currentValue}
                lastUpdatedAt={measurement.lastUpdatedAt}
                note={measurement.note || undefined}
                progressing={measurement.progressing}
                history={safeHistory}
              />
            ))}
          </div>

          {displayCustomMeasurements.length > 0 && (
            <div className="mt-6">
              <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
                Mesures personnalisées
              </span>
              <div className="flex flex-col gap-3">
                {displayCustomMeasurements.map((measurement) => (
                  <MeasurementTile
                    key={measurement.key}
                    measurementKey={measurement.measurementKey}
                    label={measurement.label}
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
