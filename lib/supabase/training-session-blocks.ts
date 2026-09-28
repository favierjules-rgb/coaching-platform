import type { SupabaseClient } from "@supabase/supabase-js";

import {
  isLegacyStrengthBlockId,
  isUuid,
  makeLegacyStrengthBlockId,
  parseTrainingBlockId,
  parseTrainingExerciseId,
  toOrderedBlocks,
} from "@/lib/training-blocks";
import type { AdminWorkoutSession, DerivedSessionType, TrainingBlock } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Wrapper du moteur d'écriture canonique multi-blocs (chantier
 * feature/multi-block-training-sessions, Lot 3A).
 *
 * Rôle STRICT : valider + sérialiser le payload, faire UN SEUL appel
 * `supabase.rpc("save_training_session_blocks", …)`, puis convertir le
 * résultat. Il ne fait AUCUNE mutation `.insert()/.update()/.delete()` :
 * toute la sauvegarde multi-table est transactionnelle côté PostgreSQL (voir
 * supabase/migrations/20260721224252_save_training_session_blocks_rpc.sql).
 * C'est ce qui garantit l'atomicité — impossible côté client avec
 * supabase-js.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Métadonnées éditables d'une séance, appliquées ATOMIQUEMENT par la RPC dans
 * l'unique UPDATE final de `workout_sessions` (même transaction que les blocs).
 * Fourni par `updateProgram` pour une séance existante — ce qui supprime le
 * besoin d'un UPDATE préalable de la ligne (lequel neutraliserait le verrou
 * optimiste). Absent en création (la ligne vient d'être insérée avec ses
 * champs).
 */
export interface SessionPatch {
  day?: string;
  /**
   * Date réelle de la séance (`workout_sessions.scheduled_date`).
   *
   * ⚠️ ABSENTE DU PATCH = DATE INCHANGÉE, jamais effacée. La RPC ne touche la
   * colonne que si la clé est présente : un enregistrement de blocs ne peut pas
   * faire disparaître la date d'une séance déjà déplacée.
   */
  scheduledDate?: string | null;
  name?: string;
  muscleGroup?: string;
  durationMinutes?: number | null;
  warmup?: string;
  coachNotes?: string;
  bannerUrl?: string | null;
}

/**
 * PORTÉE D'UNE SAUVEGARDE — la garantie d'isolation entre catégories.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI ELLE EXISTE
 * ════════════════════════════════════════════════════════════════════════
 * `save_training_session_blocks` remplaçait TOUJOURS la séance entière :
 * mesuré sur PostgreSQL 16, un payload ne portant que le bloc cardio faisait
 * passer `workout_exercises` de 1 à 0. Un enregistrement cardio avait donc le
 * pouvoir IMPLICITE de supprimer la musculation, et seule la bonne tenue du
 * client l'en empêchait.
 *
 * Désormais la portée est DÉCLARÉE et le serveur l'applique :
 *   · `"all"` (défaut) — remplacement complet. C'est ce que fait le builder de
 *     séance, qui détient bien la séance entière, et rien ne change pour lui ;
 *   · `"cardio"` — seuls les blocs cardio sont créés, modifiés et supprimés ;
 *     la RPC REFUSE tout bloc `strength` et tout UUID qui n'est pas déjà un bloc
 *     cardio de la séance, ne construit aucune liste d'exercices à supprimer, et
 *     borne ses suppressions à `block_type = 'cardio'` ;
 *   · `"strength"` — l'exact symétrique.
 *
 * ⚠️ HORS `"all"`, LA POSITION DE CHAQUE BLOC EST OBLIGATOIRE. Le payload ne
 * porte qu'une catégorie : l'ordre complet de la séance n'en est pas déductible,
 * et le déduire de l'index du tableau écraserait l'entrelacement
 * musculation / cardio / musculation.
 *
 * ⚠️ RÉORDONNER À TRAVERS LES CATÉGORIES RESTE UN ENREGISTREMENT `"all"`. Glisser
 * un bloc cardio entre deux blocs de musculation change la position des deux
 * catégories : c'est la seule opération qui a légitimement besoin d'écrire les
 * deux, et elle doit le dire.
 */
