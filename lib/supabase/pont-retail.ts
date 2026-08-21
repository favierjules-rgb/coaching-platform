import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type LigneRevue,
  type ProduitRapproche,
  type StatutRevue,
  estStatutRevue,
} from "@/lib/nutrition/pont-retail";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C4.1 — LE PONT, CÔTÉ BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN SEUL RÉGIME D'ÉCRITURE, ET C'EST DÉLIBÉRÉ
 * ────────────────────────────────────────────────────────────────────────────
 * `food_products` n'accorde **aucun** privilège d'écriture à `authenticated` :
 * `revoke all`, puis `grant select` seul (migration 20260903090000). C'est le
 * cœur de cette table, et pas un oubli — un cache global qu'un navigateur
 * pourrait modifier ferait entrer des macros fabriquées dans le journal
 * alimentaire des élèves.
 *
 * Deux conséquences, et elles gouvernent tout ce fichier :
 *
 *   1. AUCUNE RPC `security definer` n'est créée pour poser `food_id`. Elle
 *      serait le PREMIER chemin d'écriture cliente vers cette table — donc
 *      exactement ce que la serrure interdit, rouvert par une porte de service ;
 *   2. l'écriture passe par le client `service_role`, depuis une route serveur,
 *      c'est-à-dire par le chemin qui remplit DÉJÀ cette table
 *      (`/api/food-products/[gtin]`, `/api/food-products/search`).
 *
 * ⚠️ Les fonctions d'écriture ci-dessous prennent un client ADMIN. Elles ne
 * vérifient AUCUN droit : c'est la route appelante qui le fait, avant, avec
 * `requireAdmin()`. Une fonction qui prend un client service_role a déjà perdu
 * la RLS ; lui faire croire qu'elle protège quelque chose serait pire que rien.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LECTURES
// ────────────────────────────────────────────────────────────────────────────

export interface AlimentDuPont {
  readonly id: string;
  readonly name: string;
  /** Le code Ciqual — `food_catalog.source_ref`, 100 % renseigné en production. */
  readonly codeCiqual: string | null;
  readonly nutritionUnit: string;
}

/**
 * L'aliment, avec son code Ciqual. Rend `null` si l'identifiant n'existe pas —
 * ce que la route traduira en 404, plutôt que d'écrire un rapprochement vers
 * un aliment fantôme.
 */
export async function lireAlimentDuPont(
  supabase: TypedSupabaseClient,
  catalogFoodId: string,
): Promise<AlimentDuPont | null> {
  const { data, error } = await supabase
    .from("food_catalog")
    .select("id, name, source, source_ref, nutrition_unit")
    .eq("id", catalogFoodId)
    .maybeSingle();

  if (error || !data) return null;
  const ligne = data as unknown as {
    id: string;
    name: string;
    source: string | null;
    source_ref: string | null;
    nutrition_unit: string;
  };
  return {
    id: ligne.id,
    name: ligne.name,
    // ⚠️ Le code n'est repris QUE si la source est bien Ciqual. Un `source_ref`
    // d'une autre provenance n'est pas un code Ciqual, et l'envoyer dans un tag
    // `ciqual-food-code-<N>` interrogerait une clé qui n'a pas ce sens.
    codeCiqual: ligne.source === "ciqual" ? ligne.source_ref : null,
    nutritionUnit: ligne.nutrition_unit,
  };
}

/**
 * Les produits rattachés à un aliment.
 *
 * ⚠️ LE FILTRE EST `food_id`, PAS `match_status`. C'est la condition canonique
 * (voir `estRapproche`) : `match_status = 'manual'` avec `food_id = null` est un
 * état LÉGAL — « ce rapprochement a existé, l'aliment a disparu » — et un tel
 * produit n'est PAS rapproché.
 */
export async function lireProduitsRapproches(
  supabase: TypedSupabaseClient,
  catalogFoodId: string,
): Promise<readonly (ProduitRapproche & { readonly productName: string })[]> {
  const { data, error } = await supabase
    .from("food_products")
    .select("gtin, product_name, food_id, match_status")
    .eq("food_id", catalogFoodId);

  if (error || !Array.isArray(data)) return [];
  return (data as unknown as ReadonlyArray<Record<string, unknown>>).map((l) => ({
    gtin: String(l["gtin"] ?? ""),
    productName: String(l["product_name"] ?? ""),
    foodId: typeof l["food_id"] === "string" ? l["food_id"] : null,
    matchStatus: String(l["match_status"] ?? "unmatched"),
  }));
}

