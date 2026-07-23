/**
 * Carte de chaleur musculaire — calcul PUR à partir du modèle canonique
 * `session.blocks[]` (chantier expérience élève, Lot B — juillet 2026).
 *
 * SOURCE CANONIQUE : les blocs `strength` d'une séance (ou d'un ensemble de
 * séances pour une semaine/un programme). On NE lit JAMAIS `session.exercises[]`
 * comme source de vérité : l'entrée est toujours `TrainingBlock[]`. Les blocs
 * `cardio` sont volontairement ignorés pour la chaleur MUSCULAIRE (ils ne
 * ciblent pas un groupe de musculation).
 *
 * Aucune dépendance React/Supabase : fonction pure, testable
 * (scripts/tests/muscle-heatmap.mts) et réutilisable côté séance ET semaine.
 * Le mapping des libellés libres vers un groupe canonique réutilise
 * `normalizeMuscleGroups` (lib/training-metrics.ts), déjà éprouvé — un exercice
 * sans groupe valide retombe sur "autre" et est compté en « non localisé »,
 * jamais perdu, jamais placé à tort sur le schéma.
 */

import { normalizeMuscleGroups } from "@/lib/training-metrics";
import type { TrainingBlock } from "@/types";

/**
 * Les 12 zones dessinées sur le schéma du corps (les avant-bras et les
 * lombaires ont été ajoutés en juillet 2026 depuis le schéma redessiné par le
 * coach : contours dédiés, séparés du dos pour les lombaires). Les autres
 * groupes canoniques (cardio, full-body, autre) existent mais ne sont pas
 * localisés sur le schéma : leurs séries sont agrégées dans `otherSets` et
 * listées textuellement, pour ne jamais afficher une précision anatomique
 * fausse.
 */
export const BODY_ZONES = [
  "pectoraux",
  "dos",
  "lombaires",
  "épaules",
  "biceps",
  "triceps",
  "avant-bras",
  "abdos",
  "quadriceps",
  "ischios",
  "fessiers",
  "mollets",
] as const;

export type BodyZone = (typeof BODY_ZONES)[number];

const BODY_ZONE_SET: ReadonlySet<string> = new Set(BODY_ZONES);

export const BODY_ZONE_LABELS: Record<BodyZone, string> = {
  pectoraux: "Pectoraux",
  dos: "Dos",
  lombaires: "Lombaires",
  "épaules": "Épaules",
  biceps: "Biceps",
  triceps: "Triceps",
  "avant-bras": "Avant-bras",
  abdos: "Abdos",
  quadriceps: "Quadriceps",
  ischios: "Ischios",
  fessiers: "Fessiers",
  mollets: "Mollets",
};

export type MuscleHeatLevel = 0 | 1 | 2 | 3 | 4;

/**
 * Seuils d'intensité CENTRALISÉS et testables : nombre de séries prévues d'un
 * groupe → niveau 0..4. ABSOLUS (et non uniquement relatifs au muscle le plus
 * travaillé), ce qui fournit le « plafond cohérent » demandé : une seule série
 * dans une séance légère reste « faible » (rouge très pâle) au lieu de devenir
 * rouge vif. Bornes auditées : 0 / 1-3 / 4-7 / 8-11 / 12+.
 */
export const MUSCLE_HEAT_THRESHOLDS: ReadonlyArray<{ level: MuscleHeatLevel; label: string; minSets: number }> = [
  { level: 0, label: "Aucune", minSets: 0 },
  { level: 1, label: "Faible", minSets: 1 },
  { level: 2, label: "Modéré", minSets: 4 },
  { level: 3, label: "Élevé", minSets: 8 },
  { level: 4, label: "Très élevé", minSets: 12 },
];

/** Niveau d'intensité (0..4) d'un nombre de séries, selon les seuils centralisés. */
export function setsToHeatLevel(sets: number): MuscleHeatLevel {
  let level: MuscleHeatLevel = 0;
  for (const threshold of MUSCLE_HEAT_THRESHOLDS) {
    if (sets >= threshold.minSets) level = threshold.level;
  }
  return level;
}

