import type { SupabaseClient } from "@supabase/supabase-js";

import {
  indexerReglages,
  type EcritureReglage,
  type IndexReglages,
  type LigneReglage,
} from "@/lib/progression-reglage";
import type { Database } from "@/types/supabase";

/**
 * RÉGLAGE « PROGRESSION AUTOMATIQUE » — lecture et écriture.
 *
 * UNE requête par programme, jamais une par exercice : le builder comme la
 * page de séance lisent l'intégralité des réglages du programme d'un coup,
 * puis interrogent l'index en mémoire (`progressionActivePour`).
 *
 * ⚠️ UNE LECTURE EN ERREUR REND UN INDEX VIDE, DONC « TOUT OFF ».
 * C'est le comportement sûr et il est délibéré : un réseau qui tombe fait
 * disparaître les recommandations, il n'en invente pas. Comme partout dans
 * lib/supabase/*, aucune exception n'est propagée à l'affichage.
 *
 * ⚠️ L'ÉCRITURE, ELLE, REMONTE SON ÉCHEC. Un coach qui bascule un bouton doit
 * savoir si son geste a été enregistré : avaler l'erreur ferait croire à un
 * réglage posé alors que la base n'a rien reçu.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

const TABLE = "program_exercise_progression" as const;

/** Tous les réglages d'un programme, indexés par identité d'exercice. */
export async function getProgressionReglages(
  supabase: TypedSupabaseClient,
  programId: string,
): Promise<IndexReglages> {
  if (!programId) return indexerReglages([]);
  const { data, error } = await supabase
    .from(TABLE)
    .select("exercise_library_id, exercise_name_normalized, progression_active")
    .eq("program_id", programId);
  if (error || !data) return indexerReglages([]);
  const lignes: LigneReglage[] = data.map((ligne) => ({
    exerciseLibraryId: ligne.exercise_library_id,
    exerciseNameNormalized: ligne.exercise_name_normalized,
    progressionActive: ligne.progression_active === true,
  }));
  return indexerReglages(lignes);
}

/**
 * Pose le réglage d'UN exercice.
 *
 * ⚠️ PAS D'`upsert` AVEC `onConflict`. La table porte DEUX index uniques
 * partiels (un par identité), et PostgREST ne sait viser qu'une contrainte
 * nommée à la fois : un `onConflict` devrait choisir laquelle, donc se
 * tromper une fois sur deux. Un `update` ciblé suivi, s'il n'a rien touché,
 * d'un `insert`, exprime exactement l'intention sans dépendre de l'index.
 *
 * La séquence n'est pas atomique : deux coachs basculant le MÊME exercice du
 * même programme à la même seconde peuvent faire échouer l'`insert` du
 * second sur l'index unique. Ce cas rend une erreur plutôt qu'un réglage
 * silencieusement perdu, et l'écran invite à réessayer — la valeur en base
 * reste alors celle du premier, qui est une valeur réelle et non un mélange.
 */
export async function setProgressionReglage(
  supabase: TypedSupabaseClient,
  ecriture: EcritureReglage,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const filtre = supabase
    .from(TABLE)
    .update({ progression_active: ecriture.progressionActive })
    .eq("program_id", ecriture.programId);

  const cible =
    ecriture.exerciseLibraryId !== null
      ? filtre.eq("exercise_library_id", ecriture.exerciseLibraryId)
      : filtre.eq("exercise_name_normalized", ecriture.exerciseNameNormalized ?? "");

  const { data: modifiees, error: erreurMaj } = await cible.select("id");
  if (erreurMaj) return { ok: false, message: erreurMaj.message };
  if ((modifiees?.length ?? 0) > 0) return { ok: true };

  const { error: erreurInsert } = await supabase.from(TABLE).insert({
    program_id: ecriture.programId,
    exercise_library_id: ecriture.exerciseLibraryId,
    exercise_name_normalized: ecriture.exerciseNameNormalized,
    progression_active: ecriture.progressionActive,
  });
  if (erreurInsert) return { ok: false, message: erreurInsert.message };
  return { ok: true };
}
