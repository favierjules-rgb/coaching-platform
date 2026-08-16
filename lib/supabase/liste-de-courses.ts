import type { SupabaseClient } from "@supabase/supabase-js";

import type { LignePourRpc, ListePersistee, LignePersistee } from "@/lib/nutrition/liste-persistante";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C2 — LA LISTE DE COURSES PERSISTANTE, CÔTÉ BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX RÉGIMES D'ÉCRITURE, ET C'EST UN CHOIX ARBITRÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Le critère du projet est constant (`food-favorites.ts` le documente en toutes
 * lettres) : RPC quand le serveur ARBITRE ou quand l'ATOMICITÉ multi-lignes est
 * en jeu, écriture directe sinon.
 *
 *   • RÉGÉNÉRER  → RPC. Trois verbes en une transaction ; un échec entre le
 *                  `delete` et l'`insert` laisserait une liste amputée.
 *   • MODIFIER UN ARTICLE MANUEL → RPC. Non pour l'atomicité, mais parce que le
 *                  privilège d'`update` accordé au client est réduit à la seule
 *                  colonne `checked` : c'est ce grant qui rend §12 étanche.
 *   • COCHER, AJOUTER, SUPPRIMER → écriture directe. Une ligne, une colonne,
 *                  aucun arbitrage. Une RPC y serait une surface à maintenir
 *                  sans contrepartie.
 *
 * ⚠️ AUCUNE DE CES FONCTIONS N'AGRÈGE, NE CONVERTIT NI NE DEVINE. Elles portent
 * des lignes déjà calculées par C1, et remontent les refus tels que le serveur
 * les a nommés.
 */

export class RpcListeDeCoursesError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "RpcListeDeCoursesError";
    this.code = code;
  }
}

async function appeler<T>(
  supabase: TypedSupabaseClient,
  nom: string,
  args: Record<string, unknown>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- les RPC de C2 ne sont pas dans les types générés tant que `supabase gen types` n'a pas été rejoué après le db push.
  const { data, error } = await (supabase as any).rpc(nom, args);
  if (error) throw new RpcListeDeCoursesError(error.message ?? "ERREUR_INCONNUE");
  return data as T;
}

/* ══════════════════════════════════════════════════════════════════════════
 * LECTURE
 * ════════════════════════════════════════════════════════════════════════ */

interface LigneBrute {
  id: string;
  source: string;
  catalog_food_id: string | null;
  product_id: string | null;
  label: string | null;
  quantity: number | string | null;
  unit: string | null;
  checked: boolean;
  created_at: string;
}

/**
 * ⚠️ `numeric` REVIENT EN CHAÎNE. PostgREST sérialise `numeric` en texte pour ne
 * pas perdre de précision. Le convertir ici, une fois, évite qu'un `"300"` se
 * compare à `300` quelque part dans l'écran et fasse clignoter « METTRE À
 * JOUR » sans raison.
 */