/** Libellé lisible d'un niveau d'intensité (légende). */
export function heatLevelLabel(level: MuscleHeatLevel): string {
  return MUSCLE_HEAT_THRESHOLDS.find((t) => t.level === level)?.label ?? "Aucune";
}

/**
 * Échelle visuelle CENTRALISÉE (niveau -> remplissage), partagée par le schéma
 * (BodyMap) et la légende (MuscleHeatmapSection) pour rester cohérente. Rouge
 * fonctionnel de heatmap (pas une couleur de marque) : neutre à 0, du rouge
 * très pâle au rouge vif ensuite. L'opacité au-dessus des surfaces garde un
 * rendu correct en thème clair comme sombre.
 */
export const MUSCLE_HEAT_FILL: Record<MuscleHeatLevel, string> = {
  0: "var(--surface-soft)",
  1: "rgb(239 68 68 / 0.20)",
  2: "rgb(239 68 68 / 0.42)",
  3: "rgb(239 68 68 / 0.66)",
  4: "rgb(239 68 68 / 0.90)",
};

export interface HeatmapZone {
  zone: BodyZone;
  label: string;
  /** Séries prévues agrégées sur ce groupe. */
  sets: number;
  /** Part 0..1 de ce groupe dans le total des séries LOCALISÉES (zones du schéma). */
  share: number;
  level: MuscleHeatLevel;
}

export interface MuscleHeatmap {
  /** Toutes les zones du schéma, y compris celles à 0 série (nécessaire au rendu SVG neutre). */
  zones: Record<BodyZone, HeatmapZone>;
  /** Zones réellement travaillées (sets > 0), triées par séries décroissantes. */
  worked: HeatmapZone[];
  /** Total des séries localisées sur le schéma. */
  totalSets: number;
  /** Séries des groupes non localisés (full-body, cardio, non renseigné…). */
  otherSets: number;
  /** Séries du muscle le plus travaillé (0 si aucune) — utile pour un affichage relatif optionnel. */
  maxSets: number;
}

function emptyZoneSets(): Record<BodyZone, number> {
  const record = {} as Record<BodyZone, number>;
  for (const zone of BODY_ZONES) record[zone] = 0;
  return record;
}

/**
 * Agrège les séries prévues par groupe musculaire depuis les blocs `strength`.
 * Un exercice ciblant plusieurs groupes (ex. « pectoraux, triceps ») compte ses
 * séries pour CHAQUE groupe (mouvement composé), cohérent avec
 * `calculateMuscleGroupSets` (lib/training-metrics.ts). Les parts (`share`) sont
 * donc calculées sur la somme des séries par zone, et somment à 1 sur les zones.
 */
export function calculateMuscleHeatmap(blocks: readonly TrainingBlock[]): MuscleHeatmap {
  const setsByZone = emptyZoneSets();
  let otherSets = 0;

  for (const block of blocks) {
    if (block.category !== "strength") continue; // cardio ignoré pour la chaleur musculaire
    for (const exercise of block.exercises) {
      const groups = normalizeMuscleGroups(exercise.muscleGroup);
      const sets = Number.isFinite(exercise.sets) && exercise.sets > 0 ? exercise.sets : 0;
      if (sets === 0) continue;
      for (const group of groups) {
        if (BODY_ZONE_SET.has(group)) {
          setsByZone[group as BodyZone] += sets;
        } else {
          otherSets += sets;
        }
      }
    }
  }

  const totalSets = BODY_ZONES.reduce((sum, zone) => sum + setsByZone[zone], 0);
  const maxSets = BODY_ZONES.reduce((max, zone) => Math.max(max, setsByZone[zone]), 0);

  const zones = {} as Record<BodyZone, HeatmapZone>;
  for (const zone of BODY_ZONES) {
    const sets = setsByZone[zone];
    zones[zone] = {
      zone,
      label: BODY_ZONE_LABELS[zone],
      sets,
      share: totalSets > 0 ? sets / totalSets : 0,
      level: setsToHeatLevel(sets),
    };
  }

  const worked = BODY_ZONES.map((zone) => zones[zone])
    .filter((z) => z.sets > 0)
    .sort((a, b) => b.sets - a.sets);

  return { zones, worked, totalSets, otherSets, maxSets };
}
