import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ConsumedEntry,
  type ConsumedMeal,
  type ConsumedSourceType,
  type ConsumedUnit,
  CONSUMED_UNITS,
} from "@/lib/nutrition/consumed";
import { MEAL_SLOT_KEYS, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
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
 * Les repas consommés d'une PLAGE DE DATES, avec leurs aliments.
 *
 * La RLS fait le cloisonnement : cette fonction ne filtre pas par élève, elle
 * demande simplement. Ajouter un filtre client donnerait l'illusion que le
 * navigateur protège quelque chose.
 */
export async function readConsumedMeals(
  supabase: TypedSupabaseClient,
  dates: readonly string[],
): Promise<readonly ConsumedMeal[]> {
  if (dates.length === 0) return [];

  const { data: mealRows, error: mealError } = await supabase
    .from("consumed_meals")
    .select(
      "id, student_id, consumed_on, kind, prescribed_meal_id, slot_key, label, position, target_kcal, target_protein_g, target_carb_g, target_fat_g",
    )
    .in("consumed_on", [...dates])
    .order("consumed_on", { ascending: true })
    .order("position", { ascending: true });
  devWarn("readConsumedMeals (consumed_meals)", mealError);
  const repas = (mealRows ?? []) as unknown as ConsumedMealRow[];
  if (repas.length === 0) return [];

  const { data: entryRows, error: entryError } = await supabase
    .from("meal_entries")
    .select(
      "id, consumed_meal_id, source_type, food_id, label, quantity, unit, protein_g, carb_g, fat_g, note, created_at",
    )
    .in(
      "consumed_meal_id",
      repas.map((r) => r.id),
    )
    .order("created_at", { ascending: true });
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
export async function searchCatalogFoods(
  supabase: TypedSupabaseClient,
  requête: string,
  limite = 20,
): Promise<readonly CatalogFood[]> {
  const terme = requête.trim();
  if (terme.length < 2) return [];
  const motif = `%${terme.replace(/[%_]/g, "")}%`;

  const { data, error } = await supabase
    .from("food_catalog")
    .select("id, name, nutrition_unit, protein_per_100, carb_per_100, fat_per_100, piece_weight_g")
    .is("owner_coach_id", null)
    .eq("status", "active")
    .or(`name.ilike.${motif},slug.ilike.${motif}`)
    .order("name", { ascending: true })
    .limit(limite);
  devWarn("searchCatalogFoods", error);

  return ((data ?? []) as unknown as {
    id: string;
    name: string;
    nutrition_unit: string;
    protein_per_100: number;
    carb_per_100: number;
    fat_per_100: number;
    piece_weight_g: number | null;
  }[])
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
