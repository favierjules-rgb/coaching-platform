import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ConsumedEntry,
  type ConsumedMeal,
  type ConsumedSourceType,
  type ConsumedUnit,
  CONSUMED_UNITS,
} from "@/lib/nutrition/consumed";
import { MEAL_SLOT_KEYS, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import {
  classerProduits,
  classerResultats,
  dedupliquerProduits,
  normaliserPourRecherche,
} from "@/lib/nutrition/recherche-aliments";
import {
  type CibleRecente,
  FENETRE_RECENTS,
  type LigneRecente,
  MAX_RECENTS,
  type Recent,
  ordonnerRecents,
} from "@/lib/nutrition/recents";
import type { Database } from "@/types/supabase";

/**
 * ACCÈS SUPABASE À LA CONSOMMATION (ALIMENTS A2).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * DEUX RÈGLES QUI GOUVERNENT TOUT CE FICHIER
 * ────────────────────────────────────────────────────────────────────────────
 * 1. AUCUNE ÉCRITURE DIRECTE. Ce module ne contient ni `insert`, ni `update`,
 *    ni `delete` sur `consumed_meals` ou `meal_entries` — et il ne le pourrait
 *    pas : la migration 20260901090000 a RETIRÉ ces privilèges au rôle
 *    `authenticated`. Toute écriture passe par une RPC `security definer`.
 *
 * 2. LE NAVIGATEUR N'ENVOIE JAMAIS DE MACRO FINALE. Il envoie une quantité,
 *    une unité, et — pour un aliment saisi à la main — les valeurs POUR 100
 *    lues sur l'emballage. Le serveur multiplie et fige l'instantané. C'est la
 *    règle bloquante du lot, et elle est structurelle, pas déclarative.
 *
 * LECTURE : deux requêtes pour une plage de dates, quelle que soit sa taille.
 * Aucun N+1, aucune requête par jour ni par repas.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(contexte: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${contexte} : ${error.message}`);
  }
}

interface ConsumedMealRow {
  id: string;
  student_id: string;
  consumed_on: string;
  kind: string;
  prescribed_meal_id: string | null;
  slot_key: string | null;
  label: string;
  position: number;
  target_kcal: number | null;
  target_protein_g: number | null;
  target_carb_g: number | null;
  target_fat_g: number | null;
}

interface MealEntryRow {
  id: string;
  consumed_meal_id: string;
  source_type: string;
  food_id: string | null;
  product_id: string | null;
  label: string;
  quantity: number;
  unit: string;
  protein_g: number;
  carb_g: number;
  fat_g: number;
  note: string | null;
  created_at: string;
}

const SOURCE_TYPES: readonly ConsumedSourceType[] = ["recipe", "catalog_food", "product", "free"];

function mapEntry(row: MealEntryRow): ConsumedEntry | null {
  // Une valeur hors vocabulaire ne peut venir que d'une base non migrée. On
  // l'écarte plutôt que de la rendre telle quelle : un `unit` inconnu
  // casserait l'affichage et le formulaire de correction.
  if (!(CONSUMED_UNITS as readonly string[]).includes(row.unit)) return null;
  if (!(SOURCE_TYPES as readonly string[]).includes(row.source_type)) return null;
  return {
    id: row.id,
    consumedMealId: row.consumed_meal_id,
    sourceType: row.source_type as ConsumedSourceType,
    foodId: row.food_id,
    productId: row.product_id ?? null,
    label: row.label,
    quantity: Number(row.quantity),
    unit: row.unit as ConsumedUnit,
    proteinG: Number(row.protein_g),
    carbG: Number(row.carb_g),
    fatG: Number(row.fat_g),
    note: row.note ?? "",
    createdAt: row.created_at,
  };
}

function mapMeal(row: ConsumedMealRow, entrées: readonly ConsumedEntry[]): ConsumedMeal | null {
  if (row.kind !== "prescribed" && row.kind !== "student") return null;
  const slot =
    row.slot_key !== null && (MEAL_SLOT_KEYS as readonly string[]).includes(row.slot_key)
      ? (row.slot_key as MealSlotKey)
      : null;

  // Un repas LIBRE n'a pas de cible — la contrainte
  // consumed_meals_student_has_no_target l'interdit en base. On rend `null`
  // plutôt qu'un objet de quatre `null`, pour que l'écran n'ait jamais à
  // décider si « 0 » veut dire « rien » ou « zéro ».
  const target =
    row.kind === "prescribed"
      ? {
          kcal: row.target_kcal === null ? null : Number(row.target_kcal),
          proteinG: row.target_protein_g === null ? null : Number(row.target_protein_g),
          carbG: row.target_carb_g === null ? null : Number(row.target_carb_g),
          fatG: row.target_fat_g === null ? null : Number(row.target_fat_g),
        }
      : null;

  return {
    id: row.id,
    studentId: row.student_id,
    consumedOn: row.consumed_on,
    kind: row.kind,
    prescribedMealId: row.prescribed_meal_id,
    slotKey: slot,
    label: row.label,
    position: Number(row.position),
    target,
    entries: entrées,
  };
}

/**
 * QUI on lit — et ce paramètre n'a PAS de valeur par défaut (A5.8).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN TYPE PLUTÔT QU'UN `studentId?: string`
 * ────────────────────────────────────────────────────────────────────────────
 * Un paramètre optionnel aurait un comportement par défaut : « ne filtre pas ».
 * Pour l'élève, ce défaut est juste — la RLS ne laisse passer qu'une personne.
 * Pour le COACH, le même défaut rend les repas de TOUS ses athlètes dans une
 * seule réponse, mélangés. Le jour où un appelant coach oublierait l'argument,
 * rien ne le signalerait : ni erreur, ni type, ni test — juste un écran qui
 * additionne deux élèves.
 *
 * Une union DISCRIMINÉE et OBLIGATOIRE supprime ce défaut. Chaque appelant doit
 * dire ce qu'il veut, et « je veux tout » n'est pas exprimable.
 */
export type CibleLecture =
  /** L'élève connecté, quel qu'il soit. La RLS tranche. Chemin élève. */
  | { readonly portee: "eleve-connecte" }
  /** UN élève nommé. Chemin coach et admin. */
  | { readonly portee: "eleve"; readonly studentId: string };

/**
 * Les repas consommés d'une PLAGE DE DATES, avec leurs aliments.
 *
 * ⚠️ LE FILTRE CLIENT NE PROTÈGE RIEN — C'EST LA RLS QUI PROTÈGE. `.eq(
 * "student_id", …)` ne remplace aucune policy : un coach qui nommerait l'élève
 * d'un confrère recevrait une liste VIDE, parce que la base refuse, pas parce
 * que cette ligne filtre. Ce que le filtre apporte est autre chose, et
 * nécessaire : DÉSAMBIGUÏSER. Sans lui, un coach de dix athlètes reçoit dix
 * journaux en un seul tas.
 */
export async function readConsumedMeals(
  supabase: TypedSupabaseClient,
  dates: readonly string[],
  cible: CibleLecture,
): Promise<readonly ConsumedMeal[]> {
  if (dates.length === 0) return [];

  const requêteRepas = supabase
    .from("consumed_meals")
    .select(
      "id, student_id, consumed_on, kind, prescribed_meal_id, slot_key, label, position, target_kcal, target_protein_g, target_carb_g, target_fat_g",
    )
    .in("consumed_on", [...dates]);

  const { data: mealRows, error: mealError } = await (cible.portee === "eleve"
    ? requêteRepas.eq("student_id", cible.studentId)
    : requêteRepas
  )
    .order("consumed_on", { ascending: true })
    .order("position", { ascending: true });
  devWarn("readConsumedMeals (consumed_meals)", mealError);
  const repas = (mealRows ?? []) as unknown as ConsumedMealRow[];
  if (repas.length === 0) return [];

  // ⚠️ LA SECONDE REQUÊTE EST FILTRÉE ELLE AUSSI, et ce n'est pas redondant.
  // Elle porte sur des `consumed_meal_id` déjà restreints à un élève, donc le
  // résultat serait le même aujourd'hui. Mais `meal_entries.student_id` existe
  // et est `not null` : le jour où la liste d'identifiants viendrait d'ailleurs
  // — une future liste de courses, un export — la borne serait toujours là.
  const requêteEntrées = supabase
    .from("meal_entries")
    .select(
      "id, consumed_meal_id, source_type, food_id, product_id, label, quantity, unit, protein_g, carb_g, fat_g, note, created_at",
    )
    .in(
      "consumed_meal_id",
      repas.map((r) => r.id),
    );

  const { data: entryRows, error: entryError } = await (cible.portee === "eleve"
    ? requêteEntrées.eq("student_id", cible.studentId)
    : requêteEntrées
  ).order("created_at", { ascending: true });
  devWarn("readConsumedMeals (meal_entries)", entryError);
  const entrées = ((entryRows ?? []) as unknown as MealEntryRow[])
    .map(mapEntry)
    .filter((e): e is ConsumedEntry => e !== null);

  return repas
    .map((row) =>
      mapMeal(
        row,
        entrées.filter((e) => e.consumedMealId === row.id),
      ),
    )
    .filter((r): r is ConsumedMeal => r !== null);
}

/** Un aliment du catalogue GLOBAL, tel que la recherche le rend. */
export interface CatalogFood {
  readonly id: string;
  readonly name: string;
  readonly nutritionUnit: "g" | "ml";
  readonly proteinPer100: number;
  readonly carbPer100: number;
  readonly fatPer100: number;
  /** `null` quand l'aliment ne dit pas ce que pèse une pièce. */
  readonly pieceWeightG: number | null;
}

/**
 * Un PRODUIT du cache local, tel que la recherche le rend à l'écran.
 *
 * Délibérément plus pauvre que le `ProduitEnCache` du serveur : ni charge
 * brute, ni dates. L'écran a besoin de savoir quoi afficher, et d'UNE chose de
 * plus — `hydratee` —, parce qu'un produit jamais chargé en détail devra
 * l'être avant d'être consommé (phase 4.1). Il n'a pas à savoir POURQUOI.
 */
export interface ProduitLocal {
  readonly id: string;
  readonly gtin: string;
  readonly name: string;
  readonly brand: string | null;
  readonly nutritionUnit: "g" | "ml";
  readonly proteinPer100: number;
  readonly carbPer100: number;
  readonly fatPer100: number;
  readonly imageUrl: string | null;
  /** Faux tant que `/api/v3.4/product/{gtin}` n'a jamais rempli cette fiche. */
  readonly hydratee: boolean;
}

/**
 * Recherche dans le catalogue GLOBAL et actif.
 *
 * Elle interroge `name` ET `slug` : le slug est accent-plié et sans
 * ponctuation (fonction `food_slug`, A1), donc « oeuf » trouve « Œuf entier »
 * sans qu'aucune extension ne soit installée. `pg_trgm` et `unaccent` ne le
 * sont pas, et A2 n'en installe aucune.
 *
 * La RLS ne rend que le catalogue global : un aliment privé de coach n'est ni
 * lisible ici, ni ajoutable — `ajouter_aliment_catalogue` le refuse aussi.
 */
/**
 * RECHERCHE LOCALE D'ALIMENTS GÉNÉRIQUES — aucun réseau externe, jamais.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI LE SLUG, ET PAS LE NOM
 * ────────────────────────────────────────────────────────────────────────────
 * MESURÉ sur la table Ciqual 2025 réellement importée, le 13/08/2026 :
 *
 *   « pates »   par le nom :   0 aliment      par le slug :  39
 *   « oeuf »    par le nom : 137 aliments     par le slug : 137 (ligature Œ comprise)
 *
 * Ciqual écrit « Pâtes ». Un `ilike '%pates%'` sur le nom ne trouve donc RIEN,
 * et la version A2 de cette fonction laissait un élève sans pâtes sur une table
 * qui en contient trente-neuf. Le `slug` — posé par `public.food_slug` dès A1 —
 * est déjà replié : accents retirés, ligatures développées. Il n'y a aucune
 * extension à installer, seulement une colonne à interroger.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI DEUX REQUÊTES
 * ────────────────────────────────────────────────────────────────────────────
 * PostgREST ne sait pas trier par pertinence, et une seule requête bornée
 * tronquerait au mauvais endroit : « pomme » a 97 correspondances dont 35
 * commencent par le terme, et une limite de 20 par ordre alphabétique n'en
 * ramenait aucune — mesuré, les vingt premières allaient de « Bar » à « Cake ».
 *
 * On demande donc SÉPARÉMENT ce qui COMMENCE par le terme (là où vivent les
 * bonnes réponses) et ce qui le CONTIENT, puis on classe côté client avec une
 * règle déterministe de quatre rangs (lib/nutrition/recherche-aliments.ts).
 * Deux requêtes bornées sur 3 330 lignes coûtent moins qu'un index de
 * pertinence qu'il faudrait installer, mesurer et maintenir.
 */
export async function searchCatalogFoods(
  supabase: TypedSupabaseClient,
  requête: string,
  limite = 20,
): Promise<readonly CatalogFood[]> {
  const terme = requête.trim();
  if (terme.length < 2) return [];
  const normalisé = normaliserPourRecherche(terme).replace(/ /g, "-");
  if (normalisé === "") return [];

  const colonnes =
    "id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, piece_weight_g";
  const base = () =>
    supabase
      .from("food_catalog")
      .select(colonnes)
      .is("owner_coach_id", null)
      .eq("status", "active");

  const [début, contient] = await Promise.all([
    base().like("slug", `${normalisé}%`).order("slug", { ascending: true }).limit(60),
    base().like("slug", `%${normalisé}%`).order("slug", { ascending: true }).limit(40),
  ]);
  devWarn("searchCatalogFoods (début)", début.error);
  devWarn("searchCatalogFoods (contient)", contient.error);

  const lignes = [...(début.data ?? []), ...(contient.data ?? [])] as unknown as {
    id: string;
    name: string;
    nutrition_unit: string;
    protein_per_100: number;
    carb_per_100: number;
    fat_per_100: number;
    piece_weight_g: number | null;
  }[];

  const uniques = [...new Map(lignes.map((f) => [f.id, f])).values()];
  const alimentsBruts = uniques
    .filter((f) => f.nutrition_unit === "g" || f.nutrition_unit === "ml")
    .map((f) => ({
      id: f.id,
      name: f.name,
      nutritionUnit: f.nutrition_unit as "g" | "ml",
      proteinPer100: Number(f.protein_per_100),
      carbPer100: Number(f.carb_per_100),
      fatPer100: Number(f.fat_per_100),
      pieceWeightG: f.piece_weight_g === null ? null : Number(f.piece_weight_g),
    }));

  return classerResultats(alimentsBruts, terme, limite);
}

/**
 * RECHERCHE LOCALE DE PRODUITS DÉJÀ EN CACHE — aucun réseau, jamais.
 *
 * Le pendant de la fonction ci-dessus pour `food_products`. Elle est lue avec
 * le client de l'ÉLÈVE : la policy `food_products_select_all` autorise la
 * lecture à tout utilisateur authentifié, et le retrait des privilèges
 * d'écriture (migration 20260903090000) garantit qu'il ne peut rien y mettre.
 *
 * Un produit n'a pas de virgule structurante dans son nom — « Skyr nature »,
 * pas « Skyr, nature » —, d'où l'utilité du rang 2 du classement : « le nom
 * commence par le terme ».
 *
 * ⚠️ `stale` n'est PAS calculé ici, et c'est délibéré : la fraîcheur d'une
 * fiche produit se mesure sur `detail_fetched_at` (phase 4.1), et cette
 * décision appartient au serveur. L'écran, lui, n'a besoin que de savoir si la
 * fiche a été hydratée — pour déclencher le lookup au moment du tap.
 */
export async function searchCachedProducts(
  supabase: TypedSupabaseClient,
  requête: string,
  limite = 20,
): Promise<readonly ProduitLocal[]> {
  const terme = requête.trim();
  if (terme.length < 2) return [];
  const motif = terme.replace(/[\\%_]/g, (c) => `\\${c}`);

  const colonnes =
    "id, gtin, product_name, brand, nutrition_unit, protein_per_100, carb_per_100, " +
    "fat_per_100, image_url, detail_fetched_at";
  const base = () => supabase.from("food_products").select(colonnes);

  const [parNom, parMarque] = await Promise.all([
    base().ilike("product_name", `%${motif}%`).order("product_name", { ascending: true }).limit(40),
    base().ilike("brand", `%${motif}%`).order("product_name", { ascending: true }).limit(20),
  ]);
  devWarn("searchCachedProducts (nom)", parNom.error);
  devWarn("searchCachedProducts (marque)", parMarque.error);

  const lignes = [...(parNom.data ?? []), ...(parMarque.data ?? [])] as unknown as {
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
  }[];

  const uniques = dedupliquerProduits(lignes.map((p) => ({ id: p.id, gtin: p.gtin, ligne: p }))).map(({ ligne: p }) => ({
    id: p.id,
    gtin: p.gtin,
    // `name` porte le NOM DU PRODUIT seul : c'est lui que le classement
    // compare au terme. La marque est affichée à part, et sert de second
    // chemin de recherche, pas de préfixe au nom.
    name: p.product_name,
    brand: p.brand,
    nutritionUnit: (p.nutrition_unit === "ml" ? "ml" : "g") as "g" | "ml",
    proteinPer100: Number(p.protein_per_100),
    carbPer100: Number(p.carb_per_100),
    fatPer100: Number(p.fat_per_100),
    imageUrl: p.image_url,
    hydratee: p.detail_fetched_at !== null,
  }));

  // A5 — UN SEUL CLASSEMENT, QUI CONNAÎT LA MARQUE.
  //
  // Avant A5, les correspondances de marque étaient ajoutées À LA SUITE de
  // toutes les correspondances de nom : un produit de la marque exactement
  // cherchée passait derrière un produit dont le nom contenait vaguement le
  // terme. `classerProduits` remet la marque exacte à sa place — rang 2, devant
  // la simple occurrence dans le nom.
  return classerProduits(uniques, terme, limite);
}

/**
 * Les unités qu'un aliment du catalogue accepte réellement.
 *
 * MIROIR EXACT de `quantite_en_base_nutritionnelle` : son unité propre, et la
 * pièce UNIQUEMENT si elle est en grammes et que `piece_weight_g` est
 * renseigné. Aucune estimation cachée — une banane sans poids de pièce n'a pas
 * de pièce, et l'écran ne doit pas la proposer pour se la faire refuser
 * ensuite.
 */
export function unitesAutorisees(aliment: CatalogFood): readonly ConsumedUnit[] {
  const unités: ConsumedUnit[] = [aliment.nutritionUnit];
  if (aliment.nutritionUnit === "g" && aliment.pieceWeightG !== null) unités.push("piece");
  return unités;
}

// ────────────────────────────────────────────────────────────────────────────
// LES RPC — le seul chemin d'écriture
// ────────────────────────────────────────────────────────────────────────────
// Chacune rend l'erreur telle que le serveur l'a nommée, sans la traduire ici :
// l'écran décide du message, et un code inconnu doit rester reconnaissable
// dans les journaux plutôt que d'être absorbé en « une erreur est survenue ».

export class RpcConsommationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "RpcConsommationError";
    this.code = code;
  }
}

