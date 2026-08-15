import type { SupabaseClient } from "@supabase/supabase-js";

import { MEAL_SLOT_KEYS, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type {
  PlanV2Day,
  PlanV2Week,
  PrescribedFoodItem,
  ChoiceOption,
  MealChoiceSlot,
  PrescribedMeal,
} from "@/lib/nutrition/plan-v2-week";
import { compareWeekdays, toWeekdayKey } from "@/lib/nutrition/weekdays";
import { readNutritionPlanV2 } from "@/lib/supabase/nutrition-v2";
import type { Database } from "@/types/supabase";

/**
 * LECTURE de la semaine d'un plan v2 : les sept jours, leur profil, et les
 * repas prescrits par le coach (outil 3).
 *
 * TROIS REQUÊTES AU TOTAL, quelle que soit la taille du plan :
 *   1. le plan, ses profils et leurs créneaux — délégué à
 *      `readNutritionPlanV2`, qui en fait déjà trois ;
 *   2. les jours du plan ;
 *   3. les repas de ces jours, en une seule requête `in (...)`.
 * Aucun N+1, aucune requête par jour.
 *
 * ORDRE EXPLICITE partout : les jours par `day` puis réordonnés en lundi →
 * dimanche côté TypeScript (PostgREST ne sait pas trier sur un ordre
 * arbitraire), les repas par créneau puis par nom. Sans cela l'affichage
 * changeait d'un chargement à l'autre.
 *
 * AUCUNE ÉCRITURE. Ce module ne connaît ni `insert`, ni `update`, ni
 * `delete` : la seule écriture d'un plan est la RPC `save_nutrition_plan_v2`.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(contexte: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${contexte} : ${error.message}`);
  }
}

interface DayRowShape {
  id: string;
  plan_id: string;
  day: string;
  status: string;
  profile_key: string;
}

interface MealRowShape {
  id: string;
  nutrition_day_id: string;
  slot: string;
  name: string;
  items: unknown;
  macros: Record<string, number> | null;
  coach_notes: string;
}

function mapItems(brut: unknown): readonly PrescribedFoodItem[] {
  if (!Array.isArray(brut)) return [];
  return brut.map((entrée) => {
    if (typeof entrée === "string") return { name: entrée, quantity: "" };
    const objet = (entrée ?? {}) as { name?: unknown; quantity?: unknown };
    return {
      name: typeof objet.name === "string" ? objet.name : "",
      quantity: typeof objet.quantity === "string" ? objet.quantity : "",
    };
  });
}


/**
 * LES LIBELLÉS DES IDENTITÉS SNAPSHOTÉES — deux requêtes, pas une par option.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI PAS `chargerAlimentsRapides`
 * ────────────────────────────────────────────────────────────────────────────
 * Ce lecteur groupé existe déjà dans `consumed-meals.ts`, et il filtre
 * `status = 'active'`. C'est juste pour ce qu'il fait — PROPOSER un aliment :
 * un aliment retiré du catalogue ne doit plus être proposé. Ici on ne propose
 * rien, on NOMME ce qui est déjà figé dans un repas. Un aliment archivé après
 * coup doit garder son nom à l'écran ; le filtrer afficherait « indisponible »
 * pour un aliment qui existe parfaitement.
 *
 * ⚠️ CETTE LECTURE NE TOUCHE PAS AU SNAPSHOT. Elle ne peut ni ajouter, ni
 * retirer, ni remplacer une identité : elle rend une carte identifiant → nom,
 * et rien d'autre. Une identité absente de la carte reste dans le snapshot,
 * simplement sans libellé.
 */
async function lireLibelles(
  supabase: TypedSupabaseClient,
  idsAliments: readonly string[],
  idsProduits: readonly string[],
): Promise<{ aliments: Map<string, string>; produits: Map<string, string> }> {
  const aliments = new Map<string, string>();
  const produits = new Map<string, string>();

  const [catalogue, marques] = await Promise.all([
    idsAliments.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("food_catalog").select("id, name").in("id", [...idsAliments]),
    idsProduits.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase.from("food_products").select("id, product_name, brand").in("id", [...idsProduits]),
  ]);
  devWarn("readNutritionPlanV2Week (libellés food_catalog)", catalogue.error);
  devWarn("readNutritionPlanV2Week (libellés food_products)", marques.error);

  for (const f of (catalogue.data ?? []) as unknown as { id: string; name: string }[]) {
    aliments.set(f.id, f.name);
  }
  // « Marque — Produit », la forme déjà employée par le sélecteur d'aliments
  // et par l'éditeur de listes. Une seule façon de nommer un produit.
  for (const p of (marques.data ?? []) as unknown as {
    id: string;
    product_name: string;
    brand: string | null;
  }[]) {
    produits.set(p.id, p.brand ? `${p.brand} — ${p.product_name}` : p.product_name);
  }
  return { aliments, produits };
}

/**
 * N1.3 — les occurrences d'un repas, reconstruites depuis les deux tables du
 * snapshot. `parRepas` est bâtie UNE fois pour tous les jours : une requête
 * par repas ferait des dizaines d'allers-retours sur une semaine chargée.
 */
function mapMeal(
  row: MealRowShape,
  parRepas: ReadonlyMap<string, readonly MealChoiceSlot[]>,
): PrescribedMeal | null {
  // Le créneau est contraint en base depuis 20260811090000. Une valeur hors
  // vocabulaire ne peut venir que d'une base non migrée : on l'écarte plutôt
  // que de la rendre telle quelle, ce qui casserait le tri et l'affichage.
  if (!(MEAL_SLOT_KEYS as readonly string[]).includes(row.slot)) return null;
  const macros = row.macros ?? {};
  return {
    id: row.id,
    slot: row.slot as MealSlotKey,
    name: row.name,
    items: mapItems(row.items),
    calories: Number(macros.calories ?? 0),
    protein: Number(macros.protein ?? 0),
    carbs: Number(macros.carbs ?? 0),
    fat: Number(macros.fat ?? 0),
    coachNotes: row.coach_notes ?? "",
    choiceSlots: parRepas.get(row.id) ?? [],
  };
}

interface SlotRowShape {
  id: string;
  meal_id: string;
  position: number;
  label: string;
  source_list_id: string | null;
}

interface OptionRowShape {
  slot_id: string;
  position: number;
  catalog_food_id: string | null;
  product_id: string | null;
}

/**
 * Les occurrences de TOUS les repas d'une semaine, en DEUX requêtes.
 *
 * ⚠️ AUCUNE LECTURE DE `food_lists` NI DE `food_list_items` ICI, et c'est la
 * garantie d'instantané elle-même : après l'ajout, un repas ne connaît plus
 * la bibliothèque dont il est issu. `source_list_id` est rendu pour l'afficher
 * au coach, jamais pour aller y chercher quoi que ce soit.
 */
async function lireOccurrences(
  supabase: TypedSupabaseClient,
  mealIds: readonly string[],
): Promise<ReadonlyMap<string, readonly MealChoiceSlot[]>> {
  const parRepas = new Map<string, MealChoiceSlot[]>();
  if (mealIds.length === 0) return parRepas;

  const { data: slotRows, error: slotError } = await supabase
    .from("meal_choice_slots")
    .select("id, meal_id, position, label, source_list_id")
    .in("meal_id", [...mealIds])
    .order("position", { ascending: true });
  devWarn("readNutritionPlanV2Week (meal_choice_slots)", slotError);
  const slots = (slotRows ?? []) as unknown as SlotRowShape[];
  if (slots.length === 0) return parRepas;

  const { data: optionRows, error: optionError } = await supabase
    .from("meal_choice_options")
    .select("slot_id, position, catalog_food_id, product_id")
    .in("slot_id", slots.map((s) => s.id))
    .order("position", { ascending: true });
  devWarn("readNutritionPlanV2Week (meal_choice_options)", optionError);
  const options = (optionRows ?? []) as unknown as OptionRowShape[];

  // ── L'HYDRATATION : DEUX REQUÊTES POUR TOUTE LA SEMAINE ──────────────────
  // ⚠️ PAS UNE PAR OPTION. Un plan de cinquante options ferait cinquante
  // allers-retours ; on collecte les identifiants UNIQUES de la semaine
  // entière, puis on lit en deux fois — quel que soit le nombre d'occurrences.
  const noms = await lireLibelles(
    supabase,
    [...new Set(options.map((o) => o.catalog_food_id).filter((x): x is string => x !== null))],
    [...new Set(options.map((o) => o.product_id).filter((x): x is string => x !== null))],
  );

  const parSlot = new Map<string, ChoiceOption[]>();
  for (const o of options) {
    const cible: ChoiceOption | null =
      o.catalog_food_id !== null
        ? { type: "aliment", id: o.catalog_food_id, displayName: noms.aliments.get(o.catalog_food_id) ?? null }
        : o.product_id !== null
          ? { type: "produit", id: o.product_id, displayName: noms.produits.get(o.product_id) ?? null }
          : null;
    if (!cible) continue;
    const liste = parSlot.get(o.slot_id) ?? [];
    liste.push(cible);
    parSlot.set(o.slot_id, liste);
  }

  for (const s of slots) {
    const liste = parRepas.get(s.meal_id) ?? [];
    liste.push({
      id: s.id,
      label: s.label,
      sourceListId: s.source_list_id,
      options: parSlot.get(s.id) ?? [],
    });
    parRepas.set(s.meal_id, liste);
  }
  return parRepas;
}

/**
 * Le plan v2 COMPLET : profils, créneaux, sept jours et repas prescrits.
 * `null` si le plan est introuvable ou invisible (RLS).
 */
export async function readNutritionPlanV2Week(
  supabase: TypedSupabaseClient,
  planId: string,
): Promise<PlanV2Week | null> {
  const plan = await readNutritionPlanV2(supabase, planId);
  if (!plan) return null;

  const { data: dayRows, error: dayError } = await supabase
    .from("nutrition_days")
    .select("id, plan_id, day, status, profile_key")
    .eq("plan_id", planId)
    .order("day", { ascending: true });
  devWarn("readNutritionPlanV2Week (nutrition_days)", dayError);
  const jours = (dayRows ?? []) as unknown as DayRowShape[];

  let repas: MealRowShape[] = [];
  if (jours.length > 0) {
    const { data: mealRows, error: mealError } = await supabase
      .from("meals")
      .select("id, nutrition_day_id, slot, name, items, macros, coach_notes")
      .in(
        "nutrition_day_id",
        jours.map((j) => j.id),
      )
      .order("slot", { ascending: true })
      .order("name", { ascending: true });
    devWarn("readNutritionPlanV2Week (meals)", mealError);
    repas = (mealRows ?? []) as unknown as MealRowShape[];
  }

  const occurrences = await lireOccurrences(supabase, repas.map((m) => m.id));

  const days: readonly PlanV2Day[] = jours
    .map((jour): PlanV2Day | null => {
      const cle = toWeekdayKey(jour.day);
      if (!cle) return null;
      return {
        id: jour.id,
        day: cle,
        profileKey: jour.profile_key,
        status: jour.status,
        meals: repas
          .filter((m) => m.nutrition_day_id === jour.id)
          .map((m) => mapMeal(m, occurrences))
          .filter((m): m is PrescribedMeal => m !== null)
          .sort(
            (a, b) =>
              MEAL_SLOT_KEYS.indexOf(a.slot) - MEAL_SLOT_KEYS.indexOf(b.slot) ||
              a.name.localeCompare(b.name, "fr") ||
              a.id.localeCompare(b.id),
          ),
      } satisfies PlanV2Day;
    })
    .filter((j): j is PlanV2Day => j !== null)
    .sort((a, b) => compareWeekdays(a.day, b.day));

  return { planId: plan.id, profiles: plan.profiles, days };
}
