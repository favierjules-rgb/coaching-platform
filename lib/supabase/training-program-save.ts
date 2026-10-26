import type { SupabaseClient } from "@supabase/supabase-js";

import type { DiffDeProgrammation } from "@/lib/program-diff";
import { serializeBlockPourRpc } from "@/lib/supabase/training-session-blocks";
import type { Database } from "@/types/supabase";

/**
 * L'APPEL UNIQUE — toute la programmation en un aller-retour.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * RÔLE STRICT
 * ════════════════════════════════════════════════════════════════════════════
 * Sérialiser le diff, faire UN SEUL `supabase.rpc("save_training_program_sessions")`,
 * convertir le résultat. Ce module ne fait AUCUNE mutation `.insert()`,
 * `.update()` ou `.delete()` : toute l'écriture multi-table est
 * transactionnelle côté PostgreSQL (migration 20261027090000). C'est ce qui
 * garantit l'atomicité — impossible à obtenir côté client avec supabase-js, où
 * chaque requête est sa propre transaction.
 *
 * ⚠️ LE SUCCÈS N'EST DÉCLARÉ QU'APRÈS LE COMMIT. La fonction plpgsql s'exécute
 * dans la transaction de PostgREST : sa réponse n'arrive qu'une fois le COMMIT
 * effectué. Un `data` non nul vaut donc « tout est écrit », et une `error` vaut
 * « RIEN n'est écrit ». Il n'existe plus d'état intermédiaire où la tête et
 * quarante séances seraient commises tandis que les autres auraient échoué —
 * c'était le défaut de l'ancien chemin, qui émettait 87 à 100 requêtes
 * indépendantes.
 *
 * ⚠️ LA SÉRIALISATION DES BLOCS EST CELLE DU MOTEUR, pas une seconde.
 * `serializeBlockPourRpc` est la fonction qu'utilise déjà
 * `saveTrainingSessionBlocks` : la charge que reçoit la RPC groupée est au
 * mot près celle que recevait la RPC par séance. Deux sérialisations auraient
 * divergé au premier champ ajouté.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** Erreurs métier que la RPC groupée peut rendre, toutes identifiables. */
export type CauseEchecGroupe =
  | "non_autorise"
  | "programme_introuvable"
  | "tete_perimee"
  | "tete_non_ecrivable"
  | "seance_perimee"
  | "charge_invalide"
  | "semaine_refusee"
  | "seance_refusee"
  | "delai_depasse"
  | "inconnue";

export interface EchecGroupe {
  cause: CauseEchecGroupe;
  /** Le message brut du serveur — conservé pour le diagnostic, jamais affiché tel quel. */
  message: string;
  /** La séance fautive quand le serveur l'a nommée (préfixe `SESSION_FAILED <clé>:`). */
  seance: string | null;
}

export class EchecEnregistrementGroupe extends Error {
  readonly cause: CauseEchecGroupe;
  readonly seance: string | null;
  constructor(echec: EchecGroupe) {
    super(echec.message);
    this.name = "EchecEnregistrementGroupe";
    this.cause = echec.cause;
    this.seance = echec.seance;
  }
}

export interface SeanceEnregistree {
  /** Identifiant local du builder pour une séance créée ; absent sinon. */
  clientId: string | null;
  sessionId: string;
  /** Nouvelle version, à réutiliser comme verrou au prochain enregistrement. */
  updatedAt: string;
  sessionType: string;
  created: boolean;
  /**
   * Correspondance identifiants temporaires → UUID serveur réels.
   *
   * ⚠️ PERSONNE NE LA CONSOMME AUJOURD'HUI, et il faut le savoir pour ne pas
   * s'y fier. La réconciliation du builder se fait par RELECTURE : sur un
   * succès, la page remplace son instantané et incrémente `builderRevision`,
   * ce qui change la `key` du builder et le réinitialise depuis les données
   * fraîches — donc avec les identifiants réels. Cette correspondance est
   * conservée parce qu'elle est la seule information que la relecture ne donne
   * pas : quel identifiant temporaire est devenu quel UUID.
   *
   * `prescriptions` est optionnel : la clé n'existe qu'avec la migration
   * 20261029090000.
   */
  idMapping: {
    blocks: Record<string, string>;
    exercises: Record<string, string>;
    prescriptions?: Record<string, string>;
  };
  detachedExerciseFeedbackCount: number;
}

