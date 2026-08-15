import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/supabase";
import type { CatalogFood, ProduitLocal } from "@/lib/supabase/consumed-meals";
import { borneMaximale } from "@/lib/nutrition/meal-choice-solver";
import type { ChoiceOption } from "@/lib/nutrition/plan-v2-week";

/**
 * N1.2 — LA BIBLIOTHÈQUE DE LISTES D'ALIMENTS DU COACH.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * UNE LISTE N'EST QU'UN RANGEMENT
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Aucune fonction de ce fichier n'écrit ni ne lit un rôle nutritionnel, une
 * macro, une quantité ou une portion. Une liste porte un NOM LIBRE et des
 * IDENTITÉS d'aliments réels — rien d'autre. Les valeurs nutritionnelles sont
 * lues à la source (`food_catalog`, `food_products`) au moment de l'affichage,
 * jamais recopiées : un modèle de bibliothèque pointe vers un aliment VIVANT,
 * comme un favori.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ÉCRITURES DIRECTES, PAS DE RPC — ET C'EST UN CHOIX DU SCHÉMA N1.1
 * ────────────────────────────────────────────────────────────────────────────
 * `food_lists` et `food_list_items` accordent `insert/update/delete` à
 * `authenticated`, filtrés par la RLS `coach_id = current_coach_id()`. Il n'y a
 * ici ni macro à figer côté serveur, ni transaction multi-tables : le modèle de
 * `food-favorites.ts` suffit, et une RPC n'apporterait qu'une migration de plus.
 *
 * ⚠️ Les deux tables sont absentes de `types/supabase.ts`, qui n'est rempli
 * qu'au fur et à mesure des usages réels. D'où les casts, exactement comme dans
 * `consumed-meals.ts` et `food-products.ts`.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

/**
 * Pour les ÉCRITURES : on trace, on ne jette pas — l'appelant lit le booléen
 * ou l'union rendue. C'est la convention des writers du dépôt.
 */
function devWarn(contexte: string, error: { message: string } | null | undefined): void {
  if (error) {
    console.error(`[Supabase] ${contexte} : ${error.message}`);
  }
}

/**
 * ────────────────────────────────────────────────────────────────────────────
 * POUR LES LECTURES : ON JETTE. « RIEN » ET « JE NE SAIS PAS » NE SONT PAS
 * LA MÊME CHOSE.
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Un `data ?? []` après une erreur est un mensonge silencieux : il rend
 * « aucune liste » quand la requête a échoué, « introuvable » quand la lecture
 * de la liste a échoué, et « liste vide » quand ce sont les aliments qui n'ont
 * pas pu être lus. Le coach voit alors un écran calme et faux, et peut
 * reconstruire par-dessus une bibliothèque qu'il croit vide.
 *
 * Les deux hooks (`useFoodLists`, `useFoodList`) ont déjà un `try/catch` qui
 * pose un état d'erreur : jeter est donc la voie la plus directe pour leur
 * rendre la distinction, et elle suit la convention de `RpcConsommationError`
 * (`consumed-meals.ts`) — une classe nommée, pas un `Error` anonyme.
 */
export class ErreurLectureFoodLists extends Error {
  readonly contexte: string;
  readonly code: string | null;

  constructor(contexte: string, error: { message: string; code?: string }) {
    super(`${contexte} : ${error.message}`);
    this.name = "ErreurLectureFoodLists";
    this.contexte = contexte;
    this.code = error.code ?? null;
  }
}

/** Jette si la lecture a échoué. Ne dit rien d'un résultat simplement vide. */
function exigerLecture(
  contexte: string,
  error: { message: string; code?: string } | null | undefined,
): void {
  if (error) {
    console.error(`[Supabase] ${contexte} : ${error.message}`);
    throw new ErreurLectureFoodLists(contexte, error);
  }
}

/** L'identité d'un aliment : l'une OU l'autre, jamais les deux, jamais du texte. */
export type CibleAliment =
  | { readonly type: "aliment"; readonly id: string }
  | { readonly type: "produit"; readonly id: string };

/** Une liste vue depuis l'index : son nom, son compte, son état. */
export interface FoodListSummary {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: string | null;
  readonly nbAliments: number;
  readonly updatedAt: string;
}

