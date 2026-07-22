import type { SupabaseClient } from "@supabase/supabase-js";

import { isUuid, parseTrainingBlockId, parseTrainingExerciseId } from "@/lib/training-blocks";
import type { DerivedSessionType, TrainingBlock } from "@/types";
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

export interface SaveTrainingSessionBlocksInput {
  sessionId: string;
  /** Version attendue de la séance (optimistic lock). Obligatoire. */
  expectedUpdatedAt: string;
  /** Liste ORDONNÉE des blocs ; la position est dérivée de l'ordre du tableau. */
  blocks: TrainingBlock[];
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
  const { sessionId, expectedUpdatedAt, blocks } = input;

  if (!isUuid(sessionId)) {
    throw new Error(`saveTrainingSessionBlocks : sessionId invalide "${sessionId}".`);
  }
  if (!expectedUpdatedAt) {
    throw new Error("saveTrainingSessionBlocks : expectedUpdatedAt est obligatoire (optimistic lock).");
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

  const payload = {
    session_id: sessionId,
    expected_updated_at: expectedUpdatedAt,
    blocks: blocks.map(serializeBlock),
  };

  // UN SEUL appel réseau de mutation. La RPC n'est pas déclarée dans les types
  // générés (`Functions: Record<string, never>`) — la typer là-bas perturbait
  // l'inférence de relations de supabase-js ailleurs. On type donc localement
  // ce seul appel, sans toucher aux types globaux.
  const rpc = supabase.rpc as unknown as (
    fn: "save_training_session_blocks",
    args: { p_payload: Record<string, unknown> },
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
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
    idMapping: {
      blocks: (idMapping.blocks ?? {}) as Record<string, string>,
      exercises: (idMapping.exercises ?? {}) as Record<string, string>,
    },
    warnings: {
      detachedExerciseFeedbackCount: Number(warnings.detached_exercise_feedback_count ?? 0),
    },
  };
}
