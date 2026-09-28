import type { SupabaseClient } from "@supabase/supabase-js";

import { dateDeLaSeance, type OrigineDate } from "@/lib/calendrier-athlete";
import { deriveSessionType } from "@/lib/training-blocks";
import { getAssignedProgramForStudent, getProgramStartDate } from "@/lib/supabase/programs";
import { buildCanonicalSessionBlocksInput, saveTrainingSessionBlocks } from "@/lib/supabase/training-session-blocks";
import type { AdminProgram, AdminWorkoutSession, DerivedSessionType, SportCardio, TrainingBlock } from "@/types";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * LE CALENDRIER D'UN ATHLÈTE — lecture, déplacement, suppression, ajout.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN SEUL ATHLÈTE, TOUJOURS NOMMÉ
 * ════════════════════════════════════════════════════════════════════════
 * Tout part de `studentId` : le programme lu est SA copie individuelle
 * (`programs.owner_student_id`), et la date de début est celle de SON
 * affectation. Deux athlètes affectés au même MODÈLE ont deux copies
 * distinctes depuis `individualizeProgramForStudent` : déplacer une séance de
 * Jules ne peut donc pas atteindre Marco, parce que la ligne
 * `workout_sessions` visée n'appartient qu'au programme de Jules.
 *
 * ⚠️ CE MODULE N'ÉCRIT JAMAIS `program_start_date`. Déplacer UNE séance ne doit
 * pas décaler tout le programme — c'est le défaut qui avait été corrigé en
 * septembre 2026 et il ne doit pas revenir par une autre porte.
 *
 * ⚠️ TANT QUE LA MIGRATION 20260930100000 DORT, LE DÉPLACEMENT ÉCHOUE — ET LE
 * DIT. `scheduled_date` n'existe pas encore en base : PostgREST refuse la
 * requête, et `messageDeColonneAbsente` traduit l'erreur en une phrase
 * actionnable plutôt qu'en « PGRST204 ». Un repli silencieux serait pire :
 * l'écran annoncerait un déplacement qui n'a pas eu lieu.
 */

function devWarn(contexte: string, erreur: { message: string; code?: string } | null): void {
  if (erreur) {
    console.error(`[Supabase] ${contexte} : ${erreur.message}${erreur.code ? ` (code ${erreur.code})` : ""}`);
  }
}

/**
 * Traduit l'erreur « colonne inconnue » en une phrase qui dit quoi faire.
 *
 * PostgREST répond `PGRST204` avec « Could not find the 'scheduled_date' column
 * of 'workout_sessions' in the schema cache ». Remonter ce texte tel quel
 * laisserait le coach devant un code d'erreur.
 */
export function messageDeColonneAbsente(message: string): string {
  if (/scheduled_date/.test(message) && /(could not find|does not exist|schema cache)/i.test(message)) {
    return "La colonne `scheduled_date` n'existe pas encore en base : la migration 20260930100000 n'est pas appliquée. Aucune séance n'a été déplacée.";
  }
  return message;
}

export interface SeanceDuCalendrier {
  readonly id: string;
  readonly programId: string;
  readonly weekNumber: number;
  readonly day: string;
  readonly name: string;
  /**
   * Notes du coach de la séance.
   *
   * ⚠️ PORTÉE JUSQU'À L'ÉCRAN, ET C'EST INDISPENSABLE. La modale d'édition
   * renvoie un `session_patch` contenant `coach_notes` : si elle repartait d'une
   * chaîne vide, ENREGISTRER effacerait les notes existantes sans que personne
   * ne l'ait demandé.
   */
  readonly coachNotes: string;
  readonly isRestDay: boolean;
  readonly durationMinutes: number;
  readonly typeDerive: DerivedSessionType;
  readonly scheduledDate: string | null;
  /** Version exacte de la séance, pour le verrou optimiste de la RPC. */
  readonly updatedAt: string | undefined;
  readonly blocks: TrainingBlock[];
  /** Date résolue (planifiée ou calculée) — `null` quand indéterminable. */
  readonly date: string | null;
  readonly origineDate: OrigineDate;
  /** Sports des blocs cardio, sans doublon, dans l'ordre des blocs. */
  readonly sports: readonly SportCardio[];
  /** Couleur de la première pastille à afficher. */
  readonly couleur: string;
}

export interface CalendrierDeLEleve {
  readonly programme: AdminProgram | null;
  /** `assignments.program_start_date` — `null` quand le coach ne l'a pas posée. */
  readonly debut: string | null;
  readonly seances: readonly SeanceDuCalendrier[];
}

