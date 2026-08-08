import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";
import type { ExerciseSubstituteOption } from "@/types";

/**
 * REMPLAÇANTS D'UN EXERCICE — lecture via la RPC `list_exercise_substitutes`
 * (migration 20260820090000).
 *
 * POURQUOI UNE RPC ET PAS DEUX REQUÊTES. Le navigateur n'a pas à connaître
 * la règle de regroupement : il demande « qui peut remplacer cette fiche ? »
 * et la base répond. Cela évite aussi de lire d'abord le pattern de la
 * source puis de filtrer la banque — deux allers-retours pour un résultat
 * que la base calcule en une fois.
 *
 * LA RPC EST `security invoker` : la RLS de l'appelant s'applique
 * intégralement. Elle ne montre donc RIEN que l'élève ne puisse déjà lire
 * lui-même dans `exercise_library` (politique `exercise_library_select_active`).
 *
 * Comme partout dans lib/supabase/*, une erreur rend une liste VIDE plutôt
 * qu'une exception : l'écran affiche « aucun remplaçant disponible », ce qui
 * est le comportement sûr — jamais une liste inventée.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** Ligne rendue par la RPC — `Functions` n'est pas typé dans types/supabase.ts. */
interface SubstituteRow {
  id: unknown;
  name: unknown;
  video_url: unknown;
  alternative_video_url: unknown;
  muscle_group: unknown;
  equipment: unknown;
  level: unknown;
}

type NomRpcRemplacants = "list_exercise_substitutes";

function boundSubstitutesRpc(supabase: TypedSupabaseClient) {
  return (
    supabase.rpc as unknown as (
      fn: NomRpcRemplacants,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  ).bind(supabase);
}

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur : "";
}

/**
 * Traduit le retour brut de la RPC. Fonction PURE, testée hors ligne : une
 * ligne sans identifiant ou sans nom exploitable est ÉCARTÉE plutôt que
 * rendue avec des champs vides — on ne propose jamais un remplaçant qu'on
 * ne saurait pas nommer.
 */
export function parseExerciseSubstitutes(data: unknown): ExerciseSubstituteOption[] {
  if (!Array.isArray(data)) return [];
  const options: ExerciseSubstituteOption[] = [];
  for (const brut of data) {
    if (typeof brut !== "object" || brut === null) continue;
    const ligne = brut as SubstituteRow;
    const id = texte(ligne.id).trim();
    const name = texte(ligne.name).trim();
    if (!id || !name) continue;
    options.push({
      id,
      name,
      videoUrl: texte(ligne.video_url),
      alternativeVideoUrl: texte(ligne.alternative_video_url),
      muscleGroup: texte(ligne.muscle_group),
      equipment: texte(ligne.equipment),
      level: texte(ligne.level),
    });
  }
  return options;
}

/** Exercices actifs partageant le pattern de mouvement de la fiche donnée. */
export async function listExerciseSubstitutes(
  supabase: TypedSupabaseClient,
  exerciseLibraryId: string,
): Promise<ExerciseSubstituteOption[]> {
  const rpc = boundSubstitutesRpc(supabase);
  const { data, error } = await rpc("list_exercise_substitutes", {
    p_exercise_library_id: exerciseLibraryId,
  });
  if (error) {
    console.error(`[Supabase] listExerciseSubstitutes : ${error.message}`);
    return [];
  }
  return parseExerciseSubstitutes(data);
}
