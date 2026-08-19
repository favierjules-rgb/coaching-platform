import { AUCUN_MAGASIN, type CouvertureMagasin } from "@/lib/nutrition/couverture-magasin";
import { typeOsmDepuis } from "@/lib/nutrition/magasins-osm";
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
 * La COUVERTURE PRIX du magasin choisi par l'élève — trois cas nommés.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ⚠️ CETTE FONCTION REMPLACE `lireOpLocationIdDuMagasinChoisi(): number | null`
 * ════════════════════════════════════════════════════════════════════════════
 * L'ancienne rendait un `null` qui portait DEUX faits : « aucun magasin choisi »
 * et « magasin choisi, mais inconnu d'Open Prices ». Tant que
 * `stores.op_location_id` était NOT NULL, le second cas était impossible et
 * l'ambiguïté restait théorique. C4.3c rend la colonne nullable, et le second
 * cas devient la SITUATION ORDINAIRE — mesuré à Toulon : deux lieux Open Prices
 * pour toute la ville.
 *
 * À partir de là, un `number | null` obligerait C4.4, puis C4.6, puis l'écran,
 * à redeviner chacun de son côté lequel des deux faits s'applique. Le type
 * discriminé rend cette erreur impossible à écrire.
 *
 * ⚠️ UNE LECTURE QUI ÉCHOUE REND `aucun_magasin`, ET C'EST UNE LIMITE CONNUE,
 * PAS UN CHOIX CONFORTABLE. Le contrat de `student_selected_store` est « zéro
 * ou une ligne » : une erreur PostgREST ici ne se distingue pas, à ce niveau,
 * d'une absence de sélection. Ce qui compte, et qui est garanti, c'est qu'elle
 * ne rende JAMAIS `magasin_ponte` — donc qu'aucune panne ne puisse se traduire
 * par une interrogation d'Open Prices sur un identifiant inventé.
 *
 * ⚠️ `op_location_id` EST UN `bigint`. Il arrive en `number` ou en `string`
 * selon PostgREST ; tout ce qui n'est pas un entier sûr STRICTEMENT POSITIF est
 * traité comme une absence de pont — jamais laissé filer, tronqué, dans une URL.
 */
export async function lireCouvertureDuMagasinChoisi(
  supabase: TypedSupabaseClient,
  studentId: string,
): Promise<CouvertureMagasin> {
  const { data, error } = await supabase
    .from("student_selected_store")
    .select("store_id, stores (op_location_id, osm_type, osm_id)")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error || !data) return AUCUN_MAGASIN;

  const ligne = data as unknown as {
    store_id: unknown;
    stores: { op_location_id: unknown; osm_type: unknown; osm_id: unknown } | null;
  };

  const storeId = typeof ligne.store_id === "string" ? ligne.store_id : "";
  const magasin = ligne.stores;
  if (storeId === "" || magasin === null) return AUCUN_MAGASIN;

  // ⚠️ L'IDENTITÉ OSM EST OBLIGATOIRE, MÊME SANS PONT. C'est elle qui permettra
  // de retenter le pont plus tard sans redemander à l'élève de choisir. Une
  // ligne de `stores` sans identité OSM valide n'est pas exploitable par C4.3c :
  // on la traite comme une absence de magasin plutôt que d'en fabriquer une.
  const osmType = typeOsmDepuis(magasin.osm_type);
  const osmId = entierSurPositif(magasin.osm_id);
  if (osmType === null || osmId === null) return AUCUN_MAGASIN;

  const opLocationId = entierSurPositif(magasin.op_location_id);
  if (opLocationId === null) {
    return { etat: "magasin_sans_couverture_prix", storeId, osmType, osmId };
  }

  return { etat: "magasin_ponte", storeId, osmType, osmId, opLocationId };
}

/**
 * Un `bigint` PostgREST → un entier sûr strictement positif, ou `null`.
 *
 * ⚠️ `Number.isSafeInteger`, ET LE REFUS PLUTÔT QUE LA TRONCATURE. Au-delà de
 * 2⁵³−1, `Number(...)` arrondit en silence ; l'identifiant arrondi désignerait
 * un autre lieu, et rien à l'écran ne le dirait.
 */
function entierSurPositif(brut: unknown): number | null {
  if (typeof brut === "number") return Number.isSafeInteger(brut) && brut > 0 ? brut : null;
  if (typeof brut === "string" && /^\d+$/.test(brut)) {
    const n = Number(brut);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }
  return null;
}
