import type { BodyMeasurementType } from "@/types";

/**
 * Correspondance entre les clés françaises du mock (`BodyMeasurementType`,
 * voir types/index.ts) et les clés anglaises snake_case stockées dans la
 * colonne `body_measurements.type` (sans contrainte CHECK côté DB, voir
 * supabase/schema.sql). Les composants d'affichage (MeasurementsSection,
 * bodyMeasurementLabels...) réutilisent tous BodyMeasurementType : cette
 * table de correspondance est le seul endroit où l'on convertit vers/depuis
 * la forme stockée en base.
 */
export const measurementTypeToSupabase: Record<BodyMeasurementType, string> = {
  poids: "weight",
  cou: "neck",
  epaules: "shoulders",
  poitrine: "chest",
  taille: "waist",
  nombril: "navel",
  hanches: "hips",
  "bras-droit": "right_arm",
  "bras-gauche": "left_arm",
  "avant-bras-droit": "right_forearm",
  "avant-bras-gauche": "left_forearm",
  "cuisse-droite": "right_thigh",
  "cuisse-gauche": "left_thigh",
  "mollet-droit": "right_calf",
  "mollet-gauche": "left_calf",
};

const supabaseToMeasurementType = new Map<string, BodyMeasurementType>(
  (Object.entries(measurementTypeToSupabase) as [BodyMeasurementType, string][]).map(([mockType, supabaseType]) => [
    supabaseType,
    mockType,
  ]),
);

export function toSupabaseMeasurementType(type: BodyMeasurementType): string {
  return measurementTypeToSupabase[type] ?? type;
}

/** Renvoie `null` pour une clé inconnue plutôt que de planter l'affichage. */
export function fromSupabaseMeasurementType(type: string): BodyMeasurementType | null {
  return supabaseToMeasurementType.get(type) ?? null;
}