/** Un aliment d'une liste, résolu contre sa source vivante. */
export type FoodListItem = {
  readonly id: string;
  readonly position: number;
  /**
   * N1.5.1 — LA PORTION STANDARD DE L'IDENTITÉ, lue à la source.
   *
   * ⚠️ LECTURE SEULE DANS CE LOT. Sur un aliment GLOBAL, seule
   * `food_catalog_manage_admin` autorise l'écriture ; sur un produit, la table
   * est en lecture seule pour `authenticated` (revoke all puis grant select).
   * L'écran de liste l'AFFICHE donc, et ne l'écrit jamais.
   */
  readonly portionStandard: number | null;
  /**
   * N1.5.1 — LA PORTION CHOISIE PAR LE COACH POUR CETTE LISTE-CI.
   *
   * ⚠️ ELLE APPARTIENT À LA LIGNE DE LISTE, PAS À L'ALIMENT. La même whey peut
   * valoir 25 g ici et 35 g dans une autre liste, sans que le standard bouge.
   * `null` = pas d'override, on retombe sur le standard.
   */
  readonly portionOverride: number | null;
  /**
   * N1.5.2 — LA QUANTITÉ MINIMALE posée par le coach POUR CETTE LISTE.
   *
   * ⚠️ CONTRAINTE DURE, pas une préférence : le solveur ne descendra jamais en
   * dessous. `null` = aucun minimum, et le minimum effectif vaut zéro.
   * ⚠️ AUCUN STANDARD GLOBAL : il n'existe pas de minimum sur l'identité.
   */
  readonly minimumOverride: number | null;
} & (
  | { readonly source: "aliment"; readonly aliment: CatalogFood }
  | { readonly source: "produit"; readonly produit: ProduitLocal }
);

export interface FoodListDetail {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: string | null;
  readonly items: readonly FoodListItem[];
}

/** Le résultat d'un ajout — « déjà présent » n'est PAS une erreur. */
export type ResultatAjout = "ajoute" | "deja-present" | "erreur";

interface LigneListe {
  id: string;
  name: string;
  archived_at: string | null;
  updated_at: string;
}