export interface ResultatEnregistrementGroupe {
  programId: string;
  programUpdatedAt: string;
  /** numéro de semaine → UUID, pour les semaines créées par cet appel. */
  weeks: Record<string, string>;
  weekCount: number;
  sessions: SeanceEnregistree[];
  sessionCount: number;
}

export interface PatchDeProgramme {
  name?: string;
  goal?: string;
  level?: string;
  duration_weeks?: number;
  description?: string;
  status?: string;
  banner_url?: string | null;
  program_mode?: string;
  group_start_date?: string | null;
  is_public?: boolean;
  public_subscription_template_id?: string | null;
}

export interface EntreeEnregistrementGroupe {
  programId: string;
  /** Verrou optimiste de tête. Absent = aucun contrôle (repli, non recommandé). */
  expectedProgramUpdatedAt?: string | null;
  programPatch?: PatchDeProgramme;
  diff: DiffDeProgrammation;
}

/**
 * Classe l'erreur serveur en cause EXPLOITABLE.
 *
 * ⚠️ L'ORDRE DES TESTS COMPTE. `SESSION_FAILED <clé>: STALE_TRAINING_SESSION`
 * contient les deux motifs : on cherche d'abord la cause PRÉCISE portée par le
 * suffixe, et seulement ensuite les codes d'enveloppe. Tester
 * `SESSION_FAILED` en premier aurait écrasé un conflit optimiste — que le
 * coach peut résoudre en rechargeant — sous un « séance refusée » générique,
 * qui ne lui dit pas quoi faire.
 */
export function classerEchecGroupe(message: string): EchecGroupe {
  const seance = extraireSeance(message);
  const cause: CauseEchecGroupe =
    message.includes("STALE_TRAINING_SESSION") ? "seance_perimee"
    : message.includes("STALE_TRAINING_PROGRAM") ? "tete_perimee"
    : message.includes("PROGRAM_HEAD_NOT_WRITABLE") ? "tete_non_ecrivable"
    : message.includes("PROGRAM_NOT_FOUND_OR_FORBIDDEN") ? "programme_introuvable"
    : message.includes("NOT_AUTHORIZED") || message.includes("42501") ? "non_autorise"
    : message.includes("INVALID_PAYLOAD") || message.includes("INVALID_SESSION_PATCH") ? "charge_invalide"
    : message.includes("WEEK_INSERT_FAILED") || message.includes("WEEK_MISSING") ? "semaine_refusee"
    // `57014` = canceling statement due to statement timeout. Il doit avoir son
    // propre nom : le confondre avec un refus de droits enverrait le coach
    // vérifier ses autorisations alors que l'opération était seulement trop longue.
    : message.includes("57014") || message.toLowerCase().includes("statement timeout") ? "delai_depasse"
    : message.includes("SESSION_FAILED") || message.includes("SESSION_INSERT_FAILED")
      || message.includes("FOREIGN_BLOCK_ID") || message.includes("FOREIGN_EXERCISE_ID") ? "seance_refusee"
    : "inconnue";
  return { cause, message, seance };
}

function extraireSeance(message: string): string | null {
  const m = /SESSION_(?:FAILED|INSERT_FAILED):?\s*([^\s:]+)/.exec(message);
  return m ? m[1] : null;
}

/**
 * Émet l'appel groupé. Lève `EchecEnregistrementGroupe` sur refus métier —
 * jamais `false`, qui ne dirait pas POURQUOI.
 */