export type SaveScope = "all" | "cardio" | "strength";

export interface SaveTrainingSessionBlocksInput {
  sessionId: string;
  /** Version attendue de la séance (optimistic lock). Obligatoire. */
  expectedUpdatedAt: string;
  /** Liste ORDONNÉE des blocs ; la position est dérivée de l'ordre du tableau. */
  blocks: TrainingBlock[];
  /** Portée de l'écriture — voir `SaveScope`. Absente = `"all"`. */
  scope?: SaveScope;
  /** Métadonnées de séance à écrire atomiquement (update d'une séance existante). */
  sessionPatch?: SessionPatch;
}

export interface SaveTrainingSessionBlocksResult {
  sessionId: string;
  /** Nouvelle version de la séance à réutiliser pour la prochaine sauvegarde. */
  updatedAt: string;
  /** Type global dérivé des blocs (peut valoir "rest" si aucun bloc). */
  sessionType: DerivedSessionType;
  /**
   * Blocs recomposés côté serveur (ids et positions réels), forme JSON brute.
   * La réconciliation fine du modèle client passe par `idMapping` ; ce champ
   * sert de résumé/vérification, pas de source à caster en TrainingBlock[].
   */
  blocks: unknown[];
  /** Date réelle de la séance après écriture (NULL = date calculée). */
  scheduledDate: string | null;
  /** Correspondance identifiants temporaires → UUID serveur réels. */
  idMapping: { blocks: Record<string, string>; exercises: Record<string, string> };
  warnings: { detachedExerciseFeedbackCount: number };
}

/** Sérialise un bloc du modèle canonique vers le JSON attendu par la RPC (snake_case). */
function serializeBlock(block: TrainingBlock): Record<string, unknown> {
  const base = {
    id: block.id,
    category: block.category,
    title: block.title,
    color_key: block.colorKey,
    /*
     * ⚠️ TOUJOURS ENVOYÉE, LUE SEULEMENT HORS PORTÉE « all ». En portée « all »
     * la RPC dérive la position de l'index du tableau (comportement historique
     * inchangé) et ignore cette clé ; hors « all » elle l'EXIGE. L'envoyer
     * systématiquement évite au client de savoir laquelle des deux règles
     * s'applique — une condition de plus qui se désynchroniserait.
     */
    position: block.position,
  };
  if (block.category === "strength") {
    return {
      ...base,
      exercises: block.exercises.map((ex) => ({
        id: ex.id,
        name: ex.name,
        sets: ex.sets,
        reps: ex.reps,
        rest_seconds: ex.restSeconds,
        tempo: ex.tempo,
        recommended_load: ex.recommendedLoad,
        // RPE cible — la RPC normalise "" en NULL (aucune prescription).
        recommended_rpe: ex.recommendedRpe ?? "",
        video_url: ex.videoUrl,
        notes: ex.notes,
        muscle_group: ex.muscleGroup ?? null,
        exercise_library_id: ex.libraryExerciseId ?? null,
      })),
    };
  }
  return {
    ...base,
    cardio_type: block.cardioType,
    machine_type: block.machineType ?? null,
    /*
     * ⚠️ `sport` ET `rounds` PARTENT MÊME AVANT LA MIGRATION, et c'est sans
     * danger : la RPC actuelle ne lit pas ces clés du payload, elle les ignore
     * simplement. Les retirer conditionnellement demanderait à l'application de
     * connaître l'état des migrations — un drapeau de version qui se périme.
     */
    sport: block.sport ?? null,
    rounds: block.rounds ?? null,
    prescriptions: block.prescriptions.map((seg) => ({
      segment_type: seg.segmentType,
      title: seg.title,
      repetitions: seg.repetitions ?? null,
      work_duration_seconds: seg.durationSeconds ?? null,
      distance_meters: seg.distanceMeters ?? null,
      elevation_gain_meters: seg.elevationGainMeters ?? null,
      incline_percentage: seg.inclinePercentage ?? null,
      recovery_duration_seconds: seg.recoveryDurationSeconds ?? null,
      recovery_distance_meters: seg.recoveryDistanceMeters ?? null,
      intensity_target_type: seg.intensityTargetType,
      target_vma_percentage: seg.targetVmaPercentage ?? null,
      target_speed_kmh: seg.targetSpeedKmh ?? null,
      target_pace_seconds_per_km: seg.targetPaceSecondsPerKm ?? null,
      target_hr_percentage: seg.targetHrPercentage ?? null,
      target_hr_zone: seg.targetHrZone ?? null,
      target_power_watts: seg.targetPowerWatts ?? null,
      target_cadence: seg.targetCadence ?? null,
      intensity_min: seg.intensityMin ?? null,
      intensity_max: seg.intensityMax ?? null,
      target_zone: seg.targetZone ?? null,
      target_power_percentage: seg.targetPowerPercentage ?? null,
      surface: seg.surface ?? null,
      terrain: seg.terrain ?? null,
      equipment_type: seg.equipmentType ?? null,
      coach_notes: seg.coachNotes ?? null,
    })),
  };
}

