/**
 * Historique immuable des séances réalisées — fonctions PURES (phase 1 du
 * chantier `feat/student-workout-history`). Aucune dépendance React ni
 * Supabase : construction et lecture de la photographie du PRESCRIT prise au
 * moment où l'élève termine sa séance.
 *
 * Principe fondamental du chantier : ne jamais mélanger le planifié et le
 * réalisé. Le réalisé vit déjà dans `exercise_feedback` /
 * `exercise_set_feedback` ; ce module fige le planifié tel qu'il était à la
 * soumission, pour que le récapitulatif reste une photographie fidèle même si
 * le coach retravaille ensuite la séance dans le builder.
 *
 * Le snapshot est construit à partir des LIGNES LUES EN BASE (séance, blocs,
 * exercices) — jamais depuis un JSON librement fourni par le navigateur : la
 * forme est décidée ici, champ par champ, à partir de données sous RLS.
 */

/** Version du format — permettra d'évoluer sans casser les anciens snapshots. */
export const PRESCRIBED_SNAPSHOT_VERSION = 1;

/** Une série/consigne prescrite pour un exercice, telle que figée. */
export interface SnapshotExercise {
  /** Identité STABLE de l'exercice (bibliothèque) — clé de la future « dernière performance ». */
  exerciseLibraryId: string | null;
  name: string;
  order: number;
  sets: number | null;
  reps: string | null;
  recommendedLoad: string | null;
  /**
   * RPE cible prescrit au moment de la séance ("8" ou "8-8-9") — ajout
   * ADDITIF (volet builder de feat/student-previous-set-performance) :
   * absent des snapshots antérieurs, jamais réécrit dans ceux-ci.
   */
  recommendedRpe?: string | null;
  restSeconds: number | null;
  tempo: string | null;
  notes: string | null;
}

export interface SnapshotBlock {
  title: string | null;
  category: string | null;
  position: number;
  exercises: SnapshotExercise[];
}

export interface PrescribedSnapshot {
  version: number;
  sessionId: string;
  sessionName: string;
  day: string | null;
  weekNumber: number | null;
  capturedAt: string;
  blocks: SnapshotBlock[];
}

/** Lignes minimales nécessaires — volontairement découplées des types Supabase générés. */
export interface SnapshotSessionRow {
  id: string;
  name: string | null;
  day: string | null;
  week_number?: number | null;
}

export interface SnapshotBlockRow {
  id: string;
  title: string | null;
  block_type?: string | null;
  position: number | null;
}

export interface SnapshotExerciseRow {
  block_id: string | null;
  exercise_library_id: string | null;
  name: string | null;
  order_index: number | null;
  sets: number | null;
  reps: string | null;
  recommended_load: string | null;
  recommended_rpe?: string | null;
  rest_seconds: number | null;
  tempo: string | null;
  notes: string | null;
}

/**
 * Construit la photographie du prescrit à partir des lignes réelles de la
 * séance. Déterministe : mêmes lignes → même snapshot (hors `capturedAt`,
 * injectable pour les tests).
 */
export function buildPrescribedSnapshot(
  session: SnapshotSessionRow,
  blocks: SnapshotBlockRow[],
  exercises: SnapshotExerciseRow[],
  capturedAt: string = new Date().toISOString(),
): PrescribedSnapshot {
  const parBloc = new Map<string, SnapshotExerciseRow[]>();
  for (const exercise of exercises) {
    if (!exercise.block_id) continue;
    const liste = parBloc.get(exercise.block_id) ?? [];
    liste.push(exercise);
    parBloc.set(exercise.block_id, liste);
  }

  const snapshotBlocks: SnapshotBlock[] = [...blocks]
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((block) => ({
      title: block.title ?? null,
      category: block.block_type ?? null,
      position: block.position ?? 0,
      exercises: (parBloc.get(block.id) ?? [])
        .slice()
        .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
        .map((exercise) => ({
          exerciseLibraryId: exercise.exercise_library_id ?? null,
          name: exercise.name ?? "",
          order: exercise.order_index ?? 0,
          sets: exercise.sets ?? null,
          reps: exercise.reps ?? null,
          recommendedLoad: exercise.recommended_load ?? null,
          recommendedRpe: exercise.recommended_rpe ?? null,
          restSeconds: exercise.rest_seconds ?? null,
          tempo: exercise.tempo ?? null,
          notes: exercise.notes ?? null,
        })),
    }));

  return {
    version: PRESCRIBED_SNAPSHOT_VERSION,
    sessionId: session.id,
    sessionName: session.name ?? "",
    day: session.day ?? null,
    weekNumber: session.week_number ?? null,
    capturedAt,
    blocks: snapshotBlocks,
  };
}

/**
 * Garde de forme : un JSONB relu depuis la base est-il un snapshot
 * exploitable ? Jamais d'exception — un contenu inattendu (autre version,
 * corruption) est traité comme « pas de snapshot », donc repli sur la séance
 * vivante, exactement le comportement des anciens retours.
 */
export function isPrescribedSnapshot(value: unknown): value is PrescribedSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidat = value as Record<string, unknown>;
  return (
    candidat.version === PRESCRIBED_SNAPSHOT_VERSION &&
    typeof candidat.sessionId === "string" &&
    typeof candidat.sessionName === "string" &&
    Array.isArray(candidat.blocks)
  );
}

export type PrescriptionSource = "snapshot" | "live" | "none";

export interface ResolvedPrescription {
  source: PrescriptionSource;
  /** Snapshot exploitable, ou null (ancien retour → l'appelant garde son rendu actuel). */
  snapshot: PrescribedSnapshot | null;
}

/**
 * Détermine la source de vérité du « prescrit » pour un récapitulatif :
 * - snapshot présent et valide → photographie figée (nouveaux retours) ;
 * - sinon → séance vivante (anciens retours, comportement historique
 *   conservé — cet historique ancien n'est PAS figé et peut refléter des
 *   modifications postérieures du builder, limitation documentée).
 */
export function resolvePrescription(rawSnapshot: unknown, hasLiveSession: boolean): ResolvedPrescription {
  if (isPrescribedSnapshot(rawSnapshot)) {
    return { source: "snapshot", snapshot: rawSnapshot };
  }
  return { source: hasLiveSession ? "live" : "none", snapshot: null };
}

/** Date de réalisation sûre : AAAA-MM-JJ valide, sinon la date du jour. */
export function sanitizePerformedAt(input: string | null | undefined, today: Date = new Date()): string {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const parsed = new Date(`${input}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) return input;
  }
  return today.toISOString().slice(0, 10);
}

/** Durée plausible en minutes (1 à 600), sinon null — jamais de valeur farfelue en base. */
export function sanitizeDurationMinutes(input: number | null | undefined): number | null {
  if (typeof input !== "number" || !Number.isFinite(input)) return null;
  const arrondi = Math.round(input);
  return arrondi >= 1 && arrondi <= 600 ? arrondi : null;
}
