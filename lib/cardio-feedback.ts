import { formatDistanceMeters, formatDurationSeconds } from "@/lib/cardio";
import type { AdminExerciseFeedbackEntry, ExerciseFeedbackPayload } from "@/types";
import type { StudentSessionBlockView } from "@/lib/student-session-blocks";

/**
 * Retour élève des séances CARDIO (course, vélo, etc.) — logique pure.
 *
 * Décision de modèle (25/07/2026) : AUCUNE migration. Les réalisations
 * cardio (durée, distance, D+) sont enregistrées via les tables existantes
 * `exercise_feedback` / `exercise_set_feedback`, dont les champs
 * `load_used` / `reps_done` sont déjà du texte libre : une entrée réservée,
 * nommée `CARDIO_RESULT_ENTRY_NAME`, porte une série n°1 avec
 * loadUsed = durée réalisée formatée et repsDone = distance réalisée
 * formatée (+ série n°2 optionnelle pour le D+). Le calcul de tonnage
 * musculation (lib/training-metrics.ts) n'apparie les entrées QUE par nom
 * d'exercice prescrit : cette entrée réservée n'y correspond jamais et ne
 * pollue donc aucun total.
 *
 * Testé dans scripts/tests/cardio-feedback.mts.
 */

export const CARDIO_RESULT_ENTRY_NAME = "Cardio · Résultats";

export function isCardioResultEntryName(name: string): boolean {
  return name.trim() === CARDIO_RESULT_ENTRY_NAME;
}

/* ─── Saisie ──────────────────────────────────────────────────────────── */

/**
 * Nombre décimal saisi à la française OU à l'anglaise ("3,3" et "3.3" →
 * 3.3). Retourne null pour : vide, non numérique, négatif, non fini.
 */
