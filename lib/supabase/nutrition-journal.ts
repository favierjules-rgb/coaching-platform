import type { SupabaseClient } from "@supabase/supabase-js";

import type { ConsumedMeal } from "@/lib/nutrition/consumed";
import {
  type JourneeNutrition,
  journeesDuJournal,
  logsDepuisJournal,
} from "@/lib/nutrition/statut-journee";
import type { DailyNutritionLog } from "@/lib/nutrition-weekly";
import { type CibleLecture, readConsumedMeals } from "@/lib/supabase/consumed-meals";
import type { Database } from "@/types/supabase";

/**
 * LE JOURNAL ALIMENTAIRE, CÔTÉ SUPABASE — source primaire du suivi (P6 + P7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN FICHIER SÉPARÉ DE `nutrition-logs.ts`
 * ────────────────────────────────────────────────────────────────────────────
 * Deux raisons, et la seconde est contractuelle :
 *
 * 1. `nutrition-logs.ts` est la couche de l'ANCIENNE table
 *    (`nutrition_daily_logs`, « Outil 1 »), qui n'est plus alimentée depuis le
 *    22/08/2026. Elle reste lue pour l'historique ; elle n'a pas à apprendre un
 *    second modèle.
 * 2. `scripts/tests/nutrition-v2-unified.mts` (test 52) verrouille sa surface
 *    exportée à exactement trois noms. Y ajouter une fonction la casserait —
 *    et cette assertion protège quelque chose de juste : l'Outil 1 ne doit plus
 *    bouger.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUNE ÉCRITURE, ET AUCUNE ÉCRITURE POSSIBLE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Ce module ne contient ni `insert`, ni `update`, ni `upsert`, ni `delete` —
 * et il ne le pourrait pas : la migration 20260901090000 a RETIRÉ ces
 * privilèges au rôle `authenticated` sur `consumed_meals` et `meal_entries`.
 * Le statut de journée est DÉRIVÉ (voir lib/nutrition/statut-journee.ts), donc
 * il n'y a rien à persister : les repas sont déjà la persistance.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MÊME MODULE POUR L'ÉLÈVE ET POUR LE COACH
 * ────────────────────────────────────────────────────────────────────────────
 * `CibleLecture` est l'union discriminée OBLIGATOIRE de
 * `lib/supabase/consumed-meals.ts` : `{portee:"eleve-connecte"}` côté élève,
 * `{portee:"eleve", studentId}` côté coach. Les deux chemins traversent donc
 * la même lecture et la même dérivation — c'est ce qui garantit que les deux
 * écrans n'affichent pas deux chiffres pour la même journée.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function devWarn(contexte: string, error: { message: string } | null): void {
  if (error) {
    console.error(`[Supabase] ${contexte} : ${error.message}`);
  }
}

export interface JournalNutrition {
  /** Les repas lus, tels quels — pour les écrans qui veulent le détail. */
  readonly repas: readonly ConsumedMeal[];
  /** Une entrée par date DEMANDÉE, dans cet ordre, jours vides compris. */
  readonly journees: readonly JourneeNutrition[];
  /** Projection vers la forme historique, jours vides EXCLUS. */
  readonly logs: DailyNutritionLog[];
}

export const JOURNAL_VIDE: JournalNutrition = { repas: [], journees: [], logs: [] };

/**
 * Le journal d'une plage de dates : deux requêtes bornées, puis dérivation.
 *
 * `repasPrescritsParDate` est optionnel — sans lui, `valide` est inatteignable
 * et les statuts se bornent à `non-commence` / `en-cours`. Voir la doctrine
 * détaillée dans lib/nutrition/statut-journee.ts : on ne suppose pas une
 * complétude qu'on n'a pas lue.
 */
export async function lireJournalNutrition(
  supabase: TypedSupabaseClient,
  dates: readonly string[],
  cible: CibleLecture,
  repasPrescritsParDate?: Readonly<Record<string, number>> | null,
): Promise<JournalNutrition> {
  if (dates.length === 0) return JOURNAL_VIDE;
  const repas = await readConsumedMeals(supabase, dates, cible);
  const journees = journeesDuJournal(repas, dates, repasPrescritsParDate);
  return { repas, journees, logs: logsDepuisJournal(journees) };
}

/**
 * Combien de repas RÉCENTS on examine pour trouver la dernière journée
 * renseignée. 407 lignes `consumed_meals` pour 33 élèves en production au
 * 05/10/2026 : soixante lignes couvrent plusieurs mois d'un même élève, et la
 * borne existe pour que cette lecture ne grossisse jamais avec l'historique.
 */
const REPAS_RECENTS_EXAMINES = 60;

/**
 * La dernière date à laquelle l'élève a réellement déclaré un aliment.
 *
 * ⚠️ DEUX LECTURES SIMPLES, AUCUNE JOINTURE NI `!inner`. La clé étrangère de
 * `meal_entries` vers `consumed_meals` est COMPOSITE —
 * `(consumed_meal_id, student_id)` — et aucun embed PostgREST n'existe ailleurs
 * dans le dépôt : s'y adosser serait un pari sur une détection de relation
 * qu'aucun test local ne couvre. Deux requêtes bornées ne coûtent rien et ne
 * dépendent d'aucune inférence.
 *
 * ⚠️ UN CONTENEUR VIDE NE COMPTE PAS. On ne prend la date que si au moins un
 * `meal_entries` s'y rattache — même règle que le statut : ouvrir un repas
 * n'est pas manger.
 */
export async function derniereJourneeConsommee(
  supabase: TypedSupabaseClient,
  cible: CibleLecture,
): Promise<string | null> {
  const requêteRepas = supabase
    .from("consumed_meals")
    .select("id, consumed_on")
    .order("consumed_on", { ascending: false })
    .limit(REPAS_RECENTS_EXAMINES);

  const { data: mealRows, error: mealError } = await (cible.portee === "eleve"
    ? requêteRepas.eq("student_id", cible.studentId)
    : requêteRepas);
  devWarn("derniereJourneeConsommee (consumed_meals)", mealError);
  const repas = (mealRows ?? []) as unknown as { id: string; consumed_on: string }[];
  if (repas.length === 0) return null;

  const requêteEntrées = supabase
    .from("meal_entries")
    .select("consumed_meal_id")
    .in(
      "consumed_meal_id",
      repas.map((r) => r.id),
    );

  const { data: entryRows, error: entryError } = await (cible.portee === "eleve"
    ? requêteEntrées.eq("student_id", cible.studentId)
    : requêteEntrées);
  devWarn("derniereJourneeConsommee (meal_entries)", entryError);
  const avecAliments = new Set(
    ((entryRows ?? []) as unknown as { consumed_meal_id: string }[]).map((e) => e.consumed_meal_id),
  );
  if (avecAliments.size === 0) return null;

  let derniere: string | null = null;
  for (const r of repas) {
    if (!avecAliments.has(r.id)) continue;
    if (derniere === null || r.consumed_on > derniere) derniere = r.consumed_on;
  }
  return derniere;
}