interface LigneItem {
  id: string;
  list_id: string;
  position: number;
  catalog_food_id: string | null;
  product_id: string | null;
  preferred_quantity_override: number | string | null;
  minimum_quantity_override: number | string | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   LECTURE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Les listes du coach connecté. La RLS fait le filtrage par propriétaire : ce
 * n'est pas au client de nommer son coach, et le lui demander ouvrirait la
 * porte à ce qu'il en nomme un autre.
 *
 * Les archivées ne sortent pas par défaut — elles ne sont pas supprimées pour
 * autant, et `avecArchivees` les rend.
 */
export async function listerFoodLists(
  supabase: TypedSupabaseClient,
  options: { readonly avecArchivees?: boolean } = {},
): Promise<readonly FoodListSummary[]> {
  const requête = supabase
    .from("food_lists")
    .select("id, name, archived_at, updated_at")
    .order("name", { ascending: true });

  const { data, error } = options.avecArchivees
    ? await requête
    : await requête.is("archived_at", null);
  exigerLecture("listerFoodLists", error);
  const listes = (data ?? []) as unknown as LigneListe[];
  if (listes.length === 0) return [];

  // ⚠️ UNE SEULE REQUÊTE POUR TOUS LES COMPTES, jamais une par liste. Vingt
  // listes feraient vingt allers-retours, et le coach le sentirait.
  const { data: items, error: erreurItems } = await supabase
    .from("food_list_items")
    .select("list_id")
    .in("list_id", listes.map((l) => l.id));
  // ⚠️ UN COMPTAGE RATÉ N'EST PAS UN COMPTE DE ZÉRO. « 0 aliment » sur une
  // liste garnie ferait croire à une perte, et pousserait à la re-remplir.
  exigerLecture("listerFoodLists (compte)", erreurItems);

  const compte = new Map<string, number>();
  for (const ligne of (items ?? []) as unknown as { list_id: string }[]) {
    compte.set(ligne.list_id, (compte.get(ligne.list_id) ?? 0) + 1);
  }

  return listes.map((l) => ({
    id: l.id,
    name: l.name,
    archivedAt: l.archived_at,
    updatedAt: l.updated_at,
    nbAliments: compte.get(l.id) ?? 0,
  }));
}

/**
 * Une liste et ses aliments, résolus contre leurs sources VIVANTES.
 *
 * ⚠️ Un aliment dont la source a disparu est SILENCIEUSEMENT OMIS plutôt que
 * rendu à moitié. Le `on delete restrict` de N1.1 rend le cas presque
 * impossible ; s'il survenait, afficher une ligne sans nom ni macros serait
 * pire que ne rien afficher.
 */
export async function lireFoodList(
  supabase: TypedSupabaseClient,
  listId: string,
): Promise<FoodListDetail | null> {
  const { data: liste, error } = await supabase
    .from("food_lists")
    .select("id, name, archived_at, updated_at")
    .eq("id", listId)
    .maybeSingle();
  // ⚠️ `null` NE DOIT VOULOIR DIRE QU'UNE SEULE CHOSE : « pas de ligne visible »
  // — liste d'un autre coach ou liste disparue. Une requête en échec qui
  // rendrait `null` ferait afficher « introuvable » sur une liste bien vivante.
  exigerLecture("lireFoodList", error);
  if (!liste) return null;
  const l = liste as unknown as LigneListe;

  const { data: brutes, error: erreurItems } = await supabase
    .from("food_list_items")
    .select("id, list_id, position, catalog_food_id, product_id, preferred_quantity_override, minimum_quantity_override")
    .eq("list_id", listId)
    .order("position", { ascending: true });
  // ⚠️ UNE LISTE AFFICHÉE VIDE EST UNE INVITATION À LA RE-REMPLIR — puis à
  // buter sur « déjà présent » partout. Un échec de lecture ne doit jamais
  // ressembler à une liste vide.
  exigerLecture("lireFoodList (items)", erreurItems);
  const items = (brutes ?? []) as unknown as LigneItem[];

  const idsAliments = items.map((i) => i.catalog_food_id).filter((x): x is string => x !== null);
  const idsProduits = items.map((i) => i.product_id).filter((x): x is string => x !== null);

  const [aliments, produits] = await Promise.all([
    lireAliments(supabase, idsAliments),
    lireProduits(supabase, idsProduits),
  ]);

  const resolus: FoodListItem[] = [];
  for (const item of items) {
    // ⚠️ `numeric` ARRIVE EN CHAÎNE VIA POSTGREST. La conversion se fait ici,
    // une fois, et une valeur non exploitable redevient « pas de portion »
    // plutôt qu'un `NaN` qui contaminerait le solveur.
    const override = nombrePositif(item.preferred_quantity_override);
    const minimum = nombrePositif(item.minimum_quantity_override);
    if (item.catalog_food_id !== null) {
      const aliment = aliments.map.get(item.catalog_food_id);
      if (aliment) {
        resolus.push({
          id: item.id,
          position: item.position,
          portionStandard: aliments.standards.get(item.catalog_food_id) ?? null,
          portionOverride: override,
          minimumOverride: minimum,
          source: "aliment",
          aliment,
        });
      }
      continue;
    }
    if (item.product_id !== null) {
      const produit = produits.map.get(item.product_id);
      if (produit) {
        resolus.push({
          id: item.id,
          position: item.position,
          portionStandard: produits.standards.get(item.product_id) ?? null,
          portionOverride: override,
          minimumOverride: minimum,
          source: "produit",
          produit,
        });
      }
    }
  }

  return { id: l.id, name: l.name, archivedAt: l.archived_at, items: resolus };
}

/**
 * N1.5.1 — un nombre STRICTEMENT POSITIF, ou `null`.
 *
 * ⚠️ ON NE FABRIQUE JAMAIS UNE PORTION. `null`, `''`, `0`, un négatif ou un
 * texte illisible ne sont pas des portions : ils redeviennent « pas d'avis ».
 * Les contraintes de base disent déjà `> 0` ; ceci protège de ce qui n'est pas
 * passé par elles.
 */
function nombrePositif(valeur: number | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined || valeur === "") return null;
  const n = Number(valeur);
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface IdentitesResolues<T> {
  readonly map: Map<string, T>;
  /** id → portion STANDARD de l'identité, `null` quand elle n'en a pas. */
  readonly standards: Map<string, number | null>;
}

async function lireAliments(
  supabase: TypedSupabaseClient,
  ids: readonly string[],
): Promise<IdentitesResolues<CatalogFood>> {
  if (ids.length === 0) return { map: new Map(), standards: new Map() };
  const { data, error } = await supabase
    .from("food_catalog")
    .select(
      "id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, piece_weight_g, preferred_quantity",
    )
    .in("id", [...ids]);
  // Même règle : un aliment non résolu est SILENCIEUSEMENT OMIS de la liste
  // (source disparue). Confondre cette omission-là avec un échec de requête
  // ferait disparaître des aliments bien présents.
  exigerLecture("lireAliments", error);
  const map = new Map<string, CatalogFood>();
  const standards = new Map<string, number | null>();
  for (const f of (data ?? []) as unknown as {
    id: string;
    name: string;
    nutrition_unit: string;
    protein_per_100: number;
    carb_per_100: number;
    fat_per_100: number;
    piece_weight_g: number | null;
    preferred_quantity: number | string | null;
  }[]) {
    if (f.nutrition_unit !== "g" && f.nutrition_unit !== "ml") continue;
    map.set(f.id, {
      id: f.id,
      name: f.name,
      nutritionUnit: f.nutrition_unit,
      proteinPer100: Number(f.protein_per_100),
      carbPer100: Number(f.carb_per_100),
      fatPer100: Number(f.fat_per_100),
      pieceWeightG: f.piece_weight_g === null ? null : Number(f.piece_weight_g),
    });
    standards.set(f.id, nombrePositif(f.preferred_quantity));
  }
  return { map, standards };
}

async function lireProduits(
  supabase: TypedSupabaseClient,
  ids: readonly string[],
): Promise<IdentitesResolues<ProduitLocal>> {
  if (ids.length === 0) return { map: new Map(), standards: new Map() };
  const { data, error } = await supabase
    .from("food_products")
    .select(
      "id, gtin, product_name, brand, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, image_url, detail_fetched_at, preferred_quantity",
    )
    .in("id", [...ids]);
  exigerLecture("lireProduits", error);
  const map = new Map<string, ProduitLocal>();
  const standards = new Map<string, number | null>();
  for (const p of (data ?? []) as unknown as {
    id: string;
    gtin: string;
    product_name: string;
    brand: string | null;
    nutrition_unit: string;
    protein_per_100: number;
    carb_per_100: number;
    fat_per_100: number;
    image_url: string | null;
    detail_fetched_at: string | null;
    preferred_quantity: number | string | null;
  }[]) {
    if (p.nutrition_unit !== "g" && p.nutrition_unit !== "ml") continue;
    map.set(p.id, {
      id: p.id,
      gtin: p.gtin,
      name: p.product_name,
      brand: p.brand,
      nutritionUnit: p.nutrition_unit,
      proteinPer100: Number(p.protein_per_100),
      carbPer100: Number(p.carb_per_100),
      fatPer100: Number(p.fat_per_100),
      imageUrl: p.image_url,
      hydratee: p.detail_fetched_at !== null,
    });
    // ⚠️ TOUJOURS NULL AUJOURD'HUI, ET C'EST NORMAL. `food_products` est en
    // lecture seule pour `authenticated` : la colonne existe pour la capacité,
    // aucun chemin ne l'écrit encore. La lire coûte zéro requête de plus et
    // évite d'avoir un jour deux résolutions différentes.
    standards.set(p.id, nombrePositif(p.preferred_quantity));
  }
  return { map, standards };
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.5.1 — LA PORTION PRÉFÉRÉE
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * LA HIÉRARCHIE, EN UNE LIGNE ET UN SEUL ENDROIT.
 *
 *     override du coach  ??  standard de l'identité  ??  aucune préférence
 *
 * ⚠️ ELLE EST RÉSOLUE ICI, ET NULLE PART AILLEURS. Ni la RPC ni l'écran élève
 * ne la recalculent : la RPC reçoit une valeur DÉJÀ résolue et se contente de
 * la figer, exactement comme pour l'identité. Deux résolutions divergeraient
 * au premier ajustement.
 *
 * ⚠️ ET `null` EST UNE RÉPONSE, PAS UN TROU. « Personne n'a d'avis sur cet
 * aliment » est le cas de la quasi-totalité du catalogue, et le solveur sait
 * parfaitement le traiter — il retombe sur son comportement N1.5.
 */
export function portionEffective(item: FoodListItem): number | null {
  return item.portionOverride ?? item.portionStandard ?? null;
}

/** L'unité dans laquelle la portion d'un item s'exprime : celle de l'identité. */
export function uniteDePortion(item: FoodListItem): "g" | "ml" {
  return item.source === "aliment" ? item.aliment.nutritionUnit : item.produit.nutritionUnit;
}

/**
 * Pose — ou RETIRE — l'override de portion d'une ligne de liste.
 *
 * ⚠️ `null` N'EST PAS UNE ERREUR : c'est « reviens au standard ». Le coach doit
 * pouvoir défaire sa personnalisation sans retirer puis remettre l'aliment.
 *
 * ⚠️ ZÉRO ET NÉGATIF SONT REFUSÉS ICI AUSSI. La contrainte de base le dirait,
 * mais un aller-retour réseau pour apprendre qu'on a tapé « 0 » est une
 * mauvaise réponse à une faute de frappe.
 *
 * Convention du dépôt : un writer rend un booléen et ne lève jamais.
 */
/**
 * Pose — ou RETIRE — la quantité minimale d'une ligne de liste.
 *
 * ⚠️ PREMIÈRE DES DEUX PROTECTIONS CONTRE `minimum > plafond`. Refuser ici
 * évite au coach d'enregistrer une contrainte que le calcul ne pourra pas
 * honorer. La seconde protection vit dans `optionCalculable` : elle couvre les
 * snapshots DÉJÀ figés, que ce writer ne peut plus atteindre.
 *
 * ⚠️ ET LE PLAFOND N'EST PAS RECOPIÉ ICI : il est importé du solveur, qui en
 * est la seule source. Deux constantes divergeraient au premier ajustement.
 */
export async function definirMinimumOverride(
  supabase: TypedSupabaseClient,
  itemId: string,
  unite: "g" | "ml",
  valeur: number | null,
): Promise<boolean> {
  if (valeur !== null && (!Number.isFinite(valeur) || valeur <= 0)) return false;
  if (valeur !== null && valeur > borneMaximale(unite)) return false;
  const { error } = await supabase
    .from("food_list_items")
    .update({ minimum_quantity_override: valeur } as never)
    .eq("id", itemId);
  devWarn("definirMinimumOverride", error);
  return !error;
}

export async function definirPortionOverride(
  supabase: TypedSupabaseClient,
  itemId: string,
  valeur: number | null,
): Promise<boolean> {
  if (valeur !== null && (!Number.isFinite(valeur) || valeur <= 0)) return false;
  const { error } = await supabase
    .from("food_list_items")
    .update({ preferred_quantity_override: valeur } as never)
    .eq("id", itemId);
  devWarn("definirPortionOverride", error);
  return !error;
}

/* ══════════════════════════════════════════════════════════════════════════
   ÉCRITURE
   ══════════════════════════════════════════════════════════════════════════ */

/** Le nom, nettoyé. Vide = refusé : la contrainte `name_not_blank` le dirait. */
export function nomPropre(valeur: string): string {
  return valeur.trim().replace(/\s+/g, " ");
}

export async function creerFoodList(
  supabase: TypedSupabaseClient,
  coachId: string,
  nom: string,
): Promise<string | null> {
  const propre = nomPropre(nom);
  if (propre === "") return null;
  const { data, error } = await supabase
    .from("food_lists")
    .insert({ coach_id: coachId, name: propre } as never)
    .select("id")
    .maybeSingle();
  devWarn("creerFoodList", error);
  return (data as unknown as { id: string } | null)?.id ?? null;
}

export async function renommerFoodList(
  supabase: TypedSupabaseClient,
  listId: string,
  nom: string,
): Promise<boolean> {
  const propre = nomPropre(nom);
  if (propre === "") return false;
  const { error } = await supabase
    .from("food_lists")
    .update({ name: propre, updated_at: new Date().toISOString() } as never)
    .eq("id", listId);
  devWarn("renommerFoodList", error);
  return !error;
}

/**
 * Archiver, jamais supprimer.
 *
 * ⚠️ Une liste archivée sort du sélecteur et NE CASSE RIEN : les repas déjà
 * construits ne la lisent pas — leurs options sont un instantané indépendant
 * (`meal_choice_options`), sans clé étrangère vers `food_list_items`.
 */
export async function archiverFoodList(
  supabase: TypedSupabaseClient,
  listId: string,
  archiver: boolean,
): Promise<boolean> {
  const { error } = await supabase
    .from("food_lists")
    .update({
      archived_at: archiver ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", listId);
  devWarn("archiverFoodList", error);
  return !error;
}

/**
 * Ajoute un aliment à la fin de la liste.
 *
 * ⚠️ « DÉJÀ PRÉSENT » N'EST PAS UNE ERREUR. Le coach reclique sur un aliment
 * qu'il a déjà mis : l'index unique partiel de N1.1 refuse la ligne avec le
 * code 23505, et on le traduit en information, pas en échec. C'est exactement
 * ce que fait `ajouterFavori` d'A5.
 */
export async function ajouterAlimentAListe(
  supabase: TypedSupabaseClient,
  listId: string,
  cible: CibleAliment,
): Promise<ResultatAjout> {
  // ⚠️ TROIS TENTATIVES, PAS UNE BOUCLE. Une collision de POSITION vient d'une
  // course (deux onglets, deux ajouts) : relire la dernière position et
  // réessayer la résout. Un nombre fixe de tentatives borne le pire cas ; une
  // boucle « jusqu'à réussite » tournerait indéfiniment sur une panne durable.
  for (let tentative = 1; tentative <= TENTATIVES_AJOUT; tentative += 1) {
    const { data, error: erreurLecture } = await supabase
      .from("food_list_items")
      .select("position")
      .eq("list_id", listId)
      .order("position", { ascending: false })
      .limit(1);
    // ⚠️ SANS CETTE POSITION, ON N'AJOUTE PAS. Un échec de lecture traité comme
    // « liste vide » viserait la position 1 — occupée — et la collision qui en
    // résulterait serait notre faute, pas une course.
    if (erreurLecture) {
      devWarn("ajouterAlimentAListe (position)", erreurLecture);
      return "erreur";
    }
    const dernieres = (data ?? []) as unknown as { position: number }[];
    const position = (dernieres[0]?.position ?? 0) + 1;

    const { error } = await supabase.from("food_list_items").insert({
      list_id: listId,
      position,
      catalog_food_id: cible.type === "aliment" ? cible.id : null,
      product_id: cible.type === "produit" ? cible.id : null,
    } as never);
    if (!error) return "ajoute";

    const violation = contrainteViolee(error);
    if (violation === "identite") return "deja-present";
    if (violation === "position" && tentative < TENTATIVES_AJOUT) continue;
    devWarn("ajouterAlimentAListe", error);
    return "erreur";
  }
  return "erreur";
}

/** Le nombre de tentatives d'ajout, collisions de position comprises. */
export const TENTATIVES_AJOUT = 3;

/**
 * QUELLE contrainte a été violée — et pas seulement « une contrainte unique ».
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `23505` NE VEUT PAS DIRE « DÉJÀ PRÉSENT »
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Trois index uniques peuvent rendre ce code sur `food_list_items` :
 *   - `food_list_items_food_unique`    → cet ALIMENT est déjà dans la liste ;
 *   - `food_list_items_product_unique` → ce PRODUIT est déjà dans la liste ;
 *   - `food_list_items_position_unique` → la POSITION est prise. Ce n'est PAS
 *     un doublon d'aliment : c'est une course entre deux ajouts. Annoncer
 *     « aliment déjà présent » serait faux, et le coach chercherait dans sa
 *     liste un aliment qui n'y est pas.
 *
 * On lit d'abord les NOMS d'index, puis, en repli, les COLONNES citées par le
 * `details` de PostgREST (« Key (list_id, position)=(…) already exists. ») :
 * si un jour un index était renommé, la seconde lecture tiendrait encore.
 */
function contrainteViolee(
  error: { code?: string; message?: string; details?: string } | null,
): "identite" | "position" | "autre" {
  if (!error || error.code !== "23505") return "autre";
  const texte = `${error.message ?? ""} ${error.details ?? ""}`;
  if (texte.includes("food_list_items_food_unique")) return "identite";
  if (texte.includes("food_list_items_product_unique")) return "identite";
  if (texte.includes("food_list_items_position_unique")) return "position";
  if (texte.includes("catalog_food_id") || texte.includes("product_id")) return "identite";
  if (texte.includes("position")) return "position";
  // Un `23505` qu'on ne sait pas nommer n'est PAS un doublon d'aliment : on le
  // rend comme une vraie erreur plutôt que de deviner en faveur du silence.
  return "autre";
}

/**
 * Retire un aliment, puis RENUMÉROTE pour ne laisser aucun trou.
 *
 * ⚠️ Cela ne touche NI le catalogue, NI les repas déjà construits : leurs
 * options sont une copie. C'est la garantie de snapshot de N1.1, et un test la
 * garde.
 */
export async function retirerAlimentDeListe(
  supabase: TypedSupabaseClient,
  listId: string,
  itemId: string,
): Promise<boolean> {
  const { error } = await supabase.from("food_list_items").delete().eq("id", itemId);
  devWarn("retirerAlimentDeListe", error);
  if (error) return false;

  const { data, error: erreurLecture } = await supabase
    .from("food_list_items")
    .select("id, list_id, position, catalog_food_id, product_id")
    .eq("list_id", listId)
    .order("position", { ascending: true });
  // ⚠️ LE DELETE EST PASSÉ, LA RELECTURE NON — ET ON NE PEUT PAS L'ANNULER.
  // Le navigateur n'ouvre pas de transaction : prétendre revenir en arrière
  // serait un mensonge de plus. Ce qu'on peut faire, c'est ne pas en ajouter
  // un premier. `data ?? []` appellerait `ecrirePositions([])`, qui rend `true`
  // sans rien écrire : « retrait + renumérotation réussis » alors que la
  // renumérotation n'a jamais eu lieu, et que les positions gardent leur trou.
  //
  // Le booléen dit donc simplement : l'opération complète n'a pas abouti.
  // L'écran relit ensuite le serveur, et le coach voit l'état réel — un
  // aliment retiré, des positions à renuméroter, ce que le prochain
  // réordonnancement corrigera.
  if (erreurLecture) {
    devWarn("retirerAlimentDeListe (relecture)", erreurLecture);
    return false;
  }
  const restants = (data ?? []) as unknown as LigneItem[];
  // Liste devenue vide : rien à renuméroter, et c'est un succès.
  return await ecrirePositions(supabase, listId, restants);
}

/**
 * Réordonne la liste selon l'ordre d'identifiants fourni.
 *
 * ⚠️ EN DEUX INSTRUCTIONS, ET C'EST LA CONTRAINTE D'UNICITÉ QUI L'IMPOSE.
 * `food_list_items_position_unique` n'est PAS déferrable : une simple
 * permutation « 1 devient 2 » échoue immédiatement, puisque 2 existe encore.
 * Mesuré sur la base — l'erreur est `duplicate key … (list_id, position)`.
 *
 * On décale donc TOUTES les positions de +1000 en une seule instruction (aucun
 * chevauchement possible avec 1..N), puis on écrit les positions finales en un
 * seul `upsert`. Deux allers-retours, pas 2N.
 *
 * ⚠️ CE N'EST PAS ATOMIQUE, et il faut le savoir : le navigateur ne peut pas
 * ouvrir de transaction. Si la seconde instruction échoue, les positions
 * restent à 1001…100N — un état qui reste VALIDE (unique, ≥ 1, dans le bon
 * ordre) et que relancer l'opération corrige. Le lecteur, lui, trie par
 * position et ne dépend jamais du fait qu'elle commence à 1.
 */
export async function reordonnerFoodList(
  supabase: TypedSupabaseClient,
  listId: string,
  idsDansLOrdre: readonly string[],
): Promise<boolean> {
  const { data, error } = await supabase
    .from("food_list_items")
    .select("id, list_id, position, catalog_food_id, product_id")
    .eq("list_id", listId);
  // ⚠️ UNE LECTURE EN PANNE N'EST PAS UNE LISTE VIDE. `data ?? []` rendrait
  // ici `lignes.length === 0`, donc `true` — et l'écran annoncerait un
  // réordonnancement réussi alors qu'AUCUNE écriture n'aurait été tentée. On
  // sort avant d'écrire quoi que ce soit : rien n'est touché, et le booléen
  // dit la vérité.
  if (error) {
    devWarn("reordonnerFoodList (lecture)", error);
    return false;
  }
  const lignes = (data ?? []) as unknown as LigneItem[];
  // Une liste réellement vide, elle, n'a rien à réordonner : c'est un succès.
  if (lignes.length === 0) return true;

  const parId = new Map(lignes.map((l) => [l.id, l]));
  // Les identifiants inconnus sont ignorés ; ceux qui manquent sont remis à la
  // fin, dans leur ordre actuel. Un appel partiel ne doit pas perdre de ligne.
  const ordonnees: LigneItem[] = [];
  for (const id of idsDansLOrdre) {
    const ligne = parId.get(id);
    if (ligne) {
      ordonnees.push(ligne);
      parId.delete(id);
    }
  }
  for (const restante of [...parId.values()].sort((a, b) => a.position - b.position)) {
    ordonnees.push(restante);
  }

  return await ecrirePositions(supabase, listId, ordonnees);
}

/** Le décalage à l'écart, puis les positions finales. DEUX instructions. */
export const DECALAGE_REORDONNANCEMENT = 1000;

async function ecrirePositions(
  supabase: TypedSupabaseClient,
  listId: string,
  ordonnees: readonly LigneItem[],
): Promise<boolean> {
  if (ordonnees.length === 0) return true;

  const ligneComplete = (ligne: LigneItem, position: number) => ({
    id: ligne.id,
    list_id: listId,
    position,
    catalog_food_id: ligne.catalog_food_id,
    product_id: ligne.product_id,
  });

  // ⚠️ POURQUOI DEUX PASSES, ET PAS UNE. PostgREST ne sait pas écrire une
  // EXPRESSION (`position = position + 1000`) : il ne pose que des valeurs
  // littérales. Et la contrainte d'unicité n'étant pas déferrable, écrire
  // directement les positions finales échoue dès qu'une seule permutation
  // recycle une position encore occupée.
  //
  // On envoie donc tout le monde au-dessus de 1000 — aucune valeur ne peut y
  // rencontrer une position existante, qui vaut au plus le nombre d'aliments —
  // puis on écrit 1..N, où plus rien n'est occupé. Chaque passe est UN seul
  // `insert … on conflict do update`, donc deux allers-retours au total.
  const àLécart = await supabase.from("food_list_items").upsert(
    ordonnees.map((ligne, index) =>
      ligneComplete(ligne, DECALAGE_REORDONNANCEMENT + index + 1),
    ) as never,
    { onConflict: "id" },
  );
  if (àLécart.error) {
    devWarn("ecrirePositions (décalage)", àLécart.error);
    return false;
  }

  const { error } = await supabase.from("food_list_items").upsert(
    ordonnees.map((ligne, index) => ligneComplete(ligne, index + 1)) as never,
    { onConflict: "id" },
  );
  devWarn("ecrirePositions (positions finales)", error);
  return !error;
}

/**
 * Duplique une liste : nouvelle identité, mêmes aliments, même ordre, AUCUN
 * lien avec la source.
 *
 * ⚠️ La copie est indépendante par CONSTRUCTION, pas par convention : il
 * n'existe aucune colonne reliant une liste à celle dont elle est issue.
 * Modifier la copie ne peut donc pas atteindre l'original, et réciproquement.
 */
export async function dupliquerFoodList(
  supabase: TypedSupabaseClient,
  coachId: string,
  listId: string,
  nouveauNom: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("food_list_items")
    .select("id, list_id, position, catalog_food_id, product_id")
    .eq("list_id", listId)
    .order("position", { ascending: true });
  devWarn("dupliquerFoodList (lecture)", error);
  if (error) return null;
  const items = (data ?? []) as unknown as LigneItem[];

  const nouvelId = await creerFoodList(supabase, coachId, nouveauNom);
  if (!nouvelId) return null;
  if (items.length === 0) return nouvelId;

  const { error: erreurCopie } = await supabase.from("food_list_items").insert(
    items.map((item, index) => ({
      list_id: nouvelId,
      position: index + 1,
      catalog_food_id: item.catalog_food_id,
      product_id: item.product_id,
    })) as never,
  );
  if (!erreurCopie) return nouvelId;

  // ────────────────────────────────────────────────────────────────────────
  // LA COPIE A ÉCHOUÉ : ON DÉFAIT CE QU'ON VIENT DE FAIRE
  // ────────────────────────────────────────────────────────────────────────
  // ⚠️ RENDRE `nouvelId` ICI SERAIT MENTIR. L'écran annoncerait une
  // duplication réussie et ouvrirait une liste vide portant le nom « — copie »,
  // que le coach croirait fidèle. Deux tables, aucune transaction depuis le
  // navigateur : le seul recours est de retirer la coquille.
  //
  // ⚠️ CE N'EST PAS LA « SUPPRESSION D'UNE LISTE » QUE L'UX INTERDIT. Cette
  // liste vient d'être créée par cette fonction, n'a JAMAIS été annoncée comme
  // un succès, n'a jamais été affichée, et ne contient rien. Aucun bouton n'y
  // mène et aucun appelant ne peut viser une autre liste que celle-là.
  devWarn("dupliquerFoodList (copie)", erreurCopie);
  const { error: erreurRetrait } = await supabase
    .from("food_lists")
    .delete()
    .eq("id", nouvelId);
  if (erreurRetrait) {
    // Le retrait lui-même a échoué. On ARCHIVE alors la coquille : elle sort
    // de l'index et du sélecteur, donc aucune copie ACTIVE et vide ne subsiste.
    // Si cela échoue aussi, il ne reste plus rien à tenter depuis le
    // navigateur — mais l'appelant, lui, a déjà la vérité : c'est un échec.
    devWarn("dupliquerFoodList (retrait de la coquille)", erreurRetrait);
    await archiverFoodList(supabase, nouvelId, true);
  }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.3 — L'INSTANTANÉ D'UNE LISTE, AU MOMENT OÙ ON L'AJOUTE À UN REPAS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Ce qu'une liste devient quand elle entre dans un repas : un LIBELLÉ et des
 * IDENTITÉS, tous deux figés ici et jamais relus ensuite.
 *
 * ⚠️ C'EST LA SEULE FONCTION QUI FAIT LE PONT bibliothèque → repas, et elle ne
 * le fait qu'une fois, à l'instant du clic. Après elle, plus aucun chemin ne
 * relie l'occurrence au modèle : c'est ce qui rend l'instantané structurel.
 */
export interface SnapshotDeListe {
  readonly label: string;
  readonly sourceListId: string;
  readonly options: readonly ChoiceOption[];
}

export async function lireSnapshotDeListe(
  supabase: TypedSupabaseClient,
  listId: string,
): Promise<SnapshotDeListe | null> {
  const liste = await lireFoodList(supabase, listId);
  if (!liste) return null;
  return {
    label: liste.name,
    sourceListId: liste.id,
    // ⚠️ `displayName` EST POSÉ ICI SANS UNE REQUÊTE DE PLUS : `lireFoodList` a
    // déjà résolu chaque item contre sa source. C'est de l'HYDRATATION, pas du
    // snapshot — l'identité reste seule à voyager vers la base.
    // ⚠️ LA PORTION EST FIGÉE ICI, AU MÊME INSTANT QUE L'IDENTITÉ, et c'est
    // ce qui rend l'instantané complet : après ce point, modifier l'override
    // ou le standard ne touche plus ce repas. `displayName`, lui, reste de
    // l'HYDRATATION — il n'est jamais renvoyé à la RPC.
    options: liste.items.map((item) => {
      const portion = portionEffective(item);
      const minimum = item.minimumOverride;
      const socle = {
        preferredQuantity: portion,
        minimumQuantity: minimum,
        // ⚠️ L'UNITÉ EST COMMUNE, ET ELLE EXISTE DÈS QU'UNE DES DEUX QUANTITÉS
        // EXISTE — un minimum SANS portion préférée est le cas le plus
        // courant. La contrainte de paire de la base dit exactement cela.
        quantityUnit: portion === null && minimum === null ? null : uniteDePortion(item),
      } as const;
      return item.source === "aliment"
        ? ({ ...socle, type: "aliment", id: item.aliment.id, displayName: item.aliment.name } as const)
        : ({
            ...socle,
            type: "produit",
            id: item.produit.id,
            displayName: item.produit.brand
              ? `${item.produit.brand} — ${item.produit.name}`
              : item.produit.name,
          } as const);
    }),
  };
}

/** « Protéines » → « Protéines — copie ». Même convention que les plans. */
export function nomDeCopie(nom: string): string {
  return `${nomPropre(nom)} — copie`;
}
