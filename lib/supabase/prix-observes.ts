import type { SupabaseClient } from "@supabase/supabase-js";

import type { ProduitDirect, ProduitRelie } from "@/lib/nutrition/prix-observes";
import type { Database } from "@/types/supabase";

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * COURSES C4.4 — LES CODE-BARRES D'UNE LISTE, ET LE MAGASIN, CÔTÉ BASE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ CE FICHIER NE CONTIENT AUCUNE ÉCRITURE, ET C'EST LE CONTRAT DU LOT
 * ────────────────────────────────────────────────────────────────────────────
 * Pas un `insert`, pas un `update`, pas un `upsert`, pas un `delete`, pas une
 * `rpc`. C4.4 est un moteur de LECTURE : il regarde ce que la curation a posé et
 * ce que l'élève a choisi, il n'ajoute rien. Une seule fonction d'écriture ici
 * ouvrirait la porte à « pendant qu'on y est, mémorisons ce prix » — et un prix
 * mémorisé est un prix qui vieillit sans le dire.
 *
 * ⚠️ ET AUCUNE LECTURE N'EST FAITE AVEC UN CLIENT ADMIN. Tout passe par le
 * client de l'élève, sous sa propre RLS. `food_products` est un référentiel
 * public en lecture (`grant select` à `authenticated`, migration 20260903090000)
 * et `student_selected_store` est filtré par la policy de l'élève : rien ici
 * n'a besoin de contourner quoi que ce soit.
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. LES CODE-BARRES DES IDENTITÉS DE LA LISTE
// ────────────────────────────────────────────────────────────────────────────

export interface GtinsDeLaListe {
  /** `false` = la lecture a ÉCHOUÉ. Ce n'est PAS « aucun produit relié ». */
  readonly ok: boolean;
  readonly produitsDirects: readonly ProduitDirect[];
  readonly produitsRelies: readonly ProduitRelie[];
}

/**
 * Les code-barres qui servent les lignes d'une liste de courses.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * DEUX REQUÊTES, PARCE QU'IL Y A DEUX CHEMINS
 * ════════════════════════════════════════════════════════════════════════════
 *   A. `product_id` → `food_products.id` → SON code-barres. Une ligne, un code.
 *      ⚠️ `shopping_list_items.product_id` référence `food_products (id)`, PAS
 *      le `gtin` : il faut donc bien traverser la table, et non prendre
 *      l'identifiant pour un code-barres ;
 *
 *   B. `catalog_food_id` → `food_products.food_id` → TOUS ses code-barres.
 *      ⚠️ LE FILTRE EST `food_id`, JAMAIS `match_status` — condition canonique
 *      du pont (`estRapproche`). `match_status = 'manual'` avec `food_id = null`
 *      est un état LÉGAL, produit par le `on delete set null` de `food_catalog`,
 *      et un tel produit est ORPHELIN : le compter ferait remonter le prix d'un
 *      produit rattaché à un aliment qui n'existe plus.
 *
 * ⚠️ ET LE `IN` SUR `food_id` PEUT RENDRE PLUSIEURS LIGNES PAR ALIMENT. C'est
 * le comportement ATTENDU — contrat de cardinalité, règle A. Aucun `limit`,
 * aucun `order`, aucune déduplication par aliment : les N sortent tous.
 *
 * ⚠️ `ok: false` N'EST PAS UNE LISTE VIDE. Un réseau coupé afficherait sinon
 * « aucun produit relié » sur toute la liste, et l'élève croirait que la
 * curation n'a jamais eu lieu.
 */
