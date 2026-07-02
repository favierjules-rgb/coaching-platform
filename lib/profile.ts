import type {
  BodyMeasurement,
  BodyMeasurementType,
  CoachingStatus,
  GoalIndicator,
  StudentProfile,
  WeightEntry,
} from "@/types";

export const bodyMeasurementLabels: Record<BodyMeasurementType, string> = {
  poids: "Poids",
  cou: "Tour de cou",
  epaules: "Tour d'épaules",
  poitrine: "Tour de poitrine",
  taille: "Tour de taille",
  nombril: "Tour de nombril",
  hanches: "Tour de hanches",
  "bras-droit": "Bras droit",
  "bras-gauche": "Bras gauche",
  "avant-bras-droit": "Avant-bras droit",
  "avant-bras-gauche": "Avant-bras gauche",
  "cuisse-droite": "Cuisse droite",
  "cuisse-gauche": "Cuisse gauche",
  "mollet-droit": "Mollet droit",
  "mollet-gauche": "Mollet gauche",
};

/**
 * Sens d'évolution considéré comme une progression pour chaque mensuration,
 * compte tenu de l'objectif actuel de l'élève (prise de masse musculaire) :
 * une baisse du tour de taille est positive, une hausse du tour de bras
 * aussi.
 */
const positiveDirection: Record<BodyMeasurementType, "up" | "down"> = {
  poids: "up",
  cou: "up",
  epaules: "up",
  poitrine: "up",
  taille: "down",
  nombril: "down",
  hanches: "down",
  "bras-droit": "up",
  "bras-gauche": "up",
  "avant-bras-droit": "up",
  "avant-bras-gauche": "up",
  "cuisse-droite": "up",
  "cuisse-gauche": "up",
  "mollet-droit": "up",
  "mollet-gauche": "up",
};

export function measurementDelta(measurement: {
  startValue: number;
  currentValue: number;
}): number {
  return (
    Math.round((measurement.currentValue - measurement.startValue) * 10) / 10
  );
}

export function isMeasurementProgressing(measurement: BodyMeasurement): boolean {
  const delta = measurementDelta(measurement);
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

/**
 * Progression vers l'objectif de poids. Prise de masse (objectif > départ)
 * et perte de poids (objectif < départ) utilisent chacune leur propre sens
 * de calcul pour que "se rapprocher de l'objectif" vaille toujours une
 * progression positive, bornée à [0, 100].
 */
function computeProgressPercent(
  startWeightKg: number,
  currentWeightKg: number,
  targetWeightKg: number,
): number {
  if (targetWeightKg === startWeightKg) {
    return 100;
  }
  const raw =
    targetWeightKg > startWeightKg
      ? ((currentWeightKg - startWeightKg) / (targetWeightKg - startWeightKg)) * 100
      : ((startWeightKg - currentWeightKg) / (startWeightKg - targetWeightKg)) * 100;
  return Math.max(0, Math.min(100, Math.round(raw)));
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

  const progressPercent = computeProgressPercent(
    startWeightKg,
    currentWeightKg,
    targetWeightKg,
  );

  return {
    startWeightKg,
    currentWeightKg,
    targetWeightKg,
    deltaFromStartKg,
    progressPercent,
  };
}

const weightHistoryMonths = [
  "Jan",
  "Fév",
  "Mar",
  "Avr",
  "Mai",
  "Jun",
  "Jul",
  "Aoû",
  "Sep",
  "Oct",
  "Nov",
  "Déc",
];

/**
 * Prochain repère mensuel mocké pour l'historique de poids, à la suite
 * d'une mise à jour du poids : poursuit la séquence Jan → Déc plutôt que
 * de dépendre de la date réelle du test.
 */
export function nextWeightHistoryMonth(history: WeightEntry[]): string {
  return weightHistoryMonths[history.length % weightHistoryMonths.length];
}