/**
 * Valide + sérialise le payload, puis fait UN SEUL appel RPC. Lève une erreur
 * claire en cas de payload invalide (id mal formé, doublon d'id temporaire,
 * `expectedUpdatedAt` manquant) AVANT tout appel réseau, ou propage l'erreur
 * métier de la RPC (STALE_TRAINING_SESSION, FOREIGN_BLOCK_ID, …).
 */
export async function saveTrainingSessionBlocks(
  supabase: TypedSupabaseClient,
  input: SaveTrainingSessionBlocksInput,
): Promise<SaveTrainingSessionBlocksResult> {
  const { sessionId, expectedUpdatedAt, blocks, sessionPatch } = input;
  const scope: SaveScope = input.scope ?? "all";

  if (!isUuid(sessionId)) {
    throw new Error(`saveTrainingSessionBlocks : sessionId invalide "${sessionId}".`);
  }
  if (!expectedUpdatedAt) {
    throw new Error("saveTrainingSessionBlocks : expectedUpdatedAt est obligatoire (optimistic lock).");
  }
  /*
   * ⚠️ LE REFUS EST DOUBLE, ET CE N'EST PAS DE LA REDONDANCE INUTILE. La RPC
   * refuse (`SCOPE_VIOLATION`) et c'est ELLE qui garantit ; ce contrôle-ci
   * échoue AVANT le réseau, avec un message qui nomme le bloc fautif — utile
   * quand un appelant se trompe de portée, et sans lequel le diagnostic serait
   * un code d'erreur PostgreSQL.
   */
  if (scope !== "all") {
    const horsPortee = blocks.find((block) => block.category !== scope);
    if (horsPortee) {
      throw new Error(
        `saveTrainingSessionBlocks : portée "${scope}" mais le payload contient un bloc "${horsPortee.category}" (${horsPortee.id}).`,
      );
    }
  }

  // Validation stricte des ids + unicité des ids temporaires, côté client,
  // avant l'appel réseau (la RPC revalide de toute façon).
  const seenBlockIds = new Set<string>();
  const seenExerciseIds = new Set<string>();
  for (const block of blocks) {
    parseTrainingBlockId(block.id, sessionId); // lève si format/​séance invalide
    if (seenBlockIds.has(block.id)) {
      throw new Error(`saveTrainingSessionBlocks : id de bloc en double dans le payload "${block.id}".`);
    }
    seenBlockIds.add(block.id);
    if (block.category === "strength") {
      for (const ex of block.exercises) {
        parseTrainingExerciseId(ex.id);
        if (seenExerciseIds.has(ex.id)) {
          throw new Error(`saveTrainingSessionBlocks : id d'exercice en double dans le payload "${ex.id}".`);
        }
        seenExerciseIds.add(ex.id);
      }
    }
  }

  const payload: Record<string, unknown> = {
    session_id: sessionId,
    expected_updated_at: expectedUpdatedAt,
    scope,
    blocks: blocks.map(serializeBlock),
  };
  if (sessionPatch) {
    payload.session_patch = {
      day: sessionPatch.day,
      name: sessionPatch.name,
      muscle_group: sessionPatch.muscleGroup,
      duration_minutes: sessionPatch.durationMinutes,
      warmup: sessionPatch.warmup,
      coach_notes: sessionPatch.coachNotes,
      banner_url: sessionPatch.bannerUrl,
    };
    // `undefined` est retiré par la sérialisation JSON : la clé n'existe donc
    // dans le payload QUE si l'appelant l'a explicitement fournie.
    if (sessionPatch.scheduledDate !== undefined) {
      (payload.session_patch as Record<string, unknown>).scheduled_date = sessionPatch.scheduledDate;
    }
  }

  // UN SEUL appel réseau de mutation. La RPC n'est pas déclarée dans les types
  // générés (`Functions: Record<string, never>`) — la typer là-bas perturbait
  // l'inférence de relations de supabase-js ailleurs. On type donc localement
  // ce seul appel, sans toucher aux types globaux.
  //
  // `.bind(supabase)` est OBLIGATOIRE : `SupabaseClient.rpc` est une méthode qui
  // s'appuie sur `this` (elle délègue à `this.rest`). L'extraire dans une
  // variable puis l'appeler « nue » (`const rpc = supabase.rpc; rpc(...)`)
  // détache `this` → `this.rest` devient `undefined` et lève
  // « Cannot read properties of undefined (reading 'rest') » AVANT tout réseau.
  // Le double appelant (create/update via ce wrapper) passe donc toujours par
  // une fonction correctement liée au client.
  const rpc = (
    supabase.rpc as unknown as (
      fn: "save_training_session_blocks",
      args: { p_payload: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
  const { data, error } = await rpc("save_training_session_blocks", { p_payload: payload });
  if (error) {
    throw new Error(`saveTrainingSessionBlocks : ${error.message}`);
  }

  return parseRpcResult(data);
}

/** Convertit et vérifie la forme du résultat JSON de la RPC. */
function parseRpcResult(data: unknown): SaveTrainingSessionBlocksResult {
  if (!data || typeof data !== "object") {
    throw new Error("saveTrainingSessionBlocks : résultat RPC vide ou invalide.");
  }
  const r = data as Record<string, unknown>;
  const idMapping = (r.id_mapping ?? {}) as Record<string, unknown>;
  const warnings = (r.warnings ?? {}) as Record<string, unknown>;
  const sessionType = r.session_type;
  if (sessionType !== "strength" && sessionType !== "cardio" && sessionType !== "mixed" && sessionType !== "rest") {
    throw new Error(`saveTrainingSessionBlocks : session_type inattendu "${String(sessionType)}".`);
  }
  return {
    sessionId: String(r.session_id),
    updatedAt: String(r.updated_at),
    sessionType,
    blocks: Array.isArray(r.blocks) ? r.blocks : [],
    scheduledDate: typeof r.scheduled_date === "string" ? r.scheduled_date : null,
    idMapping: {
      blocks: (idMapping.blocks ?? {}) as Record<string, string>,
      exercises: (idMapping.exercises ?? {}) as Record<string, string>,
    },
    warnings: {
      detachedExerciseFeedbackCount: Number(warnings.detached_exercise_feedback_count ?? 0),
    },
  };
}

/**
 * Adaptateur LEGACY → canonique (Lot 3B). Frontière de conversion EXPLICITE
 * entre le modèle historique du builder (`exercises[]` + `cardioBlocks[]`) et
 * le modèle canonique `blocks[]` consommé par la RPC.
 *
 * IGNORE délibérément `session.blocks` (le type d'entrée ne l'expose même pas) :
 * ce champ peut rester présent mais OBSOLÈTE — il est rempli par la lecture
 * Lot 2 et jamais réédité par le builder legacy, qui n'édite que
 * `exercises[]` / `cardioBlocks[]`. S'appuyer dessus ignorerait les
 * modifications du builder. La sélection de source n'est donc JAMAIS implicite.
 *
 * Normalisation stricte des ids (UUID réel conservé · bloc muscu →
 * `strengthBlockId` réel existant ou `legacy-strength:<sessionId>` · id client
 * `generateId` non-UUID → `new-block:` / `new-exercise:`). Préserve les ids
 * existants (feedback + blocs cardio) et ne convertit que le vraiment nouveau.
 * `expectedUpdatedAt` transmis en CHAÎNE exacte (jamais un Date JS).
 */
export function buildLegacySessionBlocksInput(args: {
  session: Pick<AdminWorkoutSession, "exercises" | "cardioBlocks">;
  sessionId: string;
  expectedUpdatedAt: string;
  /**
   * UUID réel du bloc musculation DÉJÀ persisté, s'il existe : le fournir met
   * ce bloc à jour en place (id conservé). Absent (création / pas de bloc
   * muscu) → id synthétique `legacy-strength:<sessionId>`.
   */
  strengthBlockId?: string;
  sessionPatch?: SessionPatch;
}): SaveTrainingSessionBlocksInput {
  const ordered = toOrderedBlocks(
    { id: args.sessionId, exercises: args.session.exercises, cardioBlocks: args.session.cardioBlocks },
    { strengthBlockId: args.strengthBlockId ?? makeLegacyStrengthBlockId(args.sessionId) },
  );
  return {
    sessionId: args.sessionId,
    expectedUpdatedAt: args.expectedUpdatedAt,
    blocks: ordered.map(normalizeBlockIds),
    sessionPatch: args.sessionPatch,
  };
}

/**
 * Adaptateur CANONIQUE — RÉSERVÉ AU LOT 4 (builder multi-blocs éditant
 * directement `blocks[]`). Ne jamais l'appeler depuis le câblage legacy
 * (create/update/duplicate) du Lot 3B : la source est ici explicitement
 * `blocks`, jamais dérivée de `exercises[]`/`cardioBlocks[]`.
 */
export function buildCanonicalSessionBlocksInput(args: {
  sessionId: string;
  expectedUpdatedAt: string;
  blocks: TrainingBlock[];
  sessionPatch?: SessionPatch;
  /** Portée de l'écriture — voir `SaveScope`. Absente = `"all"`. */
  scope?: SaveScope;
}): SaveTrainingSessionBlocksInput {
  return {
    sessionId: args.sessionId,
    expectedUpdatedAt: args.expectedUpdatedAt,
    blocks: args.blocks.map(normalizeBlockIds),
    sessionPatch: args.sessionPatch,
    scope: args.scope,
  };
}

function normalizeBlockId(id: string): string {
  if (isUuid(id) || isLegacyStrengthBlockId(id) || id.startsWith("new-block:")) return id;
  return `new-block:${crypto.randomUUID()}`;
}

function normalizeExerciseId(id: string): string {
  if (isUuid(id) || id.startsWith("new-exercise:")) return id;
  return `new-exercise:${crypto.randomUUID()}`;
}

function normalizeBlockIds(block: TrainingBlock): TrainingBlock {
  if (block.category === "strength") {
    return {
      ...block,
      id: normalizeBlockId(block.id),
      exercises: block.exercises.map((ex) => ({ ...ex, id: normalizeExerciseId(ex.id) })),
    };
  }
  return { ...block, id: normalizeBlockId(block.id) };
}
