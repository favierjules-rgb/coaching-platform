import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  OFF_API_VERSION,
  type ProduitSeth,
  cacheEstFrais,
  detailEstFrais,
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
  /** Dernière OBSERVATION des teneurs, par n'importe quelle voie. */
  readonly fetchedAt: string;
  /**
   * Dernière HYDRATATION réussie depuis `/api/v3.4/product/{gtin}`.
   * `null` = jamais hydratée : la fiche vient d'une recherche texte, qui ne
   * rapporte ni `nutrition_data_per`, ni quantité nette, ni ingrédients.
   */
  readonly detailFetchedAt: string | null;
  /** Raccourci de lecture : `detailFetchedAt !== null`. */
  readonly hydratee: boolean;
  /**
   * Vrai quand la fiche COMPLÈTE n'a pas été rechargée dans le TTL — donc
   * toujours vrai pour un produit seulement découvert par recherche texte.
   * C'est bien la complétude qui est mesurée ici, pas la date à laquelle on a
   * aperçu le code-barres pour la dernière fois.
   */
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
  detail_fetched_at: string | null;
}

const COLONNES =
  "id, gtin, brand, product_name, net_quantity, net_unit, nutrition_unit, " +
  "protein_per_100, carb_per_100, fat_per_100, image_url, ingredients_text, " +
  "allergens_declared, source, source_version, source_fetched_at, detail_fetched_at";

/**
 * Ligne de base → DTO SETH. Les `numeric` de PostgreSQL arrivent en CHAÎNE
 * via PostgREST ; les convertir ici, une fois, évite qu'un `"3.2" + 1` ne
 * rende `"3.21"` quelque part plus loin.
 *
 * `kcalPer100` est RECALCULÉ à la lecture, jamais lu : la table n'a
 * délibérément pas de colonne de calories.
 */
export function produitDepuisLigne(ligne: LigneProduit, maintenant: Date): ProduitEnCache {
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
    detailFetchedAt: ligne.detail_fetched_at,
    hydratee: ligne.detail_fetched_at !== null,
    // Calculée ICI, à partir de la ligne, plutôt que transmise par l'appelant :
    // un booléen passé en paramètre est un endroit de plus où se tromper, et
    // c'est exactement l'erreur que la phase 4.1 corrige.
    stale: !detailEstFrais(ligne.detail_fetched_at, maintenant),
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
): Promise<{ produit: ProduitEnCache; detailFrais: boolean } | null> {
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
  // ⚠️ `detail_fetched_at`, PAS `source_fetched_at`. C'est le correctif de la
  // phase 4.1 : un produit aperçu dans une recherche il y a trente secondes
  // n'a pas pour autant de fiche complète, et le lookup GTIN doit partir.
  return {
    produit: produitDepuisLigne(ligne, maintenant),
    detailFrais: detailEstFrais(ligne.detail_fetched_at, maintenant),
  };
}

/**
 * RECHERCHE LOCALE — aucun réseau, jamais.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI `ilike` ET PAS DAVANTAGE
 * ────────────────────────────────────────────────────────────────────────────
 * `ilike` est insensible à la casse, il est dans PostgreSQL depuis toujours et
 * il ne demande aucune extension. Il ne sait ni les fautes de frappe, ni les
 * accents manquants, ni la proximité de deux mots — pour cela il faudrait
 * `pg_trgm` et `unaccent`.
 *
 * On ne les installe PAS, et ce n'est pas de la paresse : le cache produit est
 * VIDE au moment où ces lignes sont écrites, et il se remplira de ce que les
 * élèves cherchent. Installer une extension pour accélérer une table sans
 * ligne, c'est optimiser une mesure qu'on n'a pas faite. Le jour où la table
 * comptera assez de produits pour que `ilike` traîne ou rate, la mesure
 * existera — et l'extension sera justifiée par un chiffre.
 *
 * C'est aussi le motif de recherche déjà retenu par `searchCatalogFoods` (A2)
 * sur `food_catalog` : deux tables voisines, une seule façon de chercher.
 *
 * Le GTIN n'est interrogé que si la saisie ressemble à un code-barres —
 * chercher « 400 » dans les codes rendrait tous les produits contenant 400
 * n'importe où, ce qui n'est pas ce qu'un élève demande en tapant « 400 ».
 */