async function appeler<T>(
  supabase: TypedSupabaseClient,
  nom: string,
  args: Record<string, unknown>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- les RPC de A2 ne sont pas dans les types générés tant que `supabase gen types` n'a pas été rejoué après le db push.
  const { data, error } = await (supabase as any).rpc(nom, args);
  if (error) {
    throw new RpcConsommationError(error.message ?? "ERREUR_INCONNUE", error.message ?? nom);
  }
  return data as T;
}

/**
 * Obtient — ou crée — le conteneur d'un repas PRESCRIT pour une date.
 *
 * Appelée au PREMIER ACTE RÉEL de consommation, jamais à l'affichage : le §6
 * de l'énoncé demande explicitement qu'ouvrir la page n'écrive rien.
 */
export function ouvrirRepasPrescrit(
  supabase: TypedSupabaseClient,
  mealId: string,
  date: string,
): Promise<string> {
  return appeler<string>(supabase, "ouvrir_repas_prescrit", {
    p_meal_id: mealId,
    p_consumed_on: date,
  });
}

export function creerRepasEleve(
  supabase: TypedSupabaseClient,
  date: string,
  libellé: string,
): Promise<string> {
  return appeler<string>(supabase, "creer_repas_eleve", {
    p_consumed_on: date,
    p_label: libellé,
    p_slot_key: null,
  });
}