/** La décision de curation courante, s'il y en a une. */
export async function lireRevue(
  supabase: TypedSupabaseClient,
  catalogFoodId: string,
): Promise<(LigneRevue & { readonly note: string | null; readonly reviewedAt: string }) | null> {
  const { data, error } = await (
    supabase
      .from("food_catalog_retail_review" as never)
      .select("catalog_food_id, status, note, reviewed_at")
      .eq("catalog_food_id" as never, catalogFoodId as never)
      .maybeSingle() as unknown as Promise<{ data: unknown; error: unknown }>
  );

  if (error || data === null || typeof data !== "object") return null;
  const ligne = data as Record<string, unknown>;
  const statut = ligne["status"];
  if (!estStatutRevue(statut)) return null;
  return {
    catalogFoodId: String(ligne["catalog_food_id"] ?? ""),
    status: statut as StatutRevue,
    note: typeof ligne["note"] === "string" ? ligne["note"] : null,
    reviewedAt: String(ligne["reviewed_at"] ?? ""),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. ÉCRITURES — CLIENT ADMIN UNIQUEMENT
// ────────────────────────────────────────────────────────────────────────────

export interface ResultatRapprochement {
  readonly ok: boolean;
  readonly rapproches: number;
  readonly erreur: string | null;
}

/**
 * Pose `food_id` sur des produits DÉJÀ présents dans `food_products`.
 *
 * ⚠️ TROIS COLONNES, PAS UNE DE PLUS. `food_id`, `match_status`, `match_score` —
 * la liste est écrite en dur ici, et c'est le point : un `update` construit à
 * partir d'un corps de requête laisserait un jour passer `protein_per_100`.
 * L'écriture arbitraire de colonne est impossible parce qu'aucune colonne
 * arbitraire n'est nommable.
 *
 * ⚠️ `match_score` EST POSÉ À `null`, ET C'EST UN CHOIX. La colonne existe et
 * elle est bornée [0,1], mais C4.1 n'a aucun score à y mettre : la décision est
 * humaine, entière, non probabiliste. Écrire `1` ferait passer une certitude
 * humaine pour une mesure d'algorithme, et le jour où un score automatique
 * arrivera on ne saurait plus distinguer les deux. `match_status = 'manual'`
 * dit déjà tout ce qu'il y a à dire.
 *
 * Le filtre `is null` sur `food_id` est volontairement ABSENT : rapprocher à
 * nouveau un produit déjà rattaché à un autre aliment est une CORRECTION
 * légitime, pas une erreur.
 */
export async function rapprocherProduits(
  admin: TypedSupabaseClient,
  gtins: readonly string[],
  catalogFoodId: string,
): Promise<ResultatRapprochement> {
  if (gtins.length === 0) return { ok: true, rapproches: 0, erreur: null };

  const { data, error } = await admin
    .from("food_products")
    // `as never` : `food_products` n'est pas dans les types générés
    // (`types/supabase.ts`), exactement comme dans `food-products.ts` et
    // `prix-courses.ts`. La forme de l'objet reste écrite en clair au-dessus du
    // cast — c'est elle qui limite l'écriture à trois colonnes.
    .update({
      food_id: catalogFoodId,
      match_status: "manual",
      match_score: null,
    } as never)
    .in("gtin", gtins as string[])
    .select("gtin");

  if (error) {
    return { ok: false, rapproches: 0, erreur: error.message };
  }
  return { ok: true, rapproches: Array.isArray(data) ? data.length : 0, erreur: null };
}

/**
 * Détache un produit de son aliment.
 *
 * ⚠️ `match_status` REDEVIENT `'unmatched'` EN MÊME TEMPS QUE `food_id` TOMBE À
 * `null`. Les laisser désaccordés produirait exactement l'état piégeux que
 * `estRapproche` doit contourner — et créerait, à la main, un déchet que seul
 * un `on delete set null` devrait pouvoir fabriquer.
 */
export async function detacherProduit(
  admin: TypedSupabaseClient,
  gtin: string,
): Promise<ResultatRapprochement> {
  const { data, error } = await admin
    .from("food_products")
    .update({ food_id: null, match_status: "unmatched", match_score: null } as never)
    .eq("gtin", gtin)
    .select("gtin");

  if (error) return { ok: false, rapproches: 0, erreur: error.message };
  return { ok: true, rapproches: Array.isArray(data) ? data.length : 0, erreur: null };
}

/** Écrit — ou remplace — la décision de curation d'un aliment. */
export async function enregistrerRevue(
  admin: TypedSupabaseClient,
  params: {
    readonly catalogFoodId: string;
    readonly status: StatutRevue;
    readonly note: string | null;
    readonly reviewedBy: string | null;
  },
): Promise<boolean> {
  const { error } = await (
    admin
      .from("food_catalog_retail_review" as never)
      .upsert(
        {
          catalog_food_id: params.catalogFoodId,
          status: params.status,
          note: params.note,
          reviewed_by: params.reviewedBy,
          reviewed_at: new Date().toISOString(),
        } as never,
        { onConflict: "catalog_food_id" },
      ) as unknown as Promise<{ error: unknown }>
  );
  return !error;
}

/**
 * Efface la décision de curation devenue caduque.
 *
 * ⚠️ APPELÉE APRÈS UN RAPPROCHEMENT RÉUSSI — c'est la règle de nettoyage du
 * §9 de l'arbitrage. Une ligne `needs_review` laissée en place ferait croire
 * qu'un aliment attend toujours d'être traité alors qu'il est rapproché.
 *
 * ⚠️ MAIS SON ÉCHEC N'EST PAS FATAL, ET C'EST VOULU. L'invariant qui protège
 * réellement est ailleurs : `etatRapprochement` donne la priorité à `matched`
 * sur toute ligne de revue. Le nettoyage est de l'HYGIÈNE, la priorité est
 * l'INVARIANT. Faire échouer un rapprochement réussi parce qu'un `delete` de
 * confort n'est pas passé inverserait l'importance des deux.
 */
export async function effacerRevue(
  admin: TypedSupabaseClient,
  catalogFoodId: string,
): Promise<boolean> {
  const { error } = await (
    admin
      .from("food_catalog_retail_review" as never)
      .delete()
      .eq("catalog_food_id" as never, catalogFoodId as never) as unknown as Promise<{
      error: unknown;
    }>
  );
  return !error;
}