/**
 * ⚠️ LES JOURS DE REPOS SONT EXCLUS DU CALENDRIER. Une séance `is_rest_day`
 * n'est pas un entraînement : l'afficher remplirait la grille de pastilles
 * vides et masquerait les vraies séances.
 */
export async function lireCalendrierDeLEleve(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<CalendrierDeLEleve> {
  const programme = await getAssignedProgramForStudent(supabase, studentId);
  if (!programme) {
    return { programme: null, debut: null, seances: [] };
  }
  const debut = await getProgramStartDate(supabase, studentId, programme.id);
  return { programme, debut, seances: seancesDuCalendrier(programme.sessions, debut) };
}

/**
 * La projection PURE d'un programme vers des séances datées.
 *
 * ⚠️ SÉPARÉE DE LA LECTURE, ET C'EST VOLONTAIRE. C'est ici que vivent la
 * hiérarchie des dates, l'exclusion des jours de repos et la couleur affichée :
 * les tester exigeait sinon de simuler huit tables PostgREST, et ce qui est
 * pénible à tester finit par ne pas l'être.
 */
export function seancesDuCalendrier(
  sessions: readonly AdminWorkoutSession[],
  debut: string | null,
): SeanceDuCalendrier[] {
  return sessions
    .filter((session) => !session.isRestDay)
    .map((session): SeanceDuCalendrier => {
      const blocks = session.blocks ?? [];
      const cardio = blocks.filter((bloc) => bloc.category === "cardio");
      const sports: SportCardio[] = [];
      for (const bloc of cardio) {
        if (bloc.category === "cardio" && bloc.sport && !sports.includes(bloc.sport)) sports.push(bloc.sport);
      }
      const { date, origine } = dateDeLaSeance(
        { weekNumber: session.weekNumber, day: session.day, scheduledDate: session.scheduledDate },
        debut,
      );
      return {
        id: session.id,
        programId: session.programId,
        weekNumber: session.weekNumber,
        day: session.day,
        name: session.name,
        coachNotes: session.coachNotes,
        isRestDay: session.isRestDay,
        durationMinutes: session.durationMinutes,
        typeDerive: deriveSessionType(blocks),
        scheduledDate: session.scheduledDate ?? null,
        updatedAt: session.updatedAt,
        blocks,
        date,
        origineDate: origine,
        sports,
        couleur: cardio[0]?.colorKey ?? blocks[0]?.colorKey ?? "gray",
      };
    });
}

/**
 * Déplace UNE séance à une date, ou la ramène au calcul historique (`null`).
 *
 * ⚠️ `.select("id")` ET COMPTAGE DES LIGNES. Un UPDATE PostgREST qui ne touche
 * aucune ligne ne rend pas d'erreur : rendre « succès » afficherait un
 * déplacement qui n'a pas eu lieu. Même doctrine que `setProgramStartDate`.
 */
export async function deplacerSeance(
  supabase: TypedSupabaseClient,
  sessionId: string,
  date: string | null,
): Promise<{ ok: boolean; erreur: string | null }> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .update({ scheduled_date: date } as never)
    .eq("id", sessionId)
    .select("id");
  if (error) {
    devWarn("deplacerSeance", error);
    return { ok: false, erreur: messageDeColonneAbsente(error.message) };
  }
  const lignes = (data as { id: string }[] | null) ?? [];
  if (lignes.length === 0) {
    return { ok: false, erreur: `aucune séance ${sessionId} : rien n'a été déplacé` };
  }
  return { ok: true, erreur: null };
}

/**
 * Supprime UNE séance.
 *
 * ⚠️ LA SUPPRESSION EST DÉFINITIVE, ET ELLE EMPORTE SES BLOCS. Les clés
 * étrangères de `training_blocks`, `workout_exercises` et
 * `training_prescriptions` sont en ON DELETE CASCADE : il n'y a pas de
 * corbeille. L'écran demande confirmation avant d'appeler ceci.
 */
export async function supprimerSeance(
  supabase: TypedSupabaseClient,
  sessionId: string,
): Promise<{ ok: boolean; erreur: string | null }> {
  const { data, error } = await supabase
    .from("workout_sessions")
    .delete()
    .eq("id", sessionId)
    .select("id");
  if (error) {
    devWarn("supprimerSeance", error);
    return { ok: false, erreur: error.message };
  }
  const lignes = (data as { id: string }[] | null) ?? [];
  if (lignes.length === 0) {
    return { ok: false, erreur: `aucune séance ${sessionId} : rien n'a été supprimé` };
  }
  return { ok: true, erreur: null };
}