export function renommerRepasEleve(
  supabase: TypedSupabaseClient,
  consumedMealId: string,
  libellé: string,
): Promise<void> {
  return appeler<void>(supabase, "renommer_repas_eleve", {
    p_consumed_meal_id: consumedMealId,
    p_label: libellé,
  });
}

export function supprimerRepasEleve(
  supabase: TypedSupabaseClient,
  consumedMealId: string,
): Promise<void> {
  return appeler<void>(supabase, "supprimer_repas_eleve", {
    p_consumed_meal_id: consumedMealId,
  });
}

/** Le client envoie l'aliment, la quantité et l'unité. JAMAIS une macro. */
export function ajouterAlimentCatalogue(
  supabase: TypedSupabaseClient,
  consumedMealId: string,
  foodId: string,
  quantité: number,
  unité: ConsumedUnit,
): Promise<string> {
  return appeler<string>(supabase, "ajouter_aliment_catalogue", {
    p_consumed_meal_id: consumedMealId,
    p_food_id: foodId,
    p_quantity: quantité,
    p_unit: unité,
  });
}

/**
 * PRODUIT COMMERCIAL. Contrat identique à celui du catalogue : le client
 * envoie le produit, la quantité et l'unité — jamais une macro, jamais un
 * élève. La RPC charge `food_products`, convertit et fige l'instantané.
 *
 * ⚠️ L'écran doit s'être assuré AVANT l'appel que la fiche est hydratée
 * (phase 4.1) : consommer une fiche née d'une recherche texte reviendrait à
 * consommer une unité de repli, et 250 ml pourraient devenir 250 g.
 */
