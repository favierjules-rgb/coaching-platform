import { generateId } from "@/lib/admin";
import type {
  AdminCardioBlock,
  AdminCardioSegment,
  CardioSegmentType,
  CardioType,
  IntensityTargetType,
  MachineType,
} from "@/types";

/**
 * Labels et helpers pour les blocs/segments cardio du builder V3 (voir
 * migration supabase/migrations/20260716_training_v3_cardio_foundation.sql
 * pour les valeurs exactes autorisées côté base, et
 * components/admin/ProgramBuilder.tsx pour l'UI qui les consomme).
 */

export const cardioTypeLabels: Record<CardioType, string> = {
  continuous_run: "Course continue",
  easy_run: "Footing facile",
  long_run: "Sortie longue",
  tempo_run: "Tempo run",
  threshold_intervals: "Fractionné seuil",
  vma_intervals: "Fractionné VMA",
  short_intervals: "Fractionné court",
  long_intervals: "Fractionné long",
  fartlek: "Fartlek",
  hill_repeats: "Côtes",
  sprint_repeats: "Sprints répétés",
  run_walk: "Run/walk",
  warmup_run: "Footing d'échauffement",
  cooldown_run: "Footing de récupération",
  race_pace: "Allure course",
  time_trial: "Test chronométré",
  vma_test: "Test VMA",
  luc_leger: "Test Luc Léger (VMA)",
  hyrox_run: "Course Hyrox",
  cardio_machine: "Machine cardio (salle)",
  custom_cardio: "Personnalisé",
};

export const machineTypeLabels: Record<MachineType, string> = {
  treadmill: "Tapis de course",
  bike: "Vélo",
  rower: "Rameur",
  skierg: "SkiErg",
  elliptical: "Elliptique",
  air_bike: "Air bike / assault bike",
  stepper: "Stepper",
  other: "Autre",
};

export const cardioSegmentTypeLabels: Record<CardioSegmentType, string> = {
  single: "Effort continu",
  repeat_group: "Fractionné (répétitions)",
  ramp_up: "Progressif (montée)",
  ramp_down: "Progressif (descente)",
};

export const intensityTargetTypeLabels: Record<IntensityTargetType, string> = {
  vma_percentage: "% VMA",
  speed_kmh: "Vitesse (km/h)",
  pace: "Allure (min/km)",
  heart_rate_zone: "Zone FC",
  heart_rate_percentage: "% FC max",
  rpe: "RPE (ressenti)",
  power: "Puissance (W)",
  race_pace: "Allure course",
  free: "Libre",
  custom: "Personnalisé",
};

export function blankCardioSegment(order: number): AdminCardioSegment {
  return {
    id: generateId("seg"),
    order,
    segmentType: "single",
    title: "",
    durationSeconds: 600,
    intensityTargetType: "vma_percentage",
    targetVmaPercentage: 70,
  };
}

export function blankCardioBlock(order: number): AdminCardioBlock {
  return {
    id: generateId("block"),
    order,
    title: "",
    cardioType: "continuous_run",
    segments: [blankCardioSegment(1)],
  };
}

/** Régénère les ids d'un bloc et de ses segments (pour la duplication de semaine/séance — voir ProgramBuilder.tsx). */
export function cloneCardioBlock(block: AdminCardioBlock): AdminCardioBlock {
  return {
    ...block,
    id: generateId("block"),
    segments: block.segments.map((segment) => ({ ...segment, id: generateId("seg") })),
  };
}

/* ─── Conversions VMA / vitesse / allure ─── */

/** Vitesse (km/h) correspondant à un %VMA, pour un VMA de référence donné. */
export function speedFromVmaPercentage(vmaKmh: number, percentage: number): number {
  return (vmaKmh * percentage) / 100;
}

/** Allure en secondes/km à partir d'une vitesse en km/h (0 si vitesse nulle ou négative). */
export function paceSecondsFromSpeedKmh(speedKmh: number): number {
  if (!speedKmh || speedKmh <= 0) return 0;
  return Math.round(3600 / speedKmh);
}

/** Vitesse en km/h à partir d'une allure en secondes/km (0 si allure nulle ou négative). */
export function speedKmhFromPaceSeconds(paceSecondsPerKm: number): number {
  if (!paceSecondsPerKm || paceSecondsPerKm <= 0) return 0;
  return 3600 / paceSecondsPerKm;
}

/** Formate une allure en secondes/km en "m'ss/km" (ex : 240 -> "4'00/km"), "—" si non calculable. */
export function formatPace(paceSecondsPerKm: number | null | undefined): string {
  if (!paceSecondsPerKm || paceSecondsPerKm <= 0) return "—";
  const minutes = Math.floor(paceSecondsPerKm / 60);
  const seconds = Math.round(paceSecondsPerKm % 60);
  return `${minutes}'${String(seconds).padStart(2, "0")}/km`;
}

