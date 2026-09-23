import type { SupabaseClient } from "@supabase/supabase-js";

import {
  indexerIdentifiants,
  indexerReglages,
  type EcritureReglage,
  type IdentifiantsReglages,
  type IndexReglages,
  type LigneReglage,
  type LotsDEcriture,
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

/** Ce qu'une lecture rend : l'état affiché, et les identifiants pour écrire. */
export interface ReglagesLus {
  readonly index: IndexReglages;
  readonly identifiants: IdentifiantsReglages;
}

/**
 * Tous les réglages d'un programme — UNE requête, index et identifiants.
 *
 * `id` est sélectionné en plus de l'état : c'est la seule cible de conflit
 * utilisable pour l'écriture groupée (voir `LigneReglage.id`). Une colonne de
 * plus dans un `select` ne coûte rien ; la redemander à l'écriture aurait
 * coûté un aller-retour.
 */
export async function getProgressionReglages(
  supabase: TypedSupabaseClient,
  programId: string,
): Promise<ReglagesLus> {
  const vide = { index: indexerReglages([]), identifiants: indexerIdentifiants([]) };
  if (!programId) return vide;
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, exercise_library_id, exercise_name_normalized, progression_active")
    .eq("program_id", programId);
  if (error || !data) return vide;
  const lignes: LigneReglage[] = data.map((ligne) => ({
    id: ligne.id,
    exerciseLibraryId: ligne.exercise_library_id,
    exerciseNameNormalized: ligne.exercise_name_normalized,
    progressionActive: ligne.progression_active === true,
  }));
  return { index: indexerReglages(lignes), identifiants: indexerIdentifiants(lignes) };
}

/**
 * Écrit N réglages en AU PLUS DEUX requêtes.
 *
 * ⚠️ `upsert` SUR LA CLÉ PRIMAIRE, PAS SUR L'IDENTITÉ D'EXERCICE.
 * Les deux index d'unicité de la table sont PARTIELS. PostgREST transmet
 * `on_conflict` comme une simple liste de colonnes en paramètre d'URL et
 * n'émet jamais le prédicat `WHERE` qu'un index partiel exige pour être
 * inféré : viser `(program_id, exercise_library_id)` échouerait en 42P10. La
 * clé primaire s'infère toujours — d'où la lecture qui ramène les `id`.
 *
 * Les lignes neuves partent en un `insert` groupé : aucune n'existe encore
 * pour son identité, donc aucun conflit à arbitrer.
 *
 * Deux coachs qui règlent le MÊME exercice à la même seconde peuvent encore
 * faire échouer l'insertion du second sur un index partiel. Comme avant, cela
 * rend une erreur plutôt qu'un réglage silencieusement perdu.
 */
export async function setProgressionReglagesEnLot(
  supabase: TypedSupabaseClient,
  lots: LotsDEcriture,
): Promise<{ ok: true; requetes: number } | { ok: false; message: string; requetes: number }> {
  let requetes = 0;

  if (lots.aMettreAJour.length > 0) {
    requetes += 1;
    const { error } = await supabase.from(TABLE).upsert(
      lots.aMettreAJour.map((ligne) => ({
        id: ligne.id,
        program_id: ligne.programId,
        exercise_library_id: ligne.exerciseLibraryId,
        exercise_name_normalized: ligne.exerciseNameNormalized,
        progression_active: ligne.progressionActive,
      })),
      { onConflict: "id" },
    );
    if (error) return { ok: false, message: error.message, requetes };
  }

  if (lots.aInserer.length > 0) {
    requetes += 1;
    const { error } = await supabase.from(TABLE).insert(
      lots.aInserer.map((ligne) => ({
        program_id: ligne.programId,
        exercise_library_id: ligne.exerciseLibraryId,
        exercise_name_normalized: ligne.exerciseNameNormalized,
        progression_active: ligne.progressionActive,
      })),
    );
    if (error) return { ok: false, message: error.message, requetes };
  }

  return { ok: true, requetes };
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
