import { fromSupabaseMeasurementType } from "@/lib/supabase/measurement-types";
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
  epaules: "Épaules",
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
 * Résout le libellé français d'une mensuration standard à partir de sa clé
 * de type, qu'elle soit déjà au format mock français (`BodyMeasurementType`)
 * ou encore au format anglais snake_case tel que stocké en base Supabase
 * (`neck`, `right_arm`...) — voir lib/supabase/measurement-types.ts. Renvoie
 * `null` pour une clé qui ne correspond à aucun des deux formats connus :
 * l'appelant doit alors exclure la mensuration de l'affichage plutôt que de
 * montrer une carte générique "Mensuration".
 */
export function resolveBodyMeasurementLabel(type: string): string | null {
  if (Object.prototype.hasOwnProperty.call(bodyMeasurementLabels, type)) {
    return bodyMeasurementLabels[type as BodyMeasurementType];
  }
  const mockType = fromSupabaseMeasurementType(type);
  return mockType ? bodyMeasurementLabels[mockType] : null;
}

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

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** true seulement si `value` parse en une date réellement valide (jamais Invalid Date). */
export function isValidMeasurementDate(value: string | null | undefined): value is string {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}

/**
 * Écart entre valeur de départ et valeur actuelle. Renvoie null (jamais
 * NaN) dès que l'une des deux valeurs est absente/invalide, pour que
 * l'affichage puisse montrer "—" plutôt qu'un calcul incohérent.
 */
export function measurementDelta(measurement: {
  startValue: number | null | undefined;
  currentValue: number | null | undefined;
}): number | null {
  if (!isFiniteNumber(measurement.startValue) || !isFiniteNumber(measurement.currentValue)) {
    return null;
  }
  return Math.round((measurement.currentValue - measurement.startValue) * 10) / 10;
}

export function isMeasurementProgressing(measurement: BodyMeasurement): boolean | null {
  const delta = measurementDelta(measurement);
  if (delta === null) {
    return null;
  }
  if (delta === 0) {
    return true;
  }
  const direction = delta > 0 ? "up" : "down";
  return direction === (positiveDirection[measurement.type] ?? "up");
}

/**
 * Formate une date de mesure de façon sûre : jamais "Invalid Date" à
 * l'écran, quelle que soit la provenance de la donnée (saisie manuelle,
 * ancien enregistrement localStorage...).
 */
export function formatMeasurementDate(dateIso: string | null | undefined): string {
  if (!dateIso) {
    return "Date non renseignée";
  }
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return "Date non renseignée";
  }
  return date.toLocaleDateString("fr-FR");
}

/**
 * Formate une valeur de mensuration de façon sûre : jamais "NaN" à
 * l'écran, "Non renseigné" si la valeur est absente/invalide.
 */
export function formatMeasurementValue(
  value: number | null | undefined,
  unit: string,
): string {
  if (!isFiniteNumber(value)) {
    return "Non renseigné";
  }
  return `${value} ${unit || ""}`.trim();
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
  /** false si on n'a ni historique de poids ni poids actuel exploitable. */
  hasData: boolean;
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

/**
 * Calcule l'évolution de poids à partir de l'historique et du profil élève.
 * Totalement défensif : certains profils élèves admin peuvent avoir un
 * historique undefined/vide, ou un profil incomplet (startWeightKg,
 * currentWeightKg, targetWeightKg absents) — cette fonction ne doit jamais
 * planter la page détail élève, quelle que soit la forme des données.
 */
export function computeWeightEvolution(
  history: WeightEntry[] | null | undefined,
  profile: (StudentProfile & { startWeightKg?: number }) | null | undefined,
): WeightEvolution {
  const safeHistory = Array.isArray(history) ? history : [];
  const currentWeightKg =
    profile?.currentWeightKg ?? profile?.startWeightKg ?? safeHistory[0]?.kg ?? 0;
  const startWeightKg =
    safeHistory[0]?.kg ?? profile?.startWeightKg ?? profile?.currentWeightKg ?? 0;
  const targetWeightKg = profile?.targetWeightKg ?? currentWeightKg;

  const deltaFromStartKg =
    Math.round((currentWeightKg - startWeightKg) * 10) / 10;

  const progressPercent = computeProgressPercent(
    startWeightKg,
    currentWeightKg,
    targetWeightKg,
  );

  const hasData = safeHistory.length > 0 || Boolean(profile?.currentWeightKg);

  return {
    startWeightKg,
    currentWeightKg,
    targetWeightKg,
    deltaFromStartKg,
    progressPercent,
    hasData,
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
