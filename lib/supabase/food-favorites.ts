import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * LES FAVORIS D'UN ÉLÈVE (ALIMENTS A5).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE N'A PAS DE RPC, ET C'EST DÉLIBÉRÉ
 * ────────────────────────────────────────────────────────────────────────────
 * A2 et A3 passent par des RPC parce que le serveur doit CALCULER ce que le
 * client n'a pas le droit de décider : les macros d'un instantané. Un favori ne
 * calcule rien — c'est une ligne à deux colonnes utiles. La RLS dit quelles
 * lignes, les privilèges disent quels verbes, et une RPC de plus serait une
 * surface à maintenir sans contrepartie.
 *
 * ⚠️ `student_id` N'EST PAS ENVOYÉ PAR LE CLIENT. Il est posé par la base, via
 * le défaut de la policy `with check (student_id = current_student_id())` — non,
 * pas exactement : la policy REFUSE une valeur étrangère, elle n'en fabrique
 * pas. C'est donc l'appelant qui doit fournir le sien, et la base qui refuse
 * tout autre. Les deux ensemble : une erreur de code devient un refus, jamais
 * un favori écrit chez quelqu'un d'autre.
 */

export type CibleFavori =
  | { readonly type: "aliment"; readonly id: string }
  | { readonly type: "produit"; readonly id: string };

export interface FavoriEnregistre {
  readonly id: string;
  readonly cible: CibleFavori;
  readonly creeLe: string;
}

/** La clé d'une cible, pour comparer sans confondre un aliment et un produit. */
export function cleFavori(cible: CibleFavori): string {
  return `${cible.type}:${cible.id}`;
}

interface LigneFavori {
  id: string;
  catalog_food_id: string | null;
  product_id: string | null;
  created_at: string;
}

function versFavori(ligne: LigneFavori): FavoriEnregistre | null {
  // La base garantit « exactement une cible » par contrainte. On le revérifie
  // ici plutôt que de faire confiance : une ligne incohérente doit disparaître
  // de l'écran, pas y produire un bouton qui ne mène nulle part.
  if (ligne.catalog_food_id !== null && ligne.product_id === null) {
    return { id: ligne.id, cible: { type: "aliment", id: ligne.catalog_food_id }, creeLe: ligne.created_at };
  }
  if (ligne.product_id !== null && ligne.catalog_food_id === null) {
    return { id: ligne.id, cible: { type: "produit", id: ligne.product_id }, creeLe: ligne.created_at };
  }
  return null;
}

/**
 * Les favoris de l'élève connecté, les plus récents d'abord.
 *
 * UNE seule requête, servie par `food_favorites_student_idx`. La RLS fait le
 * filtrage : aucun `student_id` n'est passé, et il n'y en a pas besoin — un
 * élève ne peut voir que les siens.
 */
export async function listerFavoris(
  supabase: TypedSupabaseClient,
): Promise<readonly FavoriEnregistre[]> {
  const { data, error } = await supabase
    .from("food_favorites")
    .select("id, catalog_food_id, product_id, created_at")
    .order("created_at", { ascending: false })
    .limit(60);
  if (error || !data) return [];
  return (data as unknown as LigneFavori[])
    .map(versFavori)
    .filter((f): f is FavoriEnregistre => f !== null);
}

/**
 * Ajoute un favori. Rend `true` si la ligne existe APRÈS l'appel — y compris
 * quand elle existait déjà.
 *
 * ⚠️ UN DOUBLON N'EST PAS UNE ERREUR POUR L'ÉLÈVE. Deux tapes rapprochées sur
 * l'étoile, ou un favori posé depuis un autre appareil, font échouer l'insertion
 * sur l'index unique (code 23505). Du point de vue de l'élève, le résultat
 * voulu est atteint : l'aliment EST en favori. Remonter une erreur ferait
 * clignoter un message pour une situation parfaitement normale.
 */
export async function ajouterFavori(
  supabase: TypedSupabaseClient,
  studentId: string,
  cible: CibleFavori,
): Promise<boolean> {
  const ligne = {
    student_id: studentId,
    catalog_food_id: cible.type === "aliment" ? cible.id : null,
    product_id: cible.type === "produit" ? cible.id : null,
  };
  const { error } = await supabase.from("food_favorites").insert(ligne as never);
  if (!error) return true;
  // 23505 = violation d'unicité : la ligne était déjà là.
  return (error as { code?: string }).code === "23505";
}

/**
 * Retire un favori par sa CIBLE, jamais par son identifiant de ligne.
 *
 * L'écran connaît l'aliment sur lequel l'élève vient de taper ; il ne connaît
 * pas forcément l'identifiant de la ligne de favori — et le lui faire suivre
 * obligerait à garder les deux synchronisés. La contrainte d'unicité garantit
 * qu'il n'y a de toute façon qu'une ligne par (élève, cible).
 */
export async function retirerFavori(
  supabase: TypedSupabaseClient,
  cible: CibleFavori,
): Promise<boolean> {
  const colonne = cible.type === "aliment" ? "catalog_food_id" : "product_id";
  const { error } = await supabase.from("food_favorites").delete().eq(colonne, cible.id);
  return !error;
}
