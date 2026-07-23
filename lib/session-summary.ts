/**
 * Résumés PURS pour l'affichage élève d'une séance multi-blocs (Lot D). Aucune
 * dépendance React. Source = le modèle canonique `TrainingBlock` (jamais
 * `exercises[]`/`cardioBlocks[]`). Réutilisé par les cartes de séance et testé
 * hors rendu.
 */

import { cardioTypeLabels } from "@/lib/cardio";
import type { DerivedSessionType, TrainingBlock } from "@/types";

/** Libellé humain du type global d'une séance (dérivé des blocs). */
export function derivedSessionTypeLabel(type: DerivedSessionType): string {
  switch (type) {
    case "strength":
      return "Musculation";
    case "cardio":
      return "Cardio";
    case "mixed":
      return "Mixte";
    case "rest":
      return "Repos";
  }
}

/**
 * Résumé COMPACT du contenu d'un bloc, pour une pastille de carte de séance :
 * - musculation : les 2 premiers noms d'exercices, sinon « N exercices » ;
 * - cardio : type + durée totale si connue (« Running · 20 min »), sinon type +
 *   nombre de segments (« SkiErg · 6 segments »).
 */
export function summarizeBlock(block: TrainingBlock): string {
  if (block.category === "strength") {
    const exercises = block.exercises;
    if (exercises.length === 0) return "Aucun exercice";
    if (exercises.length <= 2) {
      return exercises.map((e) => e.name.trim() || "Exercice").join(" · ");
    }
    return `${exercises.length} exercices`;
  }

  const label = cardioTypeLabels[block.cardioType] ?? "Cardio";
  const count = block.prescriptions.length;
  const totalSeconds = block.prescriptions.reduce((sum, p) => sum + (p.durationSeconds ?? 0), 0);
  if (totalSeconds > 0) {
    return `${label} · ${Math.round(totalSeconds / 60)} min`;
  }
  if (count > 0) {
    return `${label} · ${count} segment${count > 1 ? "s" : ""}`;
  }
  return label;
}