export async function rechercherProduitsLocaux(
  supabase: TypedSupabaseClient,
  q: string,
  limite: number,
  maintenant: Date,
): Promise<readonly ProduitEnCache[]> {
  // `%` et `_` sont les jokers de LIKE : sans échappement, une saisie
  // contenant « % » rendrait le catalogue entier.
  const motif = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

  const filtres = [`product_name.ilike.${motif}`, `brand.ilike.${motif}`];
  // Au moins six chiffres : en deçà, ce n'est pas un code-barres, c'est un
  // nombre dans un nom de produit.
  if (/^[0-9]{6,}$/.test(q)) filtres.push(`gtin.ilike.${motif}`);

  const { data, error } = await supabase
    .from("food_products")
    .select(COLONNES)
    .or(filtres.join(","))
    .order("product_name", { ascending: true })
    .limit(limite);

  if (error) {
    console.error(`[Supabase] recherche locale food_products : ${error.message}`);
    return [];
  }
  return ((data ?? []) as unknown as LigneProduit[]).map((ligne) =>
    produitDepuisLigne(ligne, maintenant),
  );
}

/**
 * Les fiches déjà connues, par GTIN — une seule requête, quel que soit le
 * nombre de codes. Sert à savoir, avant d'écrire, ce que le cache contient
 * déjà : c'est ce qui permet de ne pas rafraîchir un produit frais (§7) et de
 * ne rien écraser (voir `enregistrerProduits`).
 */
export async function lireProduitsParGtins(
  supabase: TypedSupabaseClient,
  gtins: readonly string[],
  maintenant: Date,
): Promise<Map<string, { produit: ProduitEnCache; vuRecemment: boolean }>> {
  const connues = new Map<string, { produit: ProduitEnCache; vuRecemment: boolean }>();
  if (gtins.length === 0) return connues;

  const { data, error } = await supabase
    .from("food_products")
    .select(COLONNES)
    .in("gtin", [...gtins]);
  if (error) {
    console.error(`[Supabase] lecture food_products par GTIN : ${error.message}`);
    return connues;
  }
  for (const ligne of (data ?? []) as unknown as LigneProduit[]) {
    // Ici la question est « a-t-on OBSERVÉ ce produit récemment ? », pas
    // « sa fiche complète est-elle fraîche ? ». C'est `source_fetched_at` qui
    // y répond, et c'est ce qui évite de réécrire pour rien une ligne qu'une
    // recherche vient de toucher.
    connues.set(ligne.gtin, {
      produit: produitDepuisLigne(ligne, maintenant),
      vuRecemment: cacheEstFrais(ligne.source_fetched_at, maintenant),
    });
  }
  return connues;
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
        // LE CHEMIN QUI HYDRATE. C'est le seul endroit du dépôt qui écrit
        // cette colonne : la fiche vient d'être chargée en entier depuis
        // /api/v3.4/product/{gtin}, avec nutrition_data_per, quantité nette et
        // ingrédients. La recherche texte, elle, n'y touche jamais.
        detail_fetched_at: maintenant.toISOString(),
      } as never,
      { onConflict: "gtin" },
    )
    .select(COLONNES)
    .maybeSingle();

  if (error || !data) {
    console.error(`[Supabase] écriture food_products ${produit.gtin} : ${error?.message ?? "aucune ligne"}`);
    return null;
  }
  return produitDepuisLigne(data as unknown as LigneProduit, maintenant);
}

/**
 * ÉCRITURE EN LOT DEPUIS UNE RECHERCHE TEXTE — ET POURQUOI ELLE NE PEUT PAS
 * ÊTRE LE MÊME UPSERT QUE CI-DESSUS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UN RÉSULTAT DE RECHERCHE EST PLUS PAUVRE QU'UNE FICHE PAR CODE-BARRES
 * ────────────────────────────────────────────────────────────────────────────
 * Mesuré le 13/08/2026 : l'index de recherche ne porte NI `nutrition_data_per`,
 * NI `product_quantity`, NI `ingredients_text` — les demander dans `fields` ne
 * les fait pas apparaître. Un produit trouvé par texte arrive donc sans
 * quantité nette et sans liste d'ingrédients.
 *
 * L'upsert de la Phase 3 écrit toutes les colonnes. Appliqué tel quel à un
 * résultat de recherche, il aurait ce comportement précis : un élève scanne le
 * Nutella (fiche complète), un autre cherche « nutella » — et la recherche
 * REMPLACE la fiche complète par une fiche amputée, sur la même ligne, à cause
 * du même GTIN unique qui fait par ailleurs toute la valeur du cache. Un
 * enrichissement se transformerait en perte, silencieusement.
 *
 * La règle appliquée ici est donc : UNE ABSENCE NE REMPLACE JAMAIS UNE
 * CONNAISSANCE. C'est la même règle que « absent ≠ zéro », transposée du
 * champ à la ligne.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX EXCEPTIONS, ET ELLES SONT L'INVERSE L'UNE DE L'AUTRE
 * ────────────────────────────────────────────────────────────────────────────
 *   - les TENEURS et le NOM sont toujours réécrits : ce sont des observations
 *     fraîches, aussi valables que celles d'un lookup ;
 *   - `nutrition_unit` n'est JAMAIS réécrit sur une ligne existante. Faute de
 *     `nutrition_data_per` dans l'index, une recherche conclut toujours « g »
 *     PAR DÉFAUT — ce n'est pas une observation, c'est un repli. Écraser un
 *     « ml » établi par code-barres changerait le sens des teneurs sans que
 *     rien ne le signale, et 250 ml d'une boisson deviendraient 250 g.
 *
 * Enfin, un produit déjà FRAIS n'est pas réécrit du tout (§7) : le cache n'a
 * rien à apprendre d'une observation qui ne le contredit pas.
 */
