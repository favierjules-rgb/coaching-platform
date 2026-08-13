import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  OFF_API_VERSION,
  type ProduitSeth,
  cacheEstFrais,
  kcalPour100,
} from "@/lib/open-food-facts/contrat";
import type { Database } from "@/types/supabase";

/**
 * LE CACHE PRODUIT (ALIMENTS A3, PHASE 3).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LOCAL D'ABORD, RÉSEAU ENSUITE — ET SEULEMENT SI NÉCESSAIRE
 * ────────────────────────────────────────────────────────────────────────────
 * L'ordre n'est pas une optimisation, c'est le comportement voulu :
 *
 *   1. la ligne est en base et FRAÎCHE (< 30 jours) → on la rend. Aucun appel.
 *      Deux élèves qui scannent le même Nutella dans la même semaine, c'est un
 *      appel, pas deux ;
 *   2. la ligne est en base mais PÉRIMÉE → on tente OFF. S'il répond, on met à
 *      jour ; s'il ne répond pas, ON REND LA LIGNE PÉRIMÉE, marquée
 *      `stale: true`. Une valeur d'il y a cinq semaines est infiniment plus
 *      utile qu'un écran d'erreur devant un rayon de supermarché ;
 *   3. la ligne n'existe pas et OFF ne répond pas → erreur franche. Il n'y a
 *      rien à rendre, et on n'invente pas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * QUI ÉCRIT, ET AVEC QUELS DROITS
 * ────────────────────────────────────────────────────────────────────────────
 * La migration 20260903090000 accorde à `authenticated` un SELECT et rien
 * d'autre sur `food_products`. L'écriture passe donc par le client
 * `service_role` (lib/supabase/admin.ts), et c'est légitime ici pour une
 * raison précise : les valeurs écrites ne viennent PAS du corps de la requête
 * navigateur — celui-ci ne transporte qu'un code-barres —, elles viennent de
 * la réponse d'Open Food Facts lue par le serveur.
 *
 * L'avertissement de `admin.ts` (« ne jamais répondre à une requête
 * utilisateur avec ce client sans revérifier les droits ») est respecté au
 * sens fort : il n'y a aucun droit à vérifier, parce qu'il n'y a aucune donnée
 * d'utilisateur ici. `food_products` est un référentiel global, sans
 * propriétaire, identique pour tout le monde.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/** Le produit tel que la couche serveur le rend : le DTO SETH + l'état du cache. */
export interface ProduitEnCache extends ProduitSeth {
  /** L'identifiant `food_products.id` — celui que la RPC attend. */
  readonly id: string;
  readonly fetchedAt: string;
  /** Vrai si la fiche a plus de 30 jours ET qu'OFF n'a pas pu la rafraîchir. */
  readonly stale: boolean;
}

interface LigneProduit {
  id: string;
  gtin: string;
  brand: string | null;
  product_name: string;
  net_quantity: number | string | null;
  net_unit: string | null;
  nutrition_unit: string;
  protein_per_100: number | string;
  carb_per_100: number | string;
  fat_per_100: number | string;
  image_url: string | null;
  ingredients_text: string | null;
  allergens_declared: string[] | null;
  source: string;
  source_version: string | null;
  source_fetched_at: string;
}

const COLONNES =
  "id, gtin, brand, product_name, net_quantity, net_unit, nutrition_unit, " +
  "protein_per_100, carb_per_100, fat_per_100, image_url, ingredients_text, " +
  "allergens_declared, source, source_version, source_fetched_at";

/**
 * Ligne de base → DTO SETH. Les `numeric` de PostgreSQL arrivent en CHAÎNE
 * via PostgREST ; les convertir ici, une fois, évite qu'un `"3.2" + 1` ne
 * rende `"3.21"` quelque part plus loin.
 *
 * `kcalPer100` est RECALCULÉ à la lecture, jamais lu : la table n'a
 * délibérément pas de colonne de calories.
 */