export function ajouterAlimentProduit(
  supabase: TypedSupabaseClient,
  consumedMealId: string,
  productId: string,
  quantité: number,
  unité: ConsumedUnit,
): Promise<string> {
  return appeler<string>(supabase, "ajouter_aliment_produit", {
    p_consumed_meal_id: consumedMealId,
    p_product_id: productId,
    p_quantity: quantité,
    p_unit: unité,
  });
}

/**
 * Aliment SAISI À LA MAIN.
 *
 * Le client transmet les valeurs POUR 100 lues sur l'emballage — la
 * RÉFÉRENCE, jamais le RÉSULTAT. C'est le serveur qui multiplie par la
 * quantité, applique le 4/4/9 et écrit l'instantané.
 *
 * Ne crée AUCUNE entrée dans `food_catalog` : la saisie d'un élève ne devient
 * jamais une référence publiée pour tous.
 */
export function ajouterAlimentManuel(
  supabase: TypedSupabaseClient,
  consumedMealId: string,
  libellé: string,
  quantité: number,
  unité: "g" | "ml",
  protéinesPour100: number,
  glucidesPour100: number,
  lipidesPour100: number,
): Promise<string> {
  return appeler<string>(supabase, "ajouter_aliment_manuel", {
    p_consumed_meal_id: consumedMealId,
    p_label: libellé,
    p_quantity: quantité,
    p_unit: unité,
    p_protein_per_100: protéinesPour100,
    p_carb_per_100: glucidesPour100,
    p_fat_per_100: lipidesPour100,
  });
}

/**
 * Corrige la quantité d'une entrée.
 *
 * Pour un aliment du catalogue, le serveur RECHARGE `food_catalog` et
 * recalcule tout : le nouvel instantané reflète la source au moment de la
 * correction. Le navigateur ne recalcule rien.
 */
export function modifierQuantiteEntree(
  supabase: TypedSupabaseClient,
  entryId: string,
  quantité: number,
  unité: ConsumedUnit,
): Promise<void> {
  return appeler<void>(supabase, "modifier_quantite_entree", {
    p_entry_id: entryId,
    p_quantity: quantité,
    p_unit: unité,
  });
}

export function supprimerEntree(
  supabase: TypedSupabaseClient,
  entryId: string,
): Promise<void> {
  return appeler<void>(supabase, "supprimer_entree", { p_entry_id: entryId });
}

