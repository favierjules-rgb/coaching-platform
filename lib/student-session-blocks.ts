/**
 * View-model PUR et testable du détail d'une séance élève (correctif ordre
 * canonique — juillet 2026). La page de détail doit rendre une SEULE liste
 * ORDONNÉE de blocs (`session.blocks[]`), jamais deux sections globales
 * séparées (cardio d'un côté, exercices aplatis de l'autre).
 *
 * Normalisation UNE fois à la frontière :
 *  - si `blocks[]` existe → copie triée par `position`, et pour chaque bloc
 *    strength, exercices copiés + triés par `order` canonique ;
 *  - sinon (ancienne séance sans `blocks[]`) → adaptateur legacy explicite :
 *    un bloc strength (exercices dans leur ordre d'entrée) puis les blocs
 *    cardio. Réutilise la même convention d'ordre que `toOrderedBlocks`
 *    (strength d'abord, puis cardio), sans jamais mélanger les deux modèles
 *    pendant le rendu.
 *
 * INTERDIT (et absent ici) : `session.blocks ?? session.exercises`, ou tout
 * fallback évalué dans le composant de rendu. Le rendu ne manipule QUE la
 * sortie de ce helper. Aucune mutation des props (copies systématiques).
 */

import type { AdminCardioBlock, AdminCardioSegment, CardioType, Exercise, MachineType, TrainingBlock } from "@/types";

export interface StudentStrengthBlockView {
  kind: "strength";
  /** UUID du bloc — conservé tel quel (clé stable). */
  id: string;
  colorKey: string;
  title: string | null;
  /** Exercices du bloc UNIQUEMENT, dans l'ordre canonique. Jamais concaténés entre blocs. */
  exercises: Exercise[];
}

export interface StudentCardioBlockView {
  kind: "cardio";
  id: string;
  colorKey: string;
  title: string | null;
  cardioType: CardioType;
  machineType?: MachineType;
  segments: AdminCardioSegment[];
}

export type StudentSessionBlockView = StudentStrengthBlockView | StudentCardioBlockView;

export interface StudentSessionBlockSource {
  blocks?: TrainingBlock[];
  exercises?: Exercise[];
  cardioBlocks?: AdminCardioBlock[];
}

/**
 * Liste unique et ordonnée des blocs pour le rendu du détail de séance.
 * Source de vérité : `blocks[]`. Le legacy n'est utilisé qu'en dernier recours
 * (aucun `blocks[]`), une seule fois, à la frontière.
 */
export function orderedStudentSessionBlocks(session: StudentSessionBlockSource): StudentSessionBlockView[] {
  if (session.blocks && session.blocks.length > 0) {
    return [...session.blocks]
      .sort((a, b) => a.position - b.position)
      .map((block): StudentSessionBlockView =>
        block.category === "strength"
          ? {
              kind: "strength",
              id: block.id,
              colorKey: block.colorKey,
              title: block.title,
              exercises: [...block.exercises].sort((a, b) => a.order - b.order),
            }
          : {
              kind: "cardio",
              id: block.id,
              colorKey: block.colorKey,
              title: block.title,
              cardioType: block.cardioType,
              machineType: block.machineType,
              segments: block.prescriptions,
            },
      );
  }

  // Legacy : aucune donnée blocks[]. Adaptateur unique — un bloc strength
  // (ordre d'entrée) puis les blocs cardio, comme toOrderedBlocks.
  const views: StudentSessionBlockView[] = [];
  const exercises = session.exercises ?? [];
  if (exercises.length > 0) {
    views.push({
      kind: "strength",
      id: "legacy-strength",
      colorKey: "gray",
      title: null,
      exercises: [...exercises],
    });
  }
  for (const cardio of session.cardioBlocks ?? []) {
    views.push({
      kind: "cardio",
      id: cardio.id,
      colorKey: "blue",
      title: cardio.title,
      cardioType: cardio.cardioType,
      machineType: cardio.machineType,
      segments: cardio.segments,
    });
  }
  return views;
}

/**
 * Exercices strength de TOUS les blocs, dans l'ordre canonique (bloc par bloc,
 * puis ordre interne). Sert de source à l'état de retour (une entrée par
 * exercise.id) et à l'analyse « prévu vs réalisé », sans réintroduire
 * `session.exercises[]`.
 */
export function orderedStrengthExercises(views: StudentSessionBlockView[]): Exercise[] {
  return views.flatMap((view) => (view.kind === "strength" ? view.exercises : []));
}
