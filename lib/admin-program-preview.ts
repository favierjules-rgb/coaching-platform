/**
 * View-model PUR et testable de l'aperçu d'une séance sur la page de DÉTAIL
 * ADMIN d'un programme (/admin/programmes/[programId], chantier polish Apple
 * admin — Lot D). La page ne doit jamais reconstruire l'aperçu depuis
 * `session.exercises[]` / `session.cardioBlocks[]` : la source d'affichage est
 * `session.blocks[]` (déjà composée, ordonnée et colorée par
 * lib/supabase/programs.ts).
 *
 * Contrat (identique à l'esprit de lib/student-session-blocks.ts, mais pour la
 * forme admin `AdminWorkoutSession` et un retour `TrainingBlock[]` consommable
 * par SessionBlockChips) :
 *  - si `session.blocks` EST un tableau — MÊME VIDE — c'est la source
 *    canonique : COPIE triée par `position`, sans jamais retomber sur le legacy
 *    ni muter la séance source ; `id`, `position`, `category`, `colorKey`,
 *    `title` et le contenu de chaque bloc sont conservés tels quels. Un tableau
 *    VIDE est un résultat canonique valide (séance de repos, séance
 *    volontairement vide, ou séance dont tous les blocs ont été supprimés) et
 *    doit rendre `[]` — surtout PAS reconstruire depuis exercises[]/
 *    cardioBlocks[], sous peine de faire réapparaître d'anciennes valeurs
 *    legacy résiduelles.
 *  - UNIQUEMENT si `session.blocks` est réellement absent (`undefined`, vraie
 *    ancienne séance jamais passée par le modèle multi-blocs) → adaptateur
 *    legacy EXISTANT `toOrderedBlocks(session)`, appelé UNE seule fois à la
 *    frontière (aucune logique dupliquée ici).
 *
 * `AdminWorkoutSession.blocks` est typé `TrainingBlock[] | undefined` (jamais
 * `null` — voir le mapper lib/supabase/programs.ts qui compose toujours un
 * tableau, éventuellement vide). `Array.isArray` distingue donc proprement le
 * canonique (tableau, même vide) du legacy (absent) ; `null` éventuel n'est pas
 * assimilé au canonique (il retomberait sur le legacy, comportement conservateur).
 *
 * INTERDIT (et absent ici) : `session.blocks?.length`, `session.blocks &&
 * session.blocks.length > 0`, `session.blocks ?? session.exercises`, un tri par
 * catégorie, ou toute mutation de l'entrée.
 */

import { toOrderedBlocks } from "@/lib/training-blocks";
import type { AdminWorkoutSession, TrainingBlock } from "@/types";

/** Champs minimaux nécessaires à l'aperçu — `blocks[]` prioritaire, legacy en repli. */
export type AdminSessionPreviewSource = Pick<AdminWorkoutSession, "id" | "exercises" | "cardioBlocks"> & {
  blocks?: TrainingBlock[];
};

/**
 * Liste unique et ordonnée des blocs d'une séance pour l'aperçu admin.
 * Source de vérité : `blocks[]`. Le legacy n'est utilisé qu'en dernier recours
 * (aucun `blocks[]`), une seule fois, via l'adaptateur existant.
 */
export function orderedAdminSessionBlocks(session: AdminSessionPreviewSource): TrainingBlock[] {
  // `blocks` présent (tableau, MÊME VIDE) = source canonique : copie du tableau
  // (l'entrée n'est jamais mutée) triée par position ; les objets bloc sont
  // conservés à l'identique (id/position/category/colorKey/title/contenu). Un
  // tableau vide rend `[]` sans jamais lire exercises[]/cardioBlocks[].
  if (Array.isArray(session.blocks)) {
    return [...session.blocks].sort((a, b) => a.position - b.position);
  }

  // `blocks` réellement absent (undefined) : VRAIE ancienne séance. Normalisation
  // UNE fois via l'adaptateur canonique (bloc strength legacy puis blocs cardio,
  // positions renormalisées 0..n) — seul cas où le legacy est lu.
  return toOrderedBlocks(session);
}