/* ══════════════════════════════════════════════════════════════════════════
   N1.6B — ENREGISTRER LE REPAS STRUCTURÉ
   ══════════════════════════════════════════════════════════════════════════ */

/** Un aliment de la proposition, tel qu'il est AFFICHÉ. */
export interface ItemStructureAEnregistrer {
  /** N1.7 — occurrence écartée : elle ne devient JAMAIS une consommation. */
  readonly ignore?: boolean;
  readonly slotId: string;
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  /**
   * ⚠️ LA QUANTITÉ ENTIÈRE AFFICHÉE, PAS LA QUANTITÉ EXACTE DU SOLVEUR.
   * L'écran dit « 163 g » ; la base doit dire 163. Envoyer `quantity` (la
   * valeur flottante d'avant l'arrondi borné) enregistrerait 162,6.
   */
  readonly quantity: number;
  readonly unit: "g" | "ml";
}

export interface ResultatEnregistrementStructure {
  readonly plannedMealId: string;
  readonly consumedMealId: string;
  /** `true` si le repas était DÉJÀ enregistré : aucune entrée n'a été créée. */
  readonly dejaEnregistre: boolean;
  readonly entreesCreees: number;
}

/**
 * N1.6B — COPIE LA PROPOSITION AFFICHÉE DANS « CE QUE J'AI MANGÉ ».
 *
 * ⚠️ AUCUNE MACRO NE PART D'ICI, ET C'EST L'INVARIANT A5. Le client envoie
 * l'identité, la quantité et l'unité ; le serveur recharge la source et
 * calcule. Envoyer les macros calculées à l'écran créerait un second modèle de
 * calcul, et rien ne garantirait qu'il dise la même chose que le premier.
 *
 * ⚠️ ATOMIQUE ET IDEMPOTENTE, EN BASE. Une erreur sur un aliment annule tout ;
 * un second appel rend le même conteneur sans créer une seule entrée. Ce n'est
 * pas le bouton désactivé qui protège — c'est `planned_meals.consumed_meal_id`.
 */
export async function enregistrerRepasStructure(
  supabase: TypedSupabaseClient,
  mealId: string,
  date: string,
  items: readonly ItemStructureAEnregistrer[],
): Promise<ResultatEnregistrementStructure> {
  const brut = await appeler<{
    planned_meal_id: string;
    consumed_meal_id: string;
    deja_enregistre: boolean;
    entrees_creees: number;
  }>(supabase, "enregistrer_repas_structure_consomme", {
    p_meal_id: mealId,
    p_consumed_on: date,
    // ⚠️ N1.7.1 — L'OCCURRENCE ÉCARTÉE PART, ELLE AUSSI. CORRECTIF D'UNE
    // ERREUR DE CE MÊME FICHIER : la version précédente la FILTRAIT, en
    // affirmant que « cette RPC-ci n'a aucune branche pour la recevoir ».
    // C'était faux, et mesuré sur la Preview : `enregistrer_repas_structure_consomme`
    // DÉLÈGUE à `enregistrer_repas_planifie` en lui passant `p_items` tel quel,
    // et celle-ci exige TOUTES les occurrences du repas. L'occurrence retirée
    // faisait donc lever CHOIX_INCOMPLET, et l'élève ne pouvait plus
    // enregistrer un repas dont il avait écarté une liste.
    //
    // ⚠️ « ELLE NE SE MANGE PAS » RESTE VRAI, et c'est la RPC qui le porte
    // désormais : depuis N1.7.1, sa boucle d'entrées saute les items marqués
    // `ignore`. Aucune `meal_entries`, aucune macro, aucun gramme — mais
    // l'occurrence est CITÉE, ce qui est la seule façon de dire « j'ai
    // répondu, et ma réponse est rien ».
    p_items: items.map((item) =>
      item.ignore
        ? { slot_id: item.slotId, ignore: true }
        : {
            slot_id: item.slotId,
            catalog_food_id: item.catalogFoodId,
            product_id: item.productId,
            quantity: item.quantity,
            unit: item.unit,
          },
    ),
  });
  return {
    plannedMealId: brut.planned_meal_id,
    consumedMealId: brut.consumed_meal_id,
    dejaEnregistre: brut.deja_enregistre === true,
    entreesCreees: Number(brut.entrees_creees ?? 0),
  };
}

/**
 * N1.6B — QUELS REPAS STRUCTURÉS SONT DÉJÀ ENREGISTRÉS.
 *
 * ⚠️ L'ÉTAT VIENT DE LA PERSISTANCE, JAMAIS D'UN `useState`. Après un
 * rafraîchissement, un changement d'appareil ou une reconnexion, le bouton doit
 * dire la vérité — et la vérité est `planned_meals.consumed_meal_id`.
 *
 * ⚠️ ET IL SURVIT À LA SUPPRESSION D'UNE ENTRÉE. Effacer une ligne dans « Ce
 * que j'ai mangé » ne réarme pas le bouton : la prescription A ENCORE ÉTÉ
 * enregistrée. L'élève corrige sa consommation avec les outils A5.
 *
 * Rend les clés `mealId|date` des repas déjà enregistrés.
 */