export async function saveTrainingProgramSessions(
  supabase: TypedSupabaseClient,
  entree: EntreeEnregistrementGroupe,
): Promise<ResultatEnregistrementGroupe> {
  const { diff } = entree;

  const payload: Record<string, unknown> = {
    program_id: entree.programId,
    weeks_to_create: diff.semainesACreer,
    weeks_to_delete: diff.semainesASupprimer,
    sessions_to_delete: diff.sessionIdsASupprimer,
    sessions_to_create: diff.seancesACreer.map((s) => ({
      client_id: s.clientId,
      week_number: s.weekNumber,
      day: s.day,
      name: s.name,
      muscle_group: s.muscleGroup,
      duration_minutes: s.durationMinutes,
      warmup: s.warmup,
      coach_notes: s.coachNotes,
      session_type: s.sessionType,
      banner_url: s.bannerUrl,
      is_rest_day: s.isRestDay,
      blocks: s.blocks.map(serializeBlockPourRpc),
    })),
    sessions_to_update: diff.seancesAModifier.map((s) => ({
      session_id: s.sessionId,
      expected_updated_at: s.expectedUpdatedAt,
      blocks: s.blocks.map(serializeBlockPourRpc),
      session_patch: {
        day: s.sessionPatch.day,
        name: s.sessionPatch.name,
        muscle_group: s.sessionPatch.muscleGroup,
        duration_minutes: s.sessionPatch.durationMinutes,
        warmup: s.sessionPatch.warmup,
        coach_notes: s.sessionPatch.coachNotes,
        banner_url: s.sessionPatch.bannerUrl,
      },
    })),
  };
  if (entree.programPatch && Object.keys(entree.programPatch).length > 0) {
    payload.program_patch = entree.programPatch;
  }
  // ⚠️ ENVOYÉ SEULEMENT S'IL EXISTE. Une clé présente valant `null` ferait
  // échouer le contrôle côté serveur au lieu de le désactiver.
  if (entree.expectedProgramUpdatedAt) {
    payload.expected_program_updated_at = entree.expectedProgramUpdatedAt;
  }

  /*
   * ⚠️ `.bind(supabase)` EST OBLIGATOIRE, et le même piège que dans
   * `saveTrainingSessionBlocks`. `SupabaseClient.rpc` s'appuie sur `this`
   * (elle délègue à `this.rest`) : l'extraire dans une variable puis l'appeler
   * « nue » détache `this`, et la méthode lève « Cannot read properties of
   * undefined (reading 'rest') » AVANT tout réseau.
   *
   * Le cast est nécessaire parce que `types/supabase.ts` déclare
   * `Functions: Record<string, never>` : les fonctions ne sont pas générées
   * dans le type de la base, donc aucun nom de RPC n'y est connu. Même forme
   * que le moteur par séance, pour la même raison.
   */
  const rpc = (
    supabase.rpc as unknown as (
      fn: "save_training_program_sessions",
      args: { p_payload: Record<string, unknown> },
    ) => Promise<{
      data: unknown;
      error: { message: string; code?: string; details?: string; hint?: string } | null;
    }>
  ).bind(supabase);

  const { data, error } = await rpc("save_training_program_sessions", { p_payload: payload });

  if (error) {
    throw new EchecEnregistrementGroupe(
      classerEchecGroupe([error.message, error.code, error.details, error.hint].filter(Boolean).join(" | ")),
    );
  }
  if (!data) {
    // Ni erreur ni données : on NE déclare PAS un succès. Sous RLS, une absence
    // de résultat a déjà voulu dire « refusé » (incident du 02/08/2026).
    throw new EchecEnregistrementGroupe({
      cause: "inconnue",
      message: "save_training_program_sessions : aucun résultat retourné",
      seance: null,
    });
  }

  const brut = data as unknown as {
    program_id: string;
    program_updated_at: string;
    weeks: Record<string, string>;
    week_count: number;
    session_count: number;
    sessions: {
      client_id: string | null;
      session_id: string;
      updated_at: string;
      session_type: string;
      created: boolean;
      id_mapping?: {
        blocks?: Record<string, string>;
        exercises?: Record<string, string>;
        prescriptions?: Record<string, string>;
      };
      warnings?: { detached_exercise_feedback_count?: number };
    }[];
  };

  return {
    programId: brut.program_id,
    programUpdatedAt: brut.program_updated_at,
    weeks: brut.weeks ?? {},
    weekCount: brut.week_count ?? 0,
    sessionCount: brut.session_count ?? 0,
    sessions: (brut.sessions ?? []).map((s) => ({
      clientId: s.client_id ?? null,
      sessionId: s.session_id,
      updatedAt: s.updated_at,
      sessionType: s.session_type,
      created: Boolean(s.created),
      idMapping: {
        blocks: s.id_mapping?.blocks ?? {},
        exercises: s.id_mapping?.exercises ?? {},
        // Pas de `?? {}` : `undefined` distingue « la base n'a pas encore le
        // lot D » de « aucune prescription créée par cet appel ».
        prescriptions: s.id_mapping?.prescriptions,
      },
      detachedExerciseFeedbackCount: s.warnings?.detached_exercise_feedback_count ?? 0,
    })),
  };
}