/** Formate une vitesse en km/h à 1 décimale, "—" si non calculable. */
export function formatSpeed(speedKmh: number | null | undefined): string {
  if (!speedKmh || speedKmh <= 0) return "—";
  return `${speedKmh.toFixed(1)} km/h`;
}

/** Formate une durée en secondes (ex : 90 -> "1min30", 600 -> "10 min", 45 -> "45 s"), "—" si non calculable. */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);
  if (hours > 0) return `${hours}h${String(minutes).padStart(2, "0")}`;
  if (minutes > 0 && secs > 0) return `${minutes}min${String(secs).padStart(2, "0")}`;
  if (minutes > 0) return `${minutes} min`;
  return `${secs} s`;
}

/** Formate une distance en mètres (ex : 400 -> "400 m", 5000 -> "5 km", 12500 -> "12.5 km"), "—" si non calculable. */
export function formatDistanceMeters(meters: number | null | undefined): string {
  if (!meters || meters <= 0) return "—";
  if (meters >= 1000) {
    const km = meters / 1000;
    return `${km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)} km`;
  }
  return `${meters} m`;
}

/**
 * Valeur d'intensité d'un segment telle qu'authored par le coach, sans
 * conversion personnalisée (contrairement à segmentIntensityPreview, qui
 * calcule un aperçu vitesse/allure à partir d'un VMA de référence saisi côté
 * builder). Utilisé par l'affichage élève en lecture seule (voir
 * components/student/CardioBlocksSection.tsx) — la conversion à partir du
 * VMA personnel de l'élève (student_profiles.vma_kmh) est une limite
 * documentée, pas encore branchée (voir docs/training-builder-v3.md).
 */
export function formatIntensityTargetRaw(
  segment: Pick<
    AdminCardioSegment,
    | "intensityTargetType"
    | "targetVmaPercentage"
    | "targetSpeedKmh"
    | "targetPaceSecondsPerKm"
    | "targetHrPercentage"
    | "targetHrZone"
    | "targetPowerWatts"
    | "intensityMin"
  >,
): string {
  switch (segment.intensityTargetType) {
    case "vma_percentage":
      return segment.targetVmaPercentage ? `${segment.targetVmaPercentage}% VMA` : "—";
    case "speed_kmh":
      return formatSpeed(segment.targetSpeedKmh);
    case "pace":
      return formatPace(segment.targetPaceSecondsPerKm);
    case "heart_rate_percentage":
      return segment.targetHrPercentage ? `${segment.targetHrPercentage}% FC max` : "—";
    case "heart_rate_zone":
      return segment.targetHrZone ? `Zone ${segment.targetHrZone}` : "—";
    case "power":
      return segment.targetPowerWatts ? `${segment.targetPowerWatts} W` : "—";
    case "rpe":
      return segment.intensityMin !== undefined ? `RPE ${segment.intensityMin}/10` : "—";
    case "race_pace":
      return "Allure course";
    case "free":
      return "Libre";
    case "custom":
      return "Personnalisé";
    default:
      return "—";
  }
}

export interface SegmentIntensityPreview {
  speedKmh: number | null;
  paceLabel: string | null;
}

/**
 * Aperçu indicatif vitesse/allure pour un segment, à partir d'un VMA de
 * référence saisi par le coach au moment de la construction (champ "VMA de
 * référence (aperçu)" dans DayCard — jamais persisté : c'est uniquement un
 * outil d'aide à la rédaction. La valeur réellement appliquée à chaque
 * élève assigné dépend de son propre VMA, renseigné dans son profil physio
 * — voir student_profiles.vma_kmh). Renvoie des valeurs nulles pour les
 * cibles non convertibles en vitesse (FC, RPE, puissance, libre...).
 */
export function segmentIntensityPreview(
  segment: Pick<AdminCardioSegment, "intensityTargetType" | "targetVmaPercentage" | "targetSpeedKmh" | "targetPaceSecondsPerKm">,
  referenceVmaKmh: number,
): SegmentIntensityPreview {
  switch (segment.intensityTargetType) {
    case "vma_percentage": {
      if (!segment.targetVmaPercentage) return { speedKmh: null, paceLabel: null };
      const speedKmh = speedFromVmaPercentage(referenceVmaKmh, segment.targetVmaPercentage);
      return { speedKmh, paceLabel: formatPace(paceSecondsFromSpeedKmh(speedKmh)) };
    }
    case "speed_kmh": {
      if (!segment.targetSpeedKmh) return { speedKmh: null, paceLabel: null };
      return { speedKmh: segment.targetSpeedKmh, paceLabel: formatPace(paceSecondsFromSpeedKmh(segment.targetSpeedKmh)) };
    }
    case "pace": {
      if (!segment.targetPaceSecondsPerKm) return { speedKmh: null, paceLabel: null };
      return { speedKmh: speedKmhFromPaceSeconds(segment.targetPaceSecondsPerKm), paceLabel: formatPace(segment.targetPaceSecondsPerKm) };
    }
    default:
      return { speedKmh: null, paceLabel: null };
  }
}