export async function lireRepasStructuresEnregistres(
  supabase: TypedSupabaseClient,
  dates: readonly string[],
): Promise<ReadonlySet<string>> {
  if (dates.length === 0) return new Set();
  const { data, error } = await supabase
    .from("planned_meals")
    .select("meal_id, planned_on, consumed_meal_id")
    .in("planned_on", [...dates]);
  // ⚠️ UNE LECTURE RATÉE N'EST PAS « AUCUN REPAS ENREGISTRÉ ». Le dire ferait
  // réapparaître un bouton actif sur un repas déjà enregistré, et le second
  // clic serait idempotent — mais l'élève, lui, aurait été trompé.
  devWarn("lireRepasStructuresEnregistres", error);
  if (error) return new Set();
  const lignes = (data ?? []) as unknown as {
    meal_id: string;
    planned_on: string;
    consumed_meal_id: string | null;
  }[];
  return new Set(
    lignes.filter((l) => l.consumed_meal_id !== null).map((l) => `${l.meal_id}|${l.planned_on}`),
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   COURSES C0 — VALIDER MES CHOIX (le PLANIFIÉ, pas le CONSOMMÉ)
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un aliment de la composition PRÉVUE, tel qu'il est affiché.
 *
 * ⚠️ C'EST LA MÊME FORME QUE `ItemStructureAEnregistrer`, ET CE N'EST PAS UNE
 * COÏNCIDENCE : les deux gestes envoient exactement la même chose — identité,
 * quantité entière, unité. Ce qui les distingue n'est pas la charge utile,
 * c'est la RPC appelée, donc ce qui est écrit en base. Les fusionner en un
 * seul type ferait croire à un seul geste.
 */
export interface ItemChoixAValider {
  readonly slotId: string;
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  /** ⚠️ LA QUANTITÉ ENTIÈRE AFFICHÉE, jamais le flottant du solveur. */
  readonly quantity: number;
  readonly unit: "g" | "ml";
  /**
   * N1.7 — CETTE OCCURRENCE A ÉTÉ ÉCARTÉE : « Rien ».
   *
   * ⚠️ ELLE RESTE DANS LA LISTE ENVOYÉE, ET C'EST OBLIGATOIRE. La RPC exige
   * TOUTES les occurrences du repas, exactement une fois chacune ; l'omettre
   * ferait lever `OCCURRENCE_MANQUANTE`, et « je ne prends rien » deviendrait
   * indiscernable de « j'ai oublié de répondre ».
   *
   * Les autres champs sont alors ignorés — une absence n'a ni identité ni
   * quantité.
   */
  readonly ignore?: boolean;
}

/** Un aliment retrouvé dans une composition DÉJÀ validée. */
export interface ItemValide {
  readonly slotId: string;
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  readonly quantity: number;
  readonly unit: string;
}

/** La composition validée d'un repas, à une date. */
export interface CompositionValidee {
  readonly plannedMealId: string;
  readonly mealId: string;
  readonly date: string;
  /** `true` si ce repas a AUSSI été déclaré consommé (N1.6B). */
  readonly consomme: boolean;
  readonly items: readonly ItemValide[];
  /**
   * N1.7 — LES OCCURRENCES AUXQUELLES L'ÉLÈVE A RÉPONDU « RIEN ».
   *
   * ⚠️ ELLES NE PEUVENT PAS VENIR DE `items`, ET C'EST TOUT LE PROBLÈME QUE
   * CE CHAMP RÉSOUT. Une occurrence écartée n'a AUCUNE ligne dans
   * `planned_meal_items` — les contraintes de cette table l'interdisent
   * (`quantity > 0`, exactement une identité). Sans une seconde lecture, une
   * composition relue est amputée de ses « rien », l'occurrence revient
   * « pas encore choisie », et le repas repasse « À RECOMPOSER » à chaque
   * rafraîchissement.
   *
   * ⚠️ CE CHAMP EST LA MOITIÉ LECTURE D'UNE PAIRE. La moitié écriture existe
   * depuis N1.7 (`enregistrer_repas_planifie`, branche `"ignore": true`).
   * Écrire sans relire est exactement le défaut que ce champ répare.
   */
  readonly ignorees: readonly string[];
}

/**
 * COURSES C0 — « JE PRÉVOIS CETTE COMPOSITION POUR CE REPAS ».
 *
 * ⚠️ VALIDER N'EST PAS MANGER, ET C'EST TOUT L'INTÉRÊT. Cette fonction appelle
 * `enregistrer_repas_planifie` — la RPC de N1.1, jusqu'ici invoquée uniquement
 * DEPUIS `enregistrer_repas_structure_consomme`. Elle écrit `planned_meals` et
 * `planned_meal_items`, et RIEN d'autre : ni `consumed_meals`, ni
 * `meal_entries`, ni `consumed_meal_id`. La checklist
 * `courses_c0_validation_checklist.sql` le mesure sur la source de la fonction
 * ET sur les données.
 *
 * ⚠️ AUCUNE MACRO NE PART D'ICI NON PLUS. Même invariant qu'en A5 : la
 * signature de la RPC n'a aucun paramètre pour en recevoir.
 *
 * ⚠️ AUCUNE MIGRATION N'A ÉTÉ ÉCRITE POUR CE LOT. La RPC existe, elle est
 * `security definer`, accordée à `authenticated` et révoquée pour `anon`.
 *
 * Rend l'identifiant du `planned_meal` — le même à chaque revalidation, parce
 * que l'unicité porte sur `(student_id, planned_on, meal_id)`.
 */
export async function validerChoixRepas(
  supabase: TypedSupabaseClient,
  mealId: string,
  date: string,
  items: readonly ItemChoixAValider[],
): Promise<string> {
  return appeler<string>(supabase, "enregistrer_repas_planifie", {
    p_meal_id: mealId,
    p_planned_on: date,
    p_items: items.map((item) =>
      // ⚠️ N1.7 — UNE OCCURRENCE ÉCARTÉE N'ÉMET NI IDENTITÉ NI QUANTITÉ.
      // Les envoyer à zéro ferait lever `IDENTITE_INVALIDE` puis
      // `QUANTITE_INVALIDE` : la base refuse, à juste titre, un aliment qui
      // n'en est pas un. Seul `ignore` voyage, et la RPC branche dessus AVANT
      // ces contrôles.
      item.ignore
        ? { slot_id: item.slotId, ignore: true }
        : {
            slot_id: item.slotId,
            catalog_food_id: item.catalogFoodId,
            product_id: item.productId,
            quantity: item.quantity,
            unit: item.unit,
          },
    ),
  });
}

/**
 * COURSES C0 — LES COMPOSITIONS DÉJÀ VALIDÉES, RELUES DEPUIS LA BASE.
 *
 * ⚠️ DEUX REQUÊTES, JAMAIS UNE PAR REPAS. `planned_meals` sur l'intervalle de
 * dates, puis `planned_meal_items` sur les identifiants trouvés. Un `select`
 * par jour, ou pire par repas, ferait un N+1 sur un écran qui affiche sept
 * jours.
 *
 * ⚠️ ET C'EST BIEN UNE SECONDE LECTURE DE `planned_meals`, à côté de
 * `lireRepasStructuresEnregistres`. Les fusionner économiserait une requête
 * batchée — et casserait un contrôle de N1.6B qui vérifie nommément que le
 * hook appelle ce lecteur-là. On préfère une requête de plus à un test
 * réécrit pour arranger le code.
 *
 * ⚠️ LA RESTAURATION SE FERA PAR IDENTITÉ, JAMAIS PAR NOM. Chaque item porte
 * son `choice_slot_id` et son `catalog_food_id` / `product_id` : c'est ce
 * couple qui permettra de retrouver l'option du snapshot. Chercher par libellé
 * rattacherait « Poulet » à n'importe lequel des 51 bœufs du catalogue.
 *
 * Rend une carte `mealId|date` → composition.
 */
export async function lireCompositionsValidees(
  supabase: TypedSupabaseClient,
  dates: readonly string[],
): Promise<ReadonlyMap<string, CompositionValidee>> {
  const vide = new Map<string, CompositionValidee>();
  if (dates.length === 0) return vide;

  const { data: repas, error: erreurRepas } = await supabase
    .from("planned_meals")
    .select("id, meal_id, planned_on, consumed_meal_id")
    .in("planned_on", [...dates]);
  // ⚠️ UNE LECTURE RATÉE N'EST PAS « AUCUNE COMPOSITION VALIDÉE ». Le dire
  // afficherait « à valider » sur un repas déjà validé, et un second clic
  // écraserait la composition en base par celle de l'écran.
  devWarn("lireCompositionsValidees:planned_meals", erreurRepas);
  if (erreurRepas) return vide;

  const lignes = (repas ?? []) as unknown as {
    id: string;
    meal_id: string;
    planned_on: string;
    consumed_meal_id: string | null;
  }[];
  if (lignes.length === 0) return vide;

  const { data: items, error: erreurItems } = await supabase
    .from("planned_meal_items")
    .select("planned_meal_id, choice_slot_id, catalog_food_id, product_id, quantity, unit")
    .in("planned_meal_id", lignes.map((l) => l.id))
    .order("position");
  devWarn("lireCompositionsValidees:planned_meal_items", erreurItems);
  if (erreurItems) return vide;

  /*
   * ⚠️ N1.7 — LA SECONDE LECTURE, ET ELLE N'EST PAS FACULTATIVE. Les « rien »
   * vivent dans leur propre table : `planned_meal_items` ne peut pas les
   * porter. Les omettre ici ne casse rien de visible côté base — la
   * composition existe bel et bien — mais l'écran, lui, croit l'élève
   * indécis.
   *
   * ⚠️ UNE LECTURE RATÉE N'EST PAS « AUCUN RIEN », même raison que pour les
   * items juste au-dessus : le dire ferait réapparaître des occurrences que
   * l'élève avait écartées, et un second clic les réécrirait en base.
   */
  const { data: ecartees, error: erreurEcartees } = await supabase
    .from("planned_meal_skipped_slots")
    .select("planned_meal_id, choice_slot_id")
    .in("planned_meal_id", lignes.map((l) => l.id));
  devWarn("lireCompositionsValidees:planned_meal_skipped_slots", erreurEcartees);
  if (erreurEcartees) return vide;

  const ignoreesParRepas = new Map<string, string[]>();
  for (const brut of (ecartees ?? []) as unknown as {
    planned_meal_id: string;
    choice_slot_id: string;
  }[]) {
    const liste = ignoreesParRepas.get(brut.planned_meal_id) ?? [];
    liste.push(brut.choice_slot_id);
    ignoreesParRepas.set(brut.planned_meal_id, liste);
  }

  const parRepas = new Map<string, ItemValide[]>();
  for (const brut of (items ?? []) as unknown as {
    planned_meal_id: string;
    choice_slot_id: string;
    catalog_food_id: string | null;
    product_id: string | null;
    quantity: number | string;
    unit: string;
  }[]) {
    const quantite = Number(brut.quantity);
    if (!Number.isFinite(quantite)) continue;
    const liste = parRepas.get(brut.planned_meal_id) ?? [];
    liste.push({
      slotId: brut.choice_slot_id,
      catalogFoodId: brut.catalog_food_id,
      productId: brut.product_id,
      quantity: quantite,
      unit: brut.unit,
    });
    parRepas.set(brut.planned_meal_id, liste);
  }

  const carte = new Map<string, CompositionValidee>();
  for (const ligne of lignes) {
    const items = parRepas.get(ligne.id) ?? [];
    const ignorees = ignoreesParRepas.get(ligne.id) ?? [];
    // Un `planned_meal` sans item ne décrit aucune composition : l'ignorer
    // évite d'afficher « choix validés » sur un repas vide.
    //
    // ⚠️ N1.7 — « SANS ITEM » NE VEUT PLUS DIRE « SANS COMPOSITION ». Un repas
    // dont l'élève a écarté TOUTES les listes n'a aucun item et reste une
    // composition parfaitement validée. Le test sur `items` seul l'aurait fait
    // disparaître de la carte, donc réapparaître « à valider ».
    if (items.length === 0 && ignorees.length === 0) continue;
    carte.set(`${ligne.meal_id}|${ligne.planned_on}`, {
      plannedMealId: ligne.id,
      mealId: ligne.meal_id,
      date: ligne.planned_on,
      consomme: ligne.consumed_meal_id !== null,
      items,
      ignorees,
    });
  }
  return carte;
}

/* ══════════════════════════════════════════════════════════════════════════
   A5 — LES ALIMENTS RÉCEMMENT CONSOMMÉS
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Un aliment proposé en RACCOURCI — récent ou favori.
 *
 * Il porte sa SOURCE VIVANTE (`CatalogFood` ou `ProduitLocal`), jamais un
 * instantané : c'est ce qui permet de le taper et d'ouvrir l'étape quantité
 * d'A3 sans aucune logique d'ajout nouvelle.
 */
export type AlimentRapide =
  | { readonly type: "aliment"; readonly aliment: CatalogFood }
  | { readonly type: "produit"; readonly produit: ProduitLocal };

/** L'identifiant d'un raccourci, pour le comparer sans confondre les deux types. */
export function cleAlimentRapide(élément: AlimentRapide): string {
  return élément.type === "aliment"
    ? `aliment:${élément.aliment.id}`
    : `produit:${élément.produit.id}`;
}

/**
 * CHARGE LES SOURCES d'une liste de cibles — deux requêtes, jamais une par
 * cible.
 *
 * Partagé par les récents ET les favoris : les deux ont besoin de la même
 * chose (l'aliment ou le produit vivant, pas l'instantané), et écrire deux fois
 * ce chargement donnerait deux occasions de diverger sur l'unité ou sur le
 * filtre des aliments archivés.
 *
 * L'ORDRE RENDU EST CELUI DES CIBLES REÇUES. Une source disparue — aliment
 * archivé, produit purgé du cache — est simplement OMISE : un raccourci qui ne
 * mène nulle part serait un bouton qui ne fait rien.
 */
export async function chargerAlimentsRapides(
  supabase: TypedSupabaseClient,
  cibles: readonly CibleRecente[],
): Promise<readonly AlimentRapide[]> {
  if (cibles.length === 0) return [];
  const idsAliments = cibles.filter((c) => c.type === "aliment").map((c) => c.id);
  const idsProduits = cibles.filter((c) => c.type === "produit").map((c) => c.id);

  const [aliments, produits] = await Promise.all([
    idsAliments.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("food_catalog")
          .select(
            "id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, piece_weight_g",
          )
          .in("id", idsAliments)
          // Un aliment ARCHIVÉ ne doit plus être proposé : il a été retiré du
          // catalogue pour une raison. Le journal qui le mentionne garde de
          // toute façon son instantané, intact.
          .eq("status", "active"),
    idsProduits.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
          .from("food_products")
          .select(
            "id, gtin, product_name, brand, nutrition_unit, protein_per_100, carb_per_100, " +
              "fat_per_100, image_url, detail_fetched_at",
          )
          .in("id", idsProduits),
  ]);
  devWarn("chargerAlimentsRapides (food_catalog)", aliments.error);
  devWarn("chargerAlimentsRapides (food_products)", produits.error);

  const parAliment = new Map(
    ((aliments.data ?? []) as unknown as {
      id: string;
      name: string;
      nutrition_unit: string;
      protein_per_100: number;
      carb_per_100: number;
      fat_per_100: number;
      piece_weight_g: number | null;
    }[])
      .filter((f) => f.nutrition_unit === "g" || f.nutrition_unit === "ml")
      .map((f) => [
        f.id,
        {
          id: f.id,
          name: f.name,
          nutritionUnit: f.nutrition_unit as "g" | "ml",
          proteinPer100: Number(f.protein_per_100),
          carbPer100: Number(f.carb_per_100),
          fatPer100: Number(f.fat_per_100),
          pieceWeightG: f.piece_weight_g === null ? null : Number(f.piece_weight_g),
        } satisfies CatalogFood,
      ]),
  );

  const parProduit = new Map(
    ((produits.data ?? []) as unknown as {
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
    }[]).map((p) => [
      p.id,
      {
        id: p.id,
        gtin: p.gtin,
        name: p.product_name,
        brand: p.brand,
        nutritionUnit: (p.nutrition_unit === "ml" ? "ml" : "g") as "g" | "ml",
        proteinPer100: Number(p.protein_per_100),
        carbPer100: Number(p.carb_per_100),
        fatPer100: Number(p.fat_per_100),
        imageUrl: p.image_url,
        hydratee: p.detail_fetched_at !== null,
      } satisfies ProduitLocal,
    ]),
  );

  return cibles
    .map((c): AlimentRapide | null => {
      if (c.type === "aliment") {
        const aliment = parAliment.get(c.id);
        return aliment ? { type: "aliment", aliment } : null;
      }
      const produit = parProduit.get(c.id);
      return produit ? { type: "produit", produit } : null;
    })
    .filter((r): r is AlimentRapide => r !== null);
}

/**
 * LES RÉCENTS — TROIS REQUÊTES, JAMAIS UNE PAR ALIMENT.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI ON RECHARGE LA SOURCE, ET PAS L'INSTANTANÉ
 * ────────────────────────────────────────────────────────────────────────────
 * `meal_entries` porte les macros CONSOMMÉES — 250 g de riz, pas les valeurs
 * pour 100 g. Réafficher un récent depuis son instantané donnerait un aliment
 * dont les macros dépendraient de la dernière quantité mangée, et le taper
 * ouvrirait une étape quantité fausse.
 *
 * On relit donc la source, exactement comme la recherche. Un récent est un
 * RACCOURCI vers l'aliment, pas une copie de ce qui a été mangé.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * TROIS REQUÊTES, ET LEUR COÛT EST MESURÉ
 * ────────────────────────────────────────────────────────────────────────────
 *   1. les 200 dernières entrées de l'élève  → index (student_id, created_at desc)
 *   2. les aliments correspondants           → `in (…)`, au plus 12 identifiants
 *   3. les produits correspondants           → `in (…)`, au plus 12 identifiants
 *
 * Aucun N+1 : les deux dernières prennent une LISTE d'identifiants, pas un
 * identifiant. Sans l'index de la migration 20260905090000, la première
 * parcourait la table entière de TOUS les élèves — 7,9 ms contre 0,23 ms,
 * mesuré sur 64 800 entrées.
 */
export async function listerRecents(
  supabase: TypedSupabaseClient,
  studentId: string,
  limite = MAX_RECENTS,
): Promise<readonly AlimentRapide[]> {
  const { data, error } = await supabase
    .from("meal_entries")
    .select("source_type, food_id, product_id, created_at")
    .eq("student_id", studentId)
    // Le filtre est posé EN BASE : recharger des entrées manuelles pour les
    // écarter côté client ferait remonter du texte libre sur le réseau sans
    // qu'aucune ne puisse jamais devenir un récent.
    .in("source_type", ["catalog_food", "product"])
    .order("created_at", { ascending: false })
    .limit(FENETRE_RECENTS);
  devWarn("listerRecents (meal_entries)", error);
  if (error || !data) return [];

  const lignes: LigneRecente[] = (
    data as unknown as {
      source_type: string;
      food_id: string | null;
      product_id: string | null;
      created_at: string;
    }[]
  ).map((l) => ({
    sourceType: l.source_type,
    foodId: l.food_id,
    productId: l.product_id,
    creeLe: l.created_at,
  }));

  const récents: readonly Recent[] = ordonnerRecents(lignes, limite);
  return chargerAlimentsRapides(supabase, récents.map((r) => r.cible));
}
