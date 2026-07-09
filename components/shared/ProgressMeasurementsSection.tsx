import { TrendingDown, TrendingUp } from "lucide-react";

import {
  formatMeasurementDate,
  formatMeasurementValue,
  isFiniteNumber,
  isValidMeasurementDate,
  measurementDelta,
  resolveBodyMeasurementLabel,
} from "@/lib/profile";
import type { BodyMeasurement, CustomMeasurement } from "@/types";

interface DisplayRow {
  key: string;
  label: string;
  unit: string;
  startValue: number;
  currentValue: number;
  lastUpdatedAt: string;
}

function normalize(measurements: BodyMeasurement[], customMeasurements: CustomMeasurement[]): DisplayRow[] {
  const rows: DisplayRow[] = [];
  const byKey = new Map<string, DisplayRow>();

  for (const m of measurements) {
    const label = resolveBodyMeasurementLabel(m.type);
    if (!label || !isFiniteNumber(m.startValue) || !isFiniteNumber(m.currentValue) || !isValidMeasurementDate(m.lastUpdatedAt)) continue;
    const existing = byKey.get(m.type);
    if (!existing || existing.lastUpdatedAt < m.lastUpdatedAt) {
      byKey.set(m.type, { key: m.type, label, unit: m.unit, startValue: m.startValue, currentValue: m.currentValue, lastUpdatedAt: m.lastUpdatedAt });
    }
  }
  for (const m of customMeasurements) {
    if (!m.name.trim() || !isFiniteNumber(m.startValue) || !isFiniteNumber(m.currentValue) || !isValidMeasurementDate(m.lastUpdatedAt)) continue;
    const existing = byKey.get(m.id);
    if (!existing || existing.lastUpdatedAt < m.lastUpdatedAt) {
      byKey.set(m.id, { key: m.id, label: m.name, unit: m.unit, startValue: m.startValue, currentValue: m.currentValue, lastUpdatedAt: m.lastUpdatedAt });
    }
  }
  rows.push(...byKey.values());
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

function MeasurementTile({ row }: { row: DisplayRow }) {
  const delta = measurementDelta(row);
  const trendLabel = delta === null ? "Une seule mesure" : delta === 0 ? "Stable" : delta > 0 ? "En hausse" : "En baisse";
  const TrendIcon = delta === null || delta === 0 ? null : delta > 0 ? TrendingUp : TrendingDown;

  return (
    <div className="border border-border p-4">
      <span className="block text-xs uppercase tracking-wide text-muted-foreground">{row.label}</span>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-lg font-bold text-foreground">{formatMeasurementValue(row.currentValue, row.unit)}</span>
        {TrendIcon && <TrendIcon size={16} className="text-muted-foreground" aria-hidden="true" />}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Départ {formatMeasurementValue(row.startValue, row.unit)} · {trendLabel}
        {delta !== null && delta !== 0 ? ` (${delta > 0 ? "+" : ""}${delta} ${row.unit})` : ""}
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">Maj le {formatMeasurementDate(row.lastUpdatedAt)}</p>
    </div>
  );
}

/** Mensurations (section 3) — lecture seule, jamais de mensuration inventée : une mesure absente ou invalide est simplement exclue plutôt que remplacée par un texte générique. */
export function ProgressMeasurementsSection({
  measurements,
  customMeasurements,
}: {
  measurements: BodyMeasurement[];
  customMeasurements: CustomMeasurement[];
}) {
  const rows = normalize(measurements ?? [], customMeasurements ?? []);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune donnée disponible pour le moment.</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list" aria-label="Mensurations">
      {rows.map((row) => (
        <MeasurementTile key={row.key} row={row} />
      ))}
    </div>
  );
}