export async function enregistrerProduitsDeRecherche(
  admin: TypedSupabaseClient,
  produits: readonly ProduitSeth[],
  connues: ReadonlyMap<string, { produit: ProduitEnCache; vuRecemment: boolean }>,
  maintenant: Date,
): Promise<{ ecrits: readonly ProduitEnCache[]; rafraichis: number; conserves: number }> {
  const aEcrire: Record<string, unknown>[] = [];
  const conservesTelsQuels: ProduitEnCache[] = [];

  for (const produit of produits) {
    const connue = connues.get(produit.gtin);

    // Déjà OBSERVÉ récemment : on ne réécrit rien. La ligne existante est
    // rendue telle quelle — avec son identifiant, que la RPC attend.
    if (connue?.vuRecemment) {
      conservesTelsQuels.push(connue.produit);
      continue;
    }

    const ancien = connue?.produit;
    aEcrire.push({
      gtin: produit.gtin,
      // `??` et non `||` : une chaîne vide légitime ne doit pas basculer sur
      // l'ancienne valeur, seule l'ABSENCE le doit.
      brand: produit.brand ?? ancien?.brand ?? null,
      product_name: produit.productName,
      net_quantity: produit.netQuantity ?? ancien?.netQuantity ?? null,
      net_unit: produit.netUnit ?? ancien?.netUnit ?? null,
      // Voir plus haut : sur une ligne existante, l'unité établie l'emporte.
      nutrition_unit: ancien?.nutritionUnit ?? produit.nutritionUnit,
      protein_per_100: produit.proteinPer100,
      carb_per_100: produit.carbPer100,
      fat_per_100: produit.fatPer100,
      image_url: produit.imageUrl ?? ancien?.imageUrl ?? null,
      ingredients_text: produit.ingredientsText ?? ancien?.ingredientsText ?? null,
      allergens_declared:
        produit.allergensDeclared.length > 0
          ? [...produit.allergensDeclared]
          : ancien
            ? [...ancien.allergensDeclared]
            : [],
      source: produit.source,
      source_version: produit.sourceVersion,
      // La charge brute n'est PAS conservée pour une recherche : elle
      // contiendrait quarante fiches partielles, et sa seule raison d'être —
      // rejouer ce qui a été lu — est déjà servie par le lookup GTIN.
      source_fetched_at: maintenant.toISOString(),
      // ⚠️ `detail_fetched_at` EST ABSENT DE CET OBJET, ET C'EST LE CŒUR DE LA
      // PHASE 4.1. Une colonne non fournie n'est ni insérée ni mise à jour par
      // l'`on conflict` : une fiche jamais hydratée reste donc à NULL — le
      // lookup GTIN partira —, et une fiche hydratée il y a 29 jours GARDE sa
      // date — son TTL ne repart pas pour trente jours parce que quelqu'un a
      // tapé son nom dans une barre de recherche.
      //
      // L'écrire à `maintenant` ici serait exactement le défaut corrigé : une
      // recherche prétendrait avoir chargé une fiche complète qu'elle n'a
      // jamais vue.
    });
  }

  if (aEcrire.length === 0) {
    return { ecrits: conservesTelsQuels, rafraichis: 0, conserves: conservesTelsQuels.length };
  }

  const { data, error } = await admin
    .from("food_products")
    .upsert(aEcrire as never, { onConflict: "gtin" })
    .select(COLONNES);

  if (error) {
    console.error(`[Supabase] écriture en lot food_products : ${error.message}`);
    // L'écriture a échoué, mais les produits restent AFFICHABLES : on rend ce
    // qui était déjà en cache. Ceux qui n'y sont pas n'ont pas d'identifiant
    // et ne seront pas consommables — mieux vaut une liste partielle qu'un
    // écran d'erreur pour une panne d'écriture.
    return { ecrits: conservesTelsQuels, rafraichis: 0, conserves: conservesTelsQuels.length };
  }

  const ecrits = ((data ?? []) as unknown as LigneProduit[]).map((ligne) =>
    produitDepuisLigne(ligne, maintenant),
  );
  return {
    ecrits: [...ecrits, ...conservesTelsQuels],
    rafraichis: ecrits.length,
    conserves: conservesTelsQuels.length,
  };
}