export interface NouvelleSeanceCardio {
  readonly programId: string;
  readonly weekNumber: number;
  readonly day: string;
  readonly name: string;
  readonly durationMinutes: number | null;
  readonly coachNotes: string;
  /** Date réelle. `null` = la séance suit le calcul historique. */
  readonly scheduledDate: string | null;
  readonly blocks: TrainingBlock[];
}

/**
 * Crée une séance dans le programme de l'athlète et y écrit ses blocs.
 *
 * ⚠️ DEUX ÉTAPES, ET L'ORDRE EST OBLIGATOIRE. La RPC d'écriture des blocs exige
 * une séance existante et sa version exacte (`expectedUpdatedAt`) : la ligne est
 * donc insérée d'abord, et son `updated_at` RETOURNÉ est passé tel quel — jamais
 * une date fabriquée côté client, qui ferait échouer le verrou optimiste.
 *
 * ⚠️ LA SEMAINE DOIT EXISTER. `program_week_id` est NOT NULL : une séance
 * déposée sur une semaine que le programme ne contient pas ne peut pas être
 * créée. On le dit, on n'invente pas une semaine.
 */
export async function creerSeanceCardio(
  supabase: TypedSupabaseClient,
  nouvelle: NouvelleSeanceCardio,
): Promise<{ ok: boolean; sessionId: string | null; erreur: string | null }> {
  const { data: semaine, error: erreurSemaine } = await supabase
    .from("program_weeks")
    .select("id")
    .eq("program_id", nouvelle.programId)
    .eq("week_number", nouvelle.weekNumber)
    .maybeSingle();
  if (erreurSemaine) {
    devWarn("creerSeanceCardio (program_weeks)", erreurSemaine);
    return { ok: false, sessionId: null, erreur: erreurSemaine.message };
  }
  const weekId = (semaine as { id: string } | null)?.id;
  if (!weekId) {
    return {
      ok: false,
      sessionId: null,
      erreur: `la semaine ${nouvelle.weekNumber} n'existe pas dans ce programme : aucune séance n'a été créée`,
    };
  }

  const ligne: Record<string, unknown> = {
    program_id: nouvelle.programId,
    program_week_id: weekId,
    day: nouvelle.day,
    is_rest_day: false,
    name: nouvelle.name,
    muscle_group: "",
    duration_minutes: nouvelle.durationMinutes,
    warmup: "",
    coach_notes: nouvelle.coachNotes,
    session_type: deriveSessionType(nouvelle.blocks) === "rest" ? "cardio" : deriveSessionType(nouvelle.blocks),
  };
  // La date n'est envoyée que si le coach en a posé une : ainsi la création
  // fonctionne AVANT la migration, tant qu'aucune date n'est demandée.
  if (nouvelle.scheduledDate !== null) ligne.scheduled_date = nouvelle.scheduledDate;

  const { data: creee, error } = await supabase
    .from("workout_sessions")
    .insert(ligne as never)
    .select("id, updated_at")
    .single();
  if (error || !creee) {
    devWarn("creerSeanceCardio (insert)", error);
    return { ok: false, sessionId: null, erreur: messageDeColonneAbsente(error?.message ?? "insertion refusée") };
  }
  const { id, updated_at } = creee as { id: string; updated_at: string };

  try {
    /*
     * ⚠️ `buildCanonicalSessionBlocksInput` EST OBLIGATOIRE, PAS DÉCORATIF. Les
     * blocs qui sortent du builder portent des identifiants clients
     * (`generateId`), que la RPC refuse : c'est cet adaptateur qui les traduit en
     * `new-block:<uuid>` / `new-exercise:<uuid>`. L'appel direct échouait sur
     * « sessionId invalide » / « UNRECOGNIZED_BLOCK_ID », et la séance restait
     * créée SANS ses blocs — défaut trouvé par scripts/tests/calendrier-cardio.
     */
    await saveTrainingSessionBlocks(
      supabase,
      buildCanonicalSessionBlocksInput({ sessionId: id, expectedUpdatedAt: updated_at, blocks: nouvelle.blocks }),
    );
  } catch (erreurBlocs) {
    return {
      ok: false,
      sessionId: id,
      erreur: `la séance a été créée mais ses blocs n'ont pas été enregistrés : ${
        erreurBlocs instanceof Error ? erreurBlocs.message : String(erreurBlocs)
      }`,
    };
  }
  return { ok: true, sessionId: id, erreur: null };
}