export function parseFlexibleDecimal(raw: string): number | null {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

/** Entier positif ("12" → 12) ; null pour vide/invalide/négatif. */
export function parseNonNegativeInt(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * Durée réalisée en secondes depuis trois champs h / min / s (chacun peut
 * rester vide — l'élève ne convertit jamais lui-même en secondes).
 * Retourne { seconds } ou { error } si une valeur est invalide (négative,
 * non entière, minutes/secondes ≥ 60) ; { seconds: null } si tout est vide.
 */
export function durationFromParts(
  hoursRaw: string,
  minutesRaw: string,
  secondsRaw: string,
): { seconds: number | null; error: string | null } {
  const allEmpty = hoursRaw.trim() === "" && minutesRaw.trim() === "" && secondsRaw.trim() === "";
  if (allEmpty) return { seconds: null, error: null };
  const hours = hoursRaw.trim() === "" ? 0 : parseNonNegativeInt(hoursRaw);
  const minutes = minutesRaw.trim() === "" ? 0 : parseNonNegativeInt(minutesRaw);
  const seconds = secondsRaw.trim() === "" ? 0 : parseNonNegativeInt(secondsRaw);
  if (hours === null || minutes === null || seconds === null) {
    return { seconds: null, error: "Durée invalide : utilise des nombres entiers positifs." };
  }
  if (minutes > 59 || seconds > 59) {
    return { seconds: null, error: "Minutes et secondes doivent être entre 0 et 59." };
  }
  const total = hours * 3600 + minutes * 60 + seconds;
  if (total === 0) return { seconds: null, error: null };
  return { seconds: total, error: null };
}

/** Distance réalisée : texte ("3,3" / "3.3" / "10") → mètres ; null si vide ; error si invalide. */
export function distanceMetersFromKmInput(raw: string): { meters: number | null; error: string | null } {
  if (raw.trim() === "") return { meters: null, error: null };
  const km = parseFlexibleDecimal(raw);
  if (km === null) return { meters: null, error: "Distance invalide : ex. 3,3 ou 3.3 (en km)." };
  if (km > 1000) return { meters: null, error: "Distance invraisemblable (max 1000 km)." };
  return { meters: Math.round(km * 1000), error: null };
}

/* ─── Repères prescrits ───────────────────────────────────────────────── */

export interface CardioPrescribedTotals {
  durationSeconds: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
}

/**
 * Totaux prescrits des blocs cardio d'une séance, servant de repère à côté
 * des champs de saisie. Un `repeat_group` compte (effort + récupération) ×
 * répétitions. Un total vaut null si aucun segment ne le renseigne.
 */
export function cardioPrescribedTotals(blocks: StudentSessionBlockView[]): CardioPrescribedTotals {
  let duration = 0;
  let distance = 0;
  let elevation = 0;
  let hasDuration = false;
  let hasDistance = false;
  let hasElevation = false;

  for (const block of blocks) {
    if (block.kind !== "cardio") continue;
    for (const segment of block.segments) {
      const reps = segment.segmentType === "repeat_group" ? Math.max(1, segment.repetitions ?? 1) : 1;
      if (segment.durationSeconds) {
        duration += segment.durationSeconds * reps;
        hasDuration = true;
      }
      if (segment.segmentType === "repeat_group" && segment.recoveryDurationSeconds) {
        duration += segment.recoveryDurationSeconds * reps;
        hasDuration = true;
      }
      if (segment.distanceMeters) {
        distance += segment.distanceMeters * reps;
        hasDistance = true;
      }
      if (segment.segmentType === "repeat_group" && segment.recoveryDistanceMeters) {
        distance += segment.recoveryDistanceMeters * reps;
        hasDistance = true;
      }
      if (segment.elevationGainMeters) {
        elevation += segment.elevationGainMeters * reps;
        hasElevation = true;
      }
    }
  }

  return {
    durationSeconds: hasDuration ? duration : null,
    distanceMeters: hasDistance ? distance : null,
    elevationGainMeters: hasElevation ? elevation : null,
  };
}

/* ─── Construction de l'entrée enregistrée ────────────────────────────── */

export interface CardioRealizedInput {
  durationSeconds: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
}

/**
 * Entrée `exercise_feedback` réservée aux résultats cardio, au format
 * payload de saveWorkoutFeedback. Retourne null si RIEN n'est renseigné
 * (aucune ligne parasite en base).
 */
export function buildCardioResultPayload(realized: CardioRealizedInput): ExerciseFeedbackPayload | null {
  const sets: ExerciseFeedbackPayload["sets"] = [];
  if (realized.durationSeconds !== null || realized.distanceMeters !== null) {
    sets.push({
      setNumber: 1,
      loadUsed: realized.durationSeconds !== null ? `Durée ${formatDurationSeconds(realized.durationSeconds)}` : "",
      repsDone: realized.distanceMeters !== null ? `Distance ${formatDistanceMeters(realized.distanceMeters)}` : "",
    });
  }
  if (realized.elevationGainMeters !== null) {
    sets.push({ setNumber: 2, loadUsed: `D+ ${realized.elevationGainMeters} m`, repsDone: "" });
  }
  if (sets.length === 0) return null;
  return {
    exerciseName: CARDIO_RESULT_ENTRY_NAME,
    // Après tous les exercices de musculation éventuels de la séance.
    exerciseOrder: 999,
    rpe: null,
    comment: "",
    sets,
  };
}

/* ─── Lecture (récap élève + détail admin) ────────────────────────────── */

export interface CardioRealizedSummary {
  durationLabel: string | null;
  distanceLabel: string | null;
  elevationLabel: string | null;
}

/**
 * Relit les résultats cardio depuis les entrées d'un retour enregistré
 * (formats produits par buildCardioResultPayload). Retourne null si le
 * retour ne contient pas d'entrée cardio.
 */
export function readCardioRealizedSummary(
  entries: Pick<AdminExerciseFeedbackEntry, "exerciseName" | "setNumber" | "loadUsed" | "repsDone">[],
): CardioRealizedSummary | null {
  const cardioEntries = entries.filter((entry) => isCardioResultEntryName(entry.exerciseName));
  if (cardioEntries.length === 0) return null;
  let durationLabel: string | null = null;
  let distanceLabel: string | null = null;
  let elevationLabel: string | null = null;
  for (const entry of cardioEntries) {
    if (entry.setNumber === 1) {
      if (entry.loadUsed.startsWith("Durée ")) durationLabel = entry.loadUsed.slice("Durée ".length);
      if (entry.repsDone.startsWith("Distance ")) distanceLabel = entry.repsDone.slice("Distance ".length);
    }
    if (entry.setNumber === 2 && entry.loadUsed.startsWith("D+ ")) {
      elevationLabel = entry.loadUsed.slice("D+ ".length);
    }
  }
  return { durationLabel, distanceLabel, elevationLabel };
}

/* ─── Retour BLOC PAR BLOC (format v2, 25/07/2026) ────────────────────── */

/**
 * Un retour par bloc cardio, identifié par le **blockId stable** (UUID du
 * bloc `training_blocks` pour les séances Supabase, id du bloc legacy
 * sinon) — jamais par le titre ni par l'index d'affichage : deux blocs
 * peuvent partager le même titre (« Effort continu »).
 *
 * Stockage transitoire SANS migration : une ligne `exercise_feedback` par
 * bloc, `exercise_name` = marqueur réservé (jamais affiché), `rpe` dans la
 * colonne rpe, et le reste dans une **enveloppe JSON versionnée** portée par
 * la colonne `comment` (parsing/sérialisation centralisés ici et testés).
 * Une ligne `exercise_set_feedback` (série n°1) porte un résumé lisible pour
 * l'inspection brute en base. L'unicité par élève+séance+bloc est garantie
 * par saveWorkoutFeedback : upsert du retour par (student_id, session_key)
 * puis REMPLACEMENT COMPLET des entrées — une seconde sauvegarde modifie,
 * ne duplique jamais, et ne touche pas aux autres blocs (tous re-sérialisés
 * depuis les brouillons locaux).
 *
 * Les valeurs PRESCRITES du bloc sont photographiées dans l'enveloppe au
 * moment de l'envoi : l'admin peut afficher « prévu vs réalisé » sans
 * recharger le programme (et le retour reste exact si le bloc est modifié
 * ou supprimé ensuite dans l'éditeur — aucun rattachement silencieux).
 */

export const CARDIO_BLOCK_RESULT_VERSION = 2 as const;

export interface CardioBlockPrescribedSnapshot {
  durationSeconds: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  /** Répétitions prescrites (somme des repeat_group), null si aucun intervalle. */
  repetitions: number | null;
}

export interface CardioBlockRealizedInput {
  completed: boolean;
  durationSeconds: number | null;
  distanceMeters: number | null;
  elevationGainMeters: number | null;
  /** Répétitions réellement terminées (blocs à intervalles uniquement). */
  repetitionsDone: number | null;
  rpe: number | null;
  pain: string;
  comment: string;
}

export interface CardioBlockResult extends CardioBlockRealizedInput {
  version: typeof CARDIO_BLOCK_RESULT_VERSION;
  blockId: string;
  /** Position du bloc dans la séance au moment de l'envoi (tri d'affichage). */
  order: number;
  /** Titre du bloc au moment de l'envoi (affichage uniquement — jamais une identité). */
  title: string;
  prescribed: CardioBlockPrescribedSnapshot;
}

/**
 * Snapshot prescrit d'UN bloc — SOURCE UNIQUE des repères affichés sous le
 * bloc ET du snapshot sérialisé dans le retour : les deux ne peuvent pas
 * diverger, et chaque bloc (même homonyme) a son propre objet, dérivé de SES
 * segments uniquement.
 */
export function cardioBlockPrescribedSnapshot(block: StudentSessionBlockView): CardioBlockPrescribedSnapshot {
  const totals = cardioPrescribedTotals([block]);
  return {
    durationSeconds: totals.durationSeconds,
    distanceMeters: totals.distanceMeters,
    elevationGainMeters: totals.elevationGainMeters,
    repetitions: prescribedRepetitions(block),
  };
}

/** Répétitions prescrites d'un bloc (somme des repeat_group), null si aucune. */
export function prescribedRepetitions(block: StudentSessionBlockView): number | null {
  if (block.kind !== "cardio") return null;
  let total = 0;
  let has = false;
  for (const segment of block.segments) {
    if (segment.segmentType === "repeat_group" && segment.repetitions) {
      total += segment.repetitions;
      has = true;
    }
  }
  return has ? total : null;
}

/** Brouillon de saisie d'un bloc (valeurs brutes des champs contrôlés). */
export interface CardioBlockDraft {
  completed: boolean;
  hours: string;
  minutes: string;
  seconds: string;
  distanceKm: string;
  elevation: string;
  repetitionsDone: string;
  rpe: string;
  painLevel: PainLevel;
  painDetail: string;
  comment: string;
}

export function emptyCardioBlockDraft(): CardioBlockDraft {
  return {
    completed: false,
    hours: "",
    minutes: "",
    seconds: "",
    distanceKm: "",
    elevation: "",
    repetitionsDone: "",
    rpe: "",
    painLevel: "aucune",
    painDetail: "",
    comment: "",
  };
}

/** Brouillon pré-rempli depuis un retour v2 enregistré (modification). */
export function draftFromBlockResult(result: CardioBlockResult): CardioBlockDraft {
  const seconds = result.durationSeconds;
  return {
    completed: result.completed,
    hours: seconds !== null && seconds >= 3600 ? String(Math.floor(seconds / 3600)) : "",
    minutes: seconds !== null ? String(Math.floor((seconds % 3600) / 60)) : "",
    seconds: seconds !== null && seconds % 60 !== 0 ? String(seconds % 60) : "",
    distanceKm: result.distanceMeters !== null ? String(result.distanceMeters / 1000).replace(".", ",") : "",
    elevation: result.elevationGainMeters !== null ? String(result.elevationGainMeters) : "",
    repetitionsDone: result.repetitionsDone !== null ? String(result.repetitionsDone) : "",
    rpe: result.rpe !== null ? String(result.rpe) : "",
    painLevel: result.pain.startsWith("Gêne importante")
      ? "importante"
      : result.pain.startsWith("Gêne modérée")
        ? "modérée"
        : result.pain.startsWith("Gêne légère")
          ? "légère"
          : "aucune",
    painDetail: result.pain.includes(" — ") ? result.pain.slice(result.pain.indexOf(" — ") + 3) : "",
    comment: result.comment,
  };
}

/**
 * Convertit et valide le brouillon d'un bloc. Retourne { error } avec un
 * message rattachable AU bloc concerné, ou { realized } prêt à sérialiser.
 */
export function realizedFromDraft(
  draft: CardioBlockDraft,
): { realized: CardioBlockRealizedInput; error: null } | { realized: null; error: string } {
  const duration = durationFromParts(draft.hours, draft.minutes, draft.seconds);
  if (duration.error) return { realized: null, error: duration.error };
  const distance = distanceMetersFromKmInput(draft.distanceKm);
  if (distance.error) return { realized: null, error: distance.error };
  let elevation: number | null = null;
  if (draft.elevation.trim() !== "") {
    elevation = parseNonNegativeInt(draft.elevation);
    if (elevation === null) return { realized: null, error: "Dénivelé invalide : nombre entier de mètres attendu." };
  }
  let repetitionsDone: number | null = null;
  if (draft.repetitionsDone.trim() !== "") {
    repetitionsDone = parseNonNegativeInt(draft.repetitionsDone);
    if (repetitionsDone === null) return { realized: null, error: "Répétitions invalides : nombre entier attendu." };
  }
  return {
    realized: {
      completed: draft.completed,
      durationSeconds: duration.seconds,
      distanceMeters: distance.meters,
      elevationGainMeters: elevation,
      repetitionsDone,
      rpe: draft.rpe === "" ? null : Number(draft.rpe),
      pain: composePainText(draft.painLevel, draft.painDetail),
      comment: draft.comment.trim(),
    },
    error: null,
  };
}

/** Un retour de bloc est-il vide (rien à enregistrer pour ce bloc) ? */
export function isBlockResultEmpty(input: CardioBlockRealizedInput): boolean {
  return (
    !input.completed &&
    input.durationSeconds === null &&
    input.distanceMeters === null &&
    input.elevationGainMeters === null &&
    input.repetitionsDone === null &&
    input.rpe === null &&
    input.pain.trim() === "" &&
    input.comment.trim() === ""
  );
}

function readableSummary(result: CardioBlockResult): { loadUsed: string; repsDone: string } {
  const parts: string[] = [];
  if (result.durationSeconds !== null) parts.push(`Durée ${formatDurationSeconds(result.durationSeconds)}`);
  if (result.elevationGainMeters !== null) parts.push(`D+ ${result.elevationGainMeters} m`);
  const reps: string[] = [];
  if (result.distanceMeters !== null) reps.push(`Distance ${formatDistanceMeters(result.distanceMeters)}`);
  if (result.repetitionsDone !== null) reps.push(`${result.repetitionsDone} rép. terminées`);
  return { loadUsed: parts.join(" · "), repsDone: reps.join(" · ") };
}

/**
 * Sérialise le retour d'UN bloc vers une entrée exercise_feedback.
 * `exerciseOrder` = 900 + position pour rester après tous les exercices de
 * musculation éventuels de la séance.
 */
export function serializeCardioBlockResult(result: CardioBlockResult): ExerciseFeedbackPayload {
  const summary = readableSummary(result);
  return {
    exerciseName: CARDIO_RESULT_ENTRY_NAME,
    exerciseOrder: 900 + result.order,
    rpe: result.rpe,
    comment: JSON.stringify(result),
    sets: [{ setNumber: 1, loadUsed: summary.loadUsed, repsDone: summary.repsDone }],
  };
}

function isCardioBlockResult(value: unknown): value is CardioBlockResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.version === CARDIO_BLOCK_RESULT_VERSION &&
    typeof candidate.blockId === "string" &&
    typeof candidate.order === "number" &&
    typeof candidate.title === "string" &&
    typeof candidate.completed === "boolean" &&
    typeof candidate.prescribed === "object" &&
    candidate.prescribed !== null
  );
}

export interface ParsedCardioResults {
  /** Retours par bloc (format v2), triés par ordre de séance, dédupliqués par blockId. */
  blocks: CardioBlockResult[];
  /** Retour global historique (format v1, sans blockId) — jamais rattaché à un bloc. */
  legacy: CardioRealizedSummary | null;
}

/**
 * Relit tous les retours cardio d'un feedback : entrées v2 (JSON versionné)
 * ET anciennes entrées v1 globales (compatibilité — présentées comme
 * « retour global historique », jamais attribuées à un bloc arbitraire).
 */
export function parseCardioResults(
  entries: Pick<AdminExerciseFeedbackEntry, "exerciseName" | "setNumber" | "loadUsed" | "repsDone" | "comment" | "rpe">[],
): ParsedCardioResults {
  const cardioEntries = entries.filter((entry) => isCardioResultEntryName(entry.exerciseName));
  const byBlockId = new Map<string, CardioBlockResult>();
  const legacyEntries: typeof cardioEntries = [];

  for (const entry of cardioEntries) {
    let parsed: unknown = null;
    if (entry.comment && entry.comment.trimStart().startsWith("{")) {
      try {
        parsed = JSON.parse(entry.comment);
      } catch {
        parsed = null;
      }
    }
    if (isCardioBlockResult(parsed)) {
      // Une seule réalisation par bloc : les lignes multiples (une par série)
      // portent la même enveloppe — la première gagne, jamais de doublon.
      if (!byBlockId.has(parsed.blockId)) byBlockId.set(parsed.blockId, parsed);
    } else {
      legacyEntries.push(entry);
    }
  }

  return {
    blocks: [...byBlockId.values()].sort((a, b) => a.order - b.order),
    legacy: legacyEntries.length > 0 ? readCardioRealizedSummary(legacyEntries) : null,
  };
}

/**
 * Description LISIBLE d'un résultat de bloc cardio pour l'historique élève
 * (fix : le JSON sérialisé de l'enveloppe apparaissait brut à l'écran).
 * Ne rend JAMAIS l'enveloppe : uniquement titre, durée, distance, dénivelé,
 * répétitions, RPE et le commentaire RÉEL de l'élève.
 */
export function describeCardioBlockResult(result: CardioBlockResult): { title: string; details: string; comment: string } {
  const parts: string[] = [];
  if (result.durationSeconds !== null) parts.push(`Durée ${formatDurationSeconds(result.durationSeconds)}`);
  if (result.distanceMeters !== null) parts.push(`Distance ${formatDistanceMeters(result.distanceMeters)}`);
  if (result.elevationGainMeters !== null) parts.push(`D+ ${result.elevationGainMeters} m`);
  if (result.repetitionsDone !== null) {
    parts.push(`${result.repetitionsDone} répétition${result.repetitionsDone > 1 ? "s" : ""}`);
  }
  if (result.rpe !== null) parts.push(`RPE ${result.rpe}`);
  return {
    title: result.title.trim() || "Bloc cardio",
    details: parts.join(" · "),
    comment: result.comment.trim(),
  };
}

/* ─── Douleur / gêne structurée ───────────────────────────────────────── */

export const PAIN_LEVELS = ["aucune", "légère", "modérée", "importante"] as const;
export type PainLevel = (typeof PAIN_LEVELS)[number];

/**
 * Champ `pain` (texte libre existant) composé depuis le niveau choisi et le
 * détail optionnel : "" si aucune ; "Gêne légère" ; "Gêne modérée — mollet
 * droit". Aucun diagnostic, simple restitution de la saisie.
 */
export function composePainText(level: PainLevel, detail: string): string {
  if (level === "aucune") return "";
  const base = `Gêne ${level}`;
  const trimmed = detail.trim();
  return trimmed ? `${base} — ${trimmed}` : base;
}