export async function lireGtinsDeLaListe(
  supabase: TypedSupabaseClient,
  params: {
    readonly catalogFoodIds: readonly string[];
    readonly productIds: readonly string[];
  },
): Promise<GtinsDeLaListe> {
  const produitsDirects: ProduitDirect[] = [];
  const produitsRelies: ProduitRelie[] = [];

  if (params.catalogFoodIds.length === 0 && params.productIds.length === 0) {
    return { ok: true, produitsDirects, produitsRelies };
  }

  const requetes: Promise<{ data: unknown; error: unknown }>[] = [];

  if (params.productIds.length > 0) {
    requetes.push(
      supabase
        .from("food_products")
        .select("id, gtin")
        .in("id", params.productIds as string[]) as unknown as Promise<{
        data: unknown;
        error: unknown;
      }>,
    );
  }
  if (params.catalogFoodIds.length > 0) {
    requetes.push(
      supabase
        .from("food_products")
        .select("gtin, food_id")
        .in("food_id", params.catalogFoodIds as string[]) as unknown as Promise<{
        data: unknown;
        error: unknown;
      }>,
    );
  }

  const reponses = await Promise.all(requetes);
  if (reponses.some((r) => r.error)) return { ok: false, produitsDirects: [], produitsRelies: [] };

  let curseur = 0;
  if (params.productIds.length > 0) {
    const lignes = reponses[curseur]?.data;
    curseur += 1;
    if (!Array.isArray(lignes)) return { ok: false, produitsDirects: [], produitsRelies: [] };
    for (const l of lignes as ReadonlyArray<Record<string, unknown>>) {
      const productId = typeof l["id"] === "string" ? l["id"] : "";
      const gtin = typeof l["gtin"] === "string" ? l["gtin"] : "";
      if (productId !== "" && gtin !== "") produitsDirects.push({ productId, gtin });
    }
  }
  if (params.catalogFoodIds.length > 0) {
    const lignes = reponses[curseur]?.data;
    if (!Array.isArray(lignes)) return { ok: false, produitsDirects: [], produitsRelies: [] };
    for (const l of lignes as ReadonlyArray<Record<string, unknown>>) {
      const foodId = typeof l["food_id"] === "string" ? l["food_id"] : "";
      const gtin = typeof l["gtin"] === "string" ? l["gtin"] : "";
      if (foodId !== "" && gtin !== "") produitsRelies.push({ foodId, gtin });
    }
  }

  return { ok: true, produitsDirects, produitsRelies };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. L'IDENTIFIANT AMONT DU MAGASIN CHOISI
// ────────────────────────────────────────────────────────────────────────────

/**
 * `stores.op_location_id` du magasin actuellement choisi par l'élève — ou
 * `null` s'il n'en a pas choisi.
 *
 * ⚠️ UNE FONCTION NEUVE PLUTÔT QU'UN CHAMP AJOUTÉ À `MagasinChoisi`. Ce type
 * sert l'écran de C4.3, éprouvé ; y greffer une colonne ferait porter à un
 * lot terminé le risque d'un lot en cours. La requête supplémentaire est le
 * prix d'une frontière nette.
 *
 * ⚠️ `null` ICI VEUT DIRE « PAS DE MAGASIN », ET RIEN D'AUTRE. Il ne veut pas
 * dire « pas de prix » : c'est `etatPrixObserves` qui en tire `aucun_magasin`,
 * un état qui invite à choisir un magasin plutôt qu'à conclure à une absence.
 *
 * ⚠️ `op_location_id` EST UN `bigint`. Il arrive en `number` par PostgREST et
 * les identifiants observés sont de l'ordre du millier ; on refuse tout ce qui
 * n'est pas un entier sûr plutôt que de laisser filer une valeur tronquée dans
 * une URL.
 */
export async function lireOpLocationIdDuMagasinChoisi(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<number | null> {
  const { data, error } = await supabase
    .from("student_selected_store")
    .select("stores (op_location_id)")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) return null;
  const ligne = data as unknown as { stores: { op_location_id: unknown } | null };
  const brut = ligne.stores?.op_location_id;
  if (typeof brut === "number" && Number.isSafeInteger(brut)) return brut;
  if (typeof brut === "string" && /^\d+$/.test(brut)) {
    const n = Number(brut);
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}
