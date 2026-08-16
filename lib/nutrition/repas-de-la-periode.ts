import type { ChoixPersiste } from "@/lib/nutrition/meal-choice-selection";
import type { MealMacroTarget } from "@/lib/nutrition/meal-choice-solver";
import type { MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type { PeriodeCourses } from "@/lib/nutrition/periode-courses";
import {
  orderedMeals,
  slotMacrosForDay,
  type MealChoiceSlot,
  type PlanV2Week,
} from "@/lib/nutrition/plan-v2-week";
import type { ColorKey } from "@/lib/ui/color-keys";

/**
 * COURSES C1 — QUELS REPAS COMPOSENT LA PÉRIODE, ET LESQUELS SONT PRÊTS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE CROISEMENT, ET SES DEUX CÔTÉS
 * ────────────────────────────────────────────────────────────────────────────
 * À gauche : le PLAN du coach, indexé par nom de jour anglais — il dit ce qui
 * est prescrit un lundi, jamais quel lundi.
 * À droite : le PLANIFIÉ de l'élève, indexé par date réelle (`planned_on`) —
 * il dit ce qu'il a validé, ce jour-là précisément.
 *
 * Ce module les croise, et n'invente rien au passage :
 *
 * ⚠️ UN REPAS NON VALIDÉ RESTE VIDE. Aucun aliment n'est deviné, aucune option
 * « probable » n'est proposée à sa place, aucune quantité n'est estimée. Il est
 * marqué « À COMPOSER », et c'est tout ce qu'on peut honnêtement en dire.
 *
 * ⚠️ SEULS LES REPAS STRUCTURÉS COMPTENT. Un repas sans occurrence de liste
 * (`choiceSlots` vide) n'a aucune option autorisée, donc ne peut produire aucun
 * `planned_meal_item` : le compter comme « à composer » demanderait à l'élève
 * un geste qui n'existe pas. Il est écarté du parcours — et signalé comme tel.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 * ⚠️ AUCUN SOLVEUR n'est importé ici non plus.
 */

export interface RepasDeLaPeriode {
  /** `${mealId}|${date}` — la même clé que `lireCompositionsValidees`. */
  readonly cle: string;
  readonly date: string;
  readonly mealId: string;
  readonly slot: MealSlotKey;
  readonly nom: string;
  readonly occurrences: readonly MealChoiceSlot[];
  /** La cible du repas, calculée EXACTEMENT comme sur l'écran du plan. */
  readonly cible: MealMacroTarget | null;
  /** `true` si une composition validée existe pour ce repas à cette date. */
  readonly pret: boolean;
  /** La composition en base, ou `null`. Sert à ré-afficher les choix faits. */
  readonly composition: readonly ChoixPersiste[] | null;
  /** `true` si ce repas a AUSSI été déclaré consommé — il est alors verrouillé. */
  readonly consomme: boolean;
}

export interface CompositionConnue {
  readonly items: readonly ChoixPersiste[];
  readonly consomme: boolean;
}

/**
 * Les repas structurés de la période, dans l'ordre chronologique puis dans
 * l'ordre des créneaux.
 *
 * `compositions` est indexé par `${mealId}|${date}` — c'est la forme que rend
 * déjà `lireCompositionsValidees`, et celle que produit `indexerPlanifie`.
 */
export function repasDeLaPeriode(
  week: PlanV2Week | null,
  periode: PeriodeCourses | null,
  compositions: ReadonlyMap<string, CompositionConnue>,
): readonly RepasDeLaPeriode[] {
  if (week === null || periode === null) return [];

  const resultat: RepasDeLaPeriode[] = [];
  for (const jour of periode.jours) {
    const jourDuPlan = week.days.find((d) => d.day === jour.jour);
    if (!jourDuPlan) continue;

    for (const repas of orderedMeals(jourDuPlan.meals)) {
      if (repas.choiceSlots.length === 0) continue;

      // ⚠️ LA MÊME RÈGLE DE CIBLE QUE `StudentPrescribedWeek`, mot pour mot :
      // les macros saisies à la main par le coach l'emportent, sinon la
      // répartition v2 du créneau. Deux écrans qui viseraient des nombres
      // différents pour le même repas produiraient deux compositions.
      const creneau = slotMacrosForDay(week, jourDuPlan, repas.slot);
      const saisiParLeCoach = repas.calories > 0 || repas.protein + repas.carbs + repas.fat > 0;
      const cible: MealMacroTarget | null = saisiParLeCoach
        ? {
            calories: repas.calories,
            proteinGrams: repas.protein,
            carbGrams: repas.carbs,
            fatGrams: repas.fat,
          }
        : creneau;

      const cle = `${repas.id}|${jour.date}`;
      const connue = compositions.get(cle) ?? null;
      resultat.push({
        cle,
        date: jour.date,
        mealId: repas.id,
        slot: repas.slot,
        nom: repas.name,
        occurrences: repas.choiceSlots,
        cible,
        pret: connue !== null && connue.items.length > 0,
        composition: connue?.items ?? null,
        consomme: connue?.consomme ?? false,
      });
    }
  }
  return resultat;
}

/** Le nombre de repas de la période qu'il reste à composer. */
export function repasAComposer(repas: readonly RepasDeLaPeriode[]): readonly RepasDeLaPeriode[] {
  return repas.filter((r) => !r.pret);
}

/**
 * La couleur de chaque occurrence du plan, par `choice_slot_id`.
 *
 * ⚠️ AUCUNE REQUÊTE SUPPLÉMENTAIRE POUR ÇA. `meal_choice_slots.color_key` est
 * déjà dans la semaine chargée : la relire depuis la base serait une
 * cinquième requête pour une information qu'on a sous la main.
 */
export function couleursParOccurrence(week: PlanV2Week | null): ReadonlyMap<string, ColorKey | null> {
  const carte = new Map<string, ColorKey | null>();
  if (week === null) return carte;
  for (const jour of week.days) {
    for (const repas of jour.meals) {
      for (const occurrence of repas.choiceSlots) {
        carte.set(occurrence.id, occurrence.colorKey);
      }
    }
  }
  return carte;
}

/**
 * Toutes les options AUTORISÉES de la période, dédoublonnées par identité.
 *
 * ⚠️ C'EST LA SEULE SOURCE D'ALIMENTS DE L'ÉCRAN PRÉFÉRENCES. Elle sort
 * exclusivement de `occurrences[].options`, c'est-à-dire du snapshot du coach.
 * Une préférence ne peut donc pas faire apparaître un aliment que le coach n'a
 * pas autorisé : il n'existe aucun chemin par lequel un autre aliment entrerait
 * dans cette liste.
 */
export interface OptionAutorisee {
  /** `aliment:UUID` ou `produit:UUID` — la clé de `cleFavori`. */
  readonly cle: string;
  readonly type: "aliment" | "produit";
  readonly id: string;
  readonly displayName: string;
  /** Nombre d'occurrences de la période où cette option est proposée. */
  readonly occurrences: number;
}

/**
 * Traduit les choix d'un repas (`optionId`) en IDENTITÉS (`catalog_food_id` /
 * `product_id`), à partir des seules options du snapshot.
 *
 * ⚠️ AUCUN REPLI SILENCIEUX. Une option introuvable laisse les DEUX identités
 * nulles, et la RPC refuse avec `IDENTITE_INVALIDE` — un refus lisible plutôt
 * qu'une entrée fantôme. C'est exactement la règle de `resoudreIdentites` sur
 * l'écran du plan.
 *
 * ⚠️ SECONDE IMPLÉMENTATION ASSUMÉE, ET SIGNALÉE. L'écran du plan porte la
 * sienne en ligne, et la suite `courses-c0-validation` lit ce code littéral
 * dans ce fichier-là : l'unifier maintenant obligerait à réécrire un test hors
 * périmètre pour retrouver du vert. Elle est donc dupliquée ICI, à l'identique,
 * et l'unification est portée au reste à faire pour C2.
 */
export function identitesDeChoix(
  occurrences: readonly MealChoiceSlot[],
  items: readonly { readonly slotId: string; readonly optionId: string; readonly quantity: number; readonly unit: "g" | "ml" }[],
): readonly {
  readonly slotId: string;
  readonly catalogFoodId: string | null;
  readonly productId: string | null;
  readonly quantity: number;
  readonly unit: "g" | "ml";
}[] {
  const parOption = new Map(
    occurrences.flatMap((occurrence) =>
      occurrence.options
        .filter((o) => typeof o.optionId === "string")
        .map((o) => [o.optionId as string, o] as const),
    ),
  );
  return items.map((item) => {
    const option = parOption.get(item.optionId);
    return {
      slotId: item.slotId,
      catalogFoodId: option?.type === "aliment" ? option.id : null,
      productId: option?.type === "produit" ? option.id : null,
      quantity: item.quantity,
      unit: item.unit,
    };
  });
}

export function optionsAutoriseesDeLaPeriode(
  repas: readonly RepasDeLaPeriode[],
): readonly OptionAutorisee[] {
  const parCle = new Map<string, { type: "aliment" | "produit"; id: string; displayName: string; occurrences: number }>();
  for (const r of repas) {
    for (const occurrence of r.occurrences) {
      for (const option of occurrence.options) {
        const cle = `${option.type}:${option.id}`;
        const existante = parCle.get(cle);
        if (existante) {
          existante.occurrences += 1;
          if (existante.displayName === "" && typeof option.displayName === "string") {
            existante.displayName = option.displayName;
          }
          continue;
        }
        parCle.set(cle, {
          type: option.type,
          id: option.id,
          displayName: typeof option.displayName === "string" ? option.displayName : "",
          occurrences: 1,
        });
      }
    }
  }
  return [...parCle.entries()]
    .map(([cle, v]): OptionAutorisee => ({ cle, ...v }))
    .sort((a, b) => {
      const parNom = a.displayName.localeCompare(b.displayName, "fr");
      return parNom !== 0 ? parNom : a.cle.localeCompare(b.cle);
    });
}