export function produitDepuisLigne(ligne: LigneProduit, stale: boolean): ProduitEnCache {
  const proteine = Number(ligne.protein_per_100);
  const glucide = Number(ligne.carb_per_100);
  const lipide = Number(ligne.fat_per_100);
  const netQuantity = ligne.net_quantity === null ? null : Number(ligne.net_quantity);
  return {
    id: ligne.id,
    gtin: ligne.gtin,
    productName: ligne.product_name,
    brand: ligne.brand,
    netQuantity,
    netUnit: ligne.net_unit === "g" || ligne.net_unit === "ml" ? ligne.net_unit : null,
    nutritionUnit: ligne.nutrition_unit === "ml" ? "ml" : "g",
    proteinPer100: proteine,
    carbPer100: glucide,
    fatPer100: lipide,
    kcalPer100: kcalPour100(proteine, glucide, lipide),
    imageUrl: ligne.image_url,
    ingredientsText: ligne.ingredients_text,
    allergensDeclared: ligne.allergens_declared ?? [],
    source: "open_food_facts",
    sourceVersion: ligne.source_version ?? OFF_API_VERSION,
    fetchedAt: ligne.source_fetched_at,
    stale,
  };
}

/**
 * La ligne en cache pour ce GTIN, avec son verdict de fraîcheur. Lue avec le
 * client de l'APPELANT : la RLS reste active, et la policy
 * `food_products_select_all` autorise la lecture à tout utilisateur
 * authentifié — un référentiel public se lit publiquement.
 */
export async function lireProduitEnCache(
  supabase: TypedSupabaseClient,
  gtin: string,
  maintenant: Date,
): Promise<{ produit: ProduitEnCache; frais: boolean } | null> {
  const { data, error } = await supabase
    .from("food_products")
    .select(COLONNES)
    .eq("gtin", gtin)
    .maybeSingle();
  if (error) {
    console.error(`[Supabase] lecture food_products ${gtin} : ${error.message}`);
    return null;
  }
  if (!data) return null;
  const ligne = data as unknown as LigneProduit;
  const frais = cacheEstFrais(ligne.source_fetched_at, maintenant);
  return { produit: produitDepuisLigne(ligne, !frais), frais };
}

/**
 * Écrit (ou rafraîchit) la fiche. `on_conflict: "gtin"` s'appuie sur l'index
 * unique `food_products_gtin_unique` : un second scan du même produit met la
 * ligne à jour au lieu d'en créer une seconde — et conserve donc son `id`,
 * auquel des `meal_entries` peuvent déjà pointer.
 *
 * `source_fetched_at` est réécrit à CHAQUE succès : c'est lui, et lui seul,
 * qui redémarre le TTL.
 *
 * ⚠️ `payloadBrut` est stocké pour l'AUDIT. Aucune lecture applicative n'y
 * puise une valeur : le jour où l'on s'y mettrait, le schéma d'Open Food Facts
 * redeviendrait le nôtre, et l'isolement construit ici ne servirait plus à
 * rien.
 */
export async function enregistrerProduit(
  admin: TypedSupabaseClient,
  produit: ProduitSeth,
  payloadBrut: unknown,
  maintenant: Date,
): Promise<ProduitEnCache | null> {
  const { data, error } = await admin
    .from("food_products")
    .upsert(
      {
        gtin: produit.gtin,
        brand: produit.brand,
        product_name: produit.productName,
        net_quantity: produit.netQuantity,
        net_unit: produit.netUnit,
        nutrition_unit: produit.nutritionUnit,
        protein_per_100: produit.proteinPer100,
        carb_per_100: produit.carbPer100,
        fat_per_100: produit.fatPer100,
        image_url: produit.imageUrl,
        ingredients_text: produit.ingredientsText,
        allergens_declared: [...produit.allergensDeclared],
        source: produit.source,
        source_version: produit.sourceVersion,
        source_payload: payloadBrut as never,
        source_fetched_at: maintenant.toISOString(),
      } as never,
      { onConflict: "gtin" },
    )
    .select(COLONNES)
    .maybeSingle();

  if (error || !data) {
    console.error(`[Supabase] écriture food_products ${produit.gtin} : ${error?.message ?? "aucune ligne"}`);
    return null;
  }
  return produitDepuisLigne(data as unknown as LigneProduit, false);
}
