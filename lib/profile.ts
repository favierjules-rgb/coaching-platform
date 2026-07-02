import type {
  BodyMeasurement,
  BodyMeasurementType,
  CoachingStatus,
  GoalIndicator,
  StudentProfile,
  WeightEntry,
} from "@/types";

export const bodyMeasurementLabels: Record<BodyMeasurementType, string> = {
  taille: "Tour de taille",
  hanches: "Tour de hanches",
  poitrine: "Tour de poitrine",
  bras: "Tour de bras",
  cuisse: "Tour de cuisse",
  mollet: "Tour de mollet",
};

/**
 * Sens d'évolution considéré comme une progression pour chaque mensuration,
 * compte tenu de l'objectif actuel de l'élève (prise de masse musculaire) :
 * une baisse du tour de taille est positive, une hausse du tour de bras
 * aussi.
 */
const positiveDirection: Record<BodyMeasurementType, "up" | "down"> = {
  taille: "down",
  hanches: "down",
  poitrine: "up",
  bras: "up",
  cuisse: "up",
  mollet: "up",
};

export function measurementDeltaCm(measurement: BodyMeasurement): number {
  return (
    Math.round((measurement.currentValueCm - measurement.startValueCm) * 10) /
    10
  );
}

export function isMeasurementProgressing(measurement: BodyMeasurement): boolean {
  const delta = measurementDeltaCm(measurement);
  if (delta === 0) {
    return true;
  }
  const direction = delta > 0 ? "up" : "down";
  return direction === positiveDirection[measurement.type];
}

export const coachingStatusLabels: Record<CoachingStatus, string> = {
  actif: "Actif",
  pause: "En pause",
  terminé: "Terminé",
};

export const goalIndicatorLabels: Record<GoalIndicator, string> = {
  poids: "Poids",
  mensurations: "Mensurations",
  photos: "Photos",
  performance: "Performance",
  énergie: "Énergie",
  digestion: "Digestion",
  sommeil: "Sommeil",
};

export interface WeightEvolution {
  startWeightKg: number;
  currentWeightKg: number;
  targetWeightKg: number;
  deltaFromStartKg: number;
  progressPercent: number;
}

export function computeWeightEvolution(
  history: WeightEntry[],
  profile: StudentProfile,
): WeightEvolution {
  const startWeightKg = history[0]?.kg ?? profile.currentWeightKg;
  const currentWeightKg = profile.currentWeightKg;
  const targetWeightKg = profile.targetWeightKg;

  const deltaFromStartKg =
    Math.round((currentWeightKg - startWeightKg) * 10) / 10;

  const totalNeeded = targetWeightKg - startWeightKg;
  const progressPercent =
    totalNeeded === 0
      ? 100
      : Math.max(
          0,
          Math.min(
            100,
            Math.round(((currentWeightKg - startWeightKg) / totalNeeded) * 100),
          ),
        );

  return {
    startWeightKg,
    currentWeightKg,
    targetWeightKg,
    deltaFromStartKg,
    progressPercent,
  };
}