function versNombre(v: number | string | null): number | null {
  if (v === null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function versLigne(l: LigneBrute): LignePersistee | null {
  if (l.source !== "plan" && l.source !== "manual") return null;
  return {
    id: l.id,
    source: l.source,
    catalogFoodId: l.catalog_food_id,
    productId: l.product_id,
    label: l.label,
    quantity: versNombre(l.quantity),
    unit: l.unit,
    checked: l.checked,
    creeLe: l.created_at,
  };
}

export interface LectureDeLaListe {
  /** `false` = la lecture a ÉCHOUÉ. Ce n'est PAS la même chose qu'aucune liste. */
  readonly ok: boolean;
  readonly liste: ListePersistee | null;
}

/**
 * La liste de l'élève pour une période EXACTE, avec ses lignes.
 *
 * ⚠️ `ok: false` N'EST PAS « PAS DE LISTE ». Un réseau coupé et une liste jamais
 * générée mènent au même écran vide si on les confond — et l'élève cliquerait
 * « GÉNÉRER » sur une liste qui existe déjà, en croyant la créer.
 *
 * Deux requêtes, pas une jointure : `shopping_lists` puis ses lignes. La RLS
 * filtre les deux, aucun `student_id` n'est envoyé.
 */
export async function lireListeDeCourses(
  supabase: TypedSupabaseClient,
  debut: string,
  fin: string,
): Promise<LectureDeLaListe> {
  const { data: listes, error: erreurListe } = await supabase
    .from("shopping_lists")
    .select("id, starts_on, ends_on, updated_at")
    .eq("starts_on", debut)
    .eq("ends_on", fin)
    .limit(1);
  if (erreurListe) return { ok: false, liste: null };
  const tete = (listes ?? [])[0] as
    | { id: string; starts_on: string; ends_on: string; updated_at: string }
    | undefined;
  if (!tete) return { ok: true, liste: null };

  const { data: lignes, error: erreurLignes } = await supabase
    .from("shopping_list_items")
    .select("id, source, catalog_food_id, product_id, label, quantity, unit, checked, created_at")
    .eq("list_id", tete.id)
    .order("created_at", { ascending: true });
  if (erreurLignes) return { ok: false, liste: null };

  return {
    ok: true,
    liste: {
      id: tete.id,
      debut: tete.starts_on,
      fin: tete.ends_on,
      majLe: tete.updated_at,
      lignes: ((lignes ?? []) as unknown as LigneBrute[])
        .map(versLigne)
        .filter((l): l is LignePersistee => l !== null),
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * ÉCRITURES
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Crée ou rouvre la liste, puis la réconcilie avec l'agrégation reçue.
 *
 * ⚠️ APPELÉE SUR UN GESTE EXPLICITE, JAMAIS À L'OUVERTURE (§13). Régénérer en
 * silence à chaque affichage réécrirait la liste de quelqu'un en train de faire
 * ses courses.
 */
export function regenererListeDeCourses(
  supabase: TypedSupabaseClient,
  debut: string,
  fin: string,
  lignes: readonly LignePourRpc[],
): Promise<string> {
  return appeler<string>(supabase, "regenerer_liste_de_courses", {
    p_starts_on: debut,
    p_ends_on: fin,
    p_lignes: lignes,
  });
}

/**
 * Coche ou décoche une ligne — PLAN ou MANUELLE.
 *
 * ⚠️ UNE SEULE COLONNE, ET C'EST LA BASE QUI L'IMPOSE. `authenticated` n'a le
 * privilège d'`update` que sur `checked` : écrire autre chose ici ne serait pas
 * refusé par une règle applicative qu'on pourrait oublier, mais par un
 * « permission denied for column ».
 */
export async function cocherLigne(
  supabase: TypedSupabaseClient,
  ligneId: string,
  coche: boolean,
): Promise<boolean> {
  const { error } = await supabase
    .from("shopping_list_items")
    .update({ checked: coche } as never)
    .eq("id", ligneId);
  return !error;
}

export interface ArticleManuel {
  readonly libelle: string;
  readonly quantite: number | null;
  readonly unite: string | null;
}

/**
 * Ajoute un article saisi à la main.
 *
 * ⚠️ AUCUNE RECHERCHE DANS `food_catalog` (§10). Le libellé n'est pas apparié,
 * pas suggéré, pas corrigé. « Papier toilette » n'est pas un aliment, et
 * « poulet » saisi à la main ne devient pas la fiche « Poulet, cuit ».
 *
 * ⚠️ AUCUNE UNITÉ DÉDUITE (§21). Si l'élève n'en donne pas, la ligne n'en a pas.
 */
export async function ajouterArticleManuel(
  supabase: TypedSupabaseClient,
  listeId: string,
  studentId: string,
  article: ArticleManuel,
): Promise<boolean> {
  const libelle = article.libelle.trim();
  if (libelle === "") return false;
  const { error } = await supabase.from("shopping_list_items").insert({
    list_id: listeId,
    student_id: studentId,
    source: "manual",
    label: libelle,
    quantity: article.quantite,
    unit: article.unite,
  } as never);
  return !error;
}

/** Modifie un article manuel. Une ligne PLAN est refusée par le serveur. */
export function modifierArticleManuel(
  supabase: TypedSupabaseClient,
  ligneId: string,
  article: ArticleManuel,
): Promise<void> {
  return appeler<void>(supabase, "modifier_article_manuel", {
    p_item_id: ligneId,
    p_label: article.libelle.trim(),
    p_quantity: article.quantite,
    p_unit: article.unite,
  });
}

/**
 * Supprime un article manuel.
 *
 * ⚠️ UNE LIGNE PLAN NE SE SUPPRIME PAS (§11), et ce n'est pas ce code qui le
 * garantit : la policy `delete` de la base ne la voit pas. L'appel « réussit »
 * sans rien supprimer — d'où la vérification du nombre de lignes rendues.
 */
export async function supprimerArticleManuel(
  supabase: TypedSupabaseClient,
  ligneId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("shopping_list_items")
    .delete()
    .eq("id", ligneId)
    .select("id");
  if (error) return false;
  return (data ?? []).length === 1;
}
