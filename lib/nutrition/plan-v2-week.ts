import { computeDailyMacroTargets, type DailyMacroTargets } from "@/lib/nutrition/macro-targets";
import { MEAL_SLOT_KEYS, computeMealDistribution, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import { buildRecipeTargetForMealSlot } from "@/lib/nutrition/recipe-matching";
import type { NutritionPlanV2Profile } from "@/lib/nutrition/plan-v2-validation";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import { WEEKDAY_KEYS, compareWeekdays, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * LA SEMAINE D'UN PLAN V2 — assemblage pur, sans Supabase et sans React.
 *
 * Le modèle v2 possédait déjà tout ce qu'il faut pour des objectifs
 * différents d'un jour à l'autre : plusieurs profils, et une répartition par
 * créneau pour chacun. Il ne lui manquait que le lien jour → profil, posé par
 * la migration 20260811090000.
 *
 * Ce module fait exactement ce lien, et rien d'autre :
 *   jour → profil → objectifs du jour → cible d'un créneau.
 *
 * AUCUNE FORMULE N'EST RÉÉCRITE ICI. Les calories viennent de
 * `computeDailyMacroTargets`, la cible d'un créneau de
 * `buildRecipeTargetForMealSlot`, les créneaux de `MEAL_SLOT_KEYS`. Ce
 * fichier n'a pas le droit de connaître 4, 4 et 9.
 */

/** Un aliment prescrit à la main par le coach. Texte libre, jamais calculé. */
export interface PrescribedFoodItem {
  readonly name: string;
  readonly quantity: string;
}

/** Un repas prescrit à la main par le coach — l'outil 3. */
/**
 * N1.3 — UNE OPTION SNAPSHOTÉE.
 *
 * ⚠️ UNE IDENTITÉ, RIEN D'AUTRE. Pas de nom, pas de macro, pas de quantité,
 * pas de rôle : l'option DÉSIGNE un aliment vivant de `food_catalog` ou de
 * `food_products`, et tout le reste est lu à la source au moment de
 * l'affichage. Recopier un nom ici ferait vieillir le repas en silence.
 */
/**
 * N1.5 — LES FAITS NUTRITIONNELS D'UNE OPTION, HYDRATÉS.
 *
 * ⚠️ MÊME STATUT QUE `displayName` : ce n'est PAS dans le snapshot. Les macros
 * sont lues à la source (`food_catalog` / `food_products`) au moment de
 * l'affichage, par identité, jamais par libellé. Les recopier dans
 * `meal_choice_options` ferait vieillir le repas en silence le jour où une
 * table Ciqual est corrigée — et l'unique garantie d'instantané de ce chantier
 * est précisément qu'un repas ne relit pas la bibliothèque, pas qu'il ne relit
 * plus le catalogue.
 *
 * ⚠️ JAMAIS RENVOYÉ À LA RPC. `toWeekSavePayload` n'émet que `catalog_food_id`
 * et `product_id` ; un test l'épingle, pour ce champ comme pour le libellé.
 *
 * `unit` est l'unité NUTRITIONNELLE de l'aliment — celle dans laquelle ses
 * macros sont données « pour 100 ». Aucune conversion g ↔ ml n'existe dans ce
 * schéma, et aucune n'est inventée ici.
 */
export interface OptionNutrition {
  readonly unit: "g" | "ml";
  readonly proteinPer100: number;
  readonly carbPer100: number;
  readonly fatPer100: number;
}

export type ChoiceOption = {
  /**
   * N1.5.1 — LA PORTION PRÉFÉRÉE EFFECTIVE, ET ELLE, C'EST DU SNAPSHOT.
   *
   * ⚠️ NE PAS LA CONFONDRE AVEC `displayName` NI AVEC `nutrition`. Ces deux-là
   * sont de l'HYDRATATION : relus à la source à chaque affichage, jamais
   * renvoyés à la RPC. La portion, elle, est une DONNÉE MÉTIER FIGÉE : elle
   * part vers la base avec l'identité, et un repas déjà construit la garde
   * même si le coach change d'avis dans sa bibliothèque ensuite.
   *
   * `null` = aucune préférence. Le solveur retombe alors exactement sur le
   * comportement N1.5 — c'est le cas de l'immense majorité des options.
   */
  readonly preferredQuantity?: number | null;
  /**
   * L'unité de `preferredQuantity`, figée avec elle. `g` ou `ml`, jamais
   * autre chose : c'est le vocabulaire de ce qui est CALCULABLE.
   * Absente dès que `preferredQuantity` l'est — les deux vont ensemble.
   */
  readonly preferredUnit?: "g" | "ml" | null;
  /**
   * N1.5 — les macros de l'aliment désigné, ou `null` si la source a disparu.
   * Une option sans macros est affichable mais PAS calculable : voir
   * `optionCalculable` dans `meal-choice-selection.ts`.
   */
  readonly nutrition?: OptionNutrition | null;
  /**
   * ⚠️ HYDRATATION, PAS DONNÉE MÉTIER. Le libellé n'est PAS dans le snapshot :
   * il est retrouvé à la lecture, à partir de l'identité, et sert uniquement à
   * l'affichage. Il n'est jamais renvoyé à la RPC — `toWeekSavePayload`
   * n'émet que `catalog_food_id` / `product_id`, et un test l'épingle.
   *
   * `null` ou absent = source introuvable. Un aliment supprimé du catalogue ne
   * doit pas casser le plan : on affiche « Aliment indisponible » plutôt qu'un
   * nom inventé.
   */
  readonly displayName?: string | null;
  /**
   * N1.4 — L'IDENTIFIANT DE LA LIGNE SNAPSHOTÉE (`meal_choice_options.id`).
   *
   * ⚠️ C'EST LUI QUE L'ÉLÈVE CHOISIT, PAS L'ALIMENT. Deux occurrences d'un même
   * repas peuvent contenir le même aliment — « Poulet » dans la protéine
   * principale ET dans la secondaire. Une sélection qui ne retiendrait que
   * `id` (l'aliment) ne saurait pas dire laquelle des deux a été choisie.
   *
   * Absent côté coach : au moment où le constructeur fige une liste, la ligne
   * n'existe pas encore en base — c'est la RPC qui la crée. Il n'est donc
   * jamais envoyé, seulement lu.
   */
  readonly optionId?: string;
} & (
  | { readonly type: "aliment"; readonly id: string }
  | { readonly type: "produit"; readonly id: string }
);

/**
 * N1.3 — UNE OCCURRENCE DE LISTE DANS UN REPAS.
 *
 * « À cet endroit du repas, l'élève choisit UN aliment parmi ceux-ci. »
 *
 * ⚠️ `label` ET `options` SONT UN INSTANTANÉ, pas une vue de la bibliothèque.
 * Ils sont figés au moment où le coach ajoute la liste ; renommer ou modifier
 * le modèle ensuite ne les touche pas. `sourceListId` n'est QUE de la
 * provenance — aucune lecture d'un repas ne passe par elle.
 *
 * ⚠️ AUCUN RÔLE NUTRITIONNEL. « Protéines » est un mot que le coach écrit pour
 * être compris ; ce n'est pas une catégorie que le moteur lira.
 */
export interface MealChoiceSlot {
  readonly id: string;
  readonly label: string;
  readonly sourceListId: string | null;
  readonly options: readonly ChoiceOption[];
}

export interface PrescribedMeal {
  readonly id: string;
  readonly slot: MealSlotKey;
  readonly name: string;
  readonly items: readonly PrescribedFoodItem[];
  readonly calories: number;
  readonly protein: number;
  readonly carbs: number;
  readonly fat: number;
  readonly coachNotes: string;
  /**
   * Les occurrences de listes, dans l'ordre d'affichage. Un repas « libre »
   * garde ce tableau VIDE — c'est le cas de tous les repas existants, et il
   * reste parfaitement valide.
   */
  readonly choiceSlots: readonly MealChoiceSlot[];
}

/** Un jour du plan : son profil, et ses repas prescrits. */
export interface PlanV2Day {
  readonly id: string;
  readonly day: WeekdayKey;
  readonly profileKey: string;
  readonly status: string;
  readonly meals: readonly PrescribedMeal[];
}

/** Le plan v2 complet, tel que l'élève et le coach le lisent. */
export interface PlanV2Week {
  readonly planId: string;
  readonly profiles: readonly NutritionPlanV2Profile[];
  readonly days: readonly PlanV2Day[];
}

/**
 * Le profil d'un jour. `null` si le jour désigne un profil absent — ce que la
 * clé étrangère composite rend impossible en base, mais qu'une lecture
 * partielle pourrait produire. On ne devine pas de repli.
 */
export function profileForDay(
  week: Pick<PlanV2Week, "profiles">,
  day: Pick<PlanV2Day, "profileKey">,
): NutritionPlanV2Profile | null {
  return week.profiles.find((p) => p.profileKey === day.profileKey) ?? null;
}

/**
 * Objectifs quotidiens d'un jour, dérivés de SON profil.
 * `null` quand le profil est introuvable.
 */
export function dailyTargetsForDay(
  week: Pick<PlanV2Week, "profiles">,
  day: Pick<PlanV2Day, "profileKey">,
): DailyMacroTargets | null {
  const profil = profileForDay(week, day);
  if (!profil) return null;
  return computeDailyMacroTargets({
    dailyCalories: profil.dailyCalories,
    proteinBp: profil.proteinBp,
    carbBp: profil.carbBp,
    fatBp: profil.fatBp,
  });
}

/**
 * Total calorique de la semaine : la SOMME des sept jours, chacun selon son
 * profil. Jamais `dailyCalories × 7` — ce serait faux dès que deux jours
 * utilisent deux profils différents, ce qui est précisément le but du modèle.
 *
 * Miroir exact du calcul de `save_nutrition_plan_v2` (migration
 * 20260812090000, étape 9) : les deux doivent rendre la même valeur, et un
 * test le vérifie.
 */
export function weeklyCaloriesFromDays(week: PlanV2Week): number {
  return week.days.reduce((total, jour) => {
    const profil = profileForDay(week, jour);
    return total + (profil?.dailyCalories ?? 0);
  }, 0);
}

/**
 * Les objectifs des SEPT jours, dans l'ordre lundi → dimanche.
 *
 * Un jour absent de la semaine, ou dont le profil est introuvable, rend
 * `null` : on ne devine pas un objectif, et l'appelant décide quoi en faire.
 *
 * C'est ce que lit le suivi hebdomadaire de l'élève, pour que chaque journée
 * affiche SON objectif prescrit — et non la moyenne de la semaine.
 */
export function dailyTargetsByWeekday(
  week: PlanV2Week,
): readonly (DailyMacroTargets | null)[] {
  const parJour = new Map(week.days.map((d) => [d.day, d]));
  return WEEKDAY_KEYS.map((jour) => {
    const journée = parJour.get(jour);
    return journée ? dailyTargetsForDay(week, journée) : null;
  });
}

/**
 * Les grammes et les calories d'UN créneau, pour UN jour.
 *
 * C'est la part du créneau appliquée aux objectifs du jour — exactement ce
 * que le constructeur affiche au coach sous chaque curseur de la zone 2.
 * Aucune formule ici : `computeMealDistribution` fait tout le calcul, et
 * `dailyTargetsForDay` fournit la journée non arrondie.
 *
 * `null` quand le profil du jour est introuvable, ou quand le créneau est
 * désactivé — un créneau désactivé n'a pas d'objectif, il n'en a pas « zéro ».
 */
export function slotMacrosForDay(
  week: Pick<PlanV2Week, "profiles">,
  day: Pick<PlanV2Day, "profileKey">,
  slot: MealSlotKey,
): { readonly calories: number; readonly proteinGrams: number; readonly carbGrams: number; readonly fatGrams: number } | null {
  const profil = profileForDay(week, day);
  const cibles = dailyTargetsForDay(week, day);
  if (!profil || !cibles) return null;

  const part = computeMealDistribution(cibles, profil.slots).slots.find((s) => s.slot === slot);
  if (!part || !part.enabled) return null;

  return {
    calories: part.calories,
    proteinGrams: part.proteinGrams,
    carbGrams: part.carbGrams,
    fatGrams: part.fatGrams,
  };
}

/** Les créneaux ACTIVÉS d'un jour, dans l'ordre canonique. */
export function enabledSlotsForDay(
  week: Pick<PlanV2Week, "profiles">,
  day: Pick<PlanV2Day, "profileKey">,
): readonly MealSlotKey[] {
  const profil = profileForDay(week, day);
  if (!profil) return [];
  const actifs = new Set(profil.slots.filter((s) => s.enabled).map((s) => s.slot));
  return MEAL_SLOT_KEYS.filter((slot) => actifs.has(slot));
}

/**
 * Cible du solveur pour un jour ET un créneau.
 *
 * Simple composition : on résout le profil du jour, puis on délègue
 * INTÉGRALEMENT à `buildRecipeTargetForMealSlot`. Aucun calcul propre.
 */
export function slotTargetForDay(
  week: Pick<PlanV2Week, "profiles">,
  day: Pick<PlanV2Day, "profileKey">,
  slot: MealSlotKey,
): ReturnType<typeof buildRecipeTargetForMealSlot> {
  const profil = profileForDay(week, day);
  if (!profil) return { ok: false, reason: "slot_not_found" };
  return buildRecipeTargetForMealSlot(profil, slot);
}

/**
 * Les recettes proposables pour un créneau.
 *
 * Une recette GÉNÉRIQUE (`slotKey === null`) convient à tous les créneaux ;
 * une recette rattachée à un créneau n'apparaît que dans celui-là. C'est la
 * même règle que `filterRecipesForProfile` applique côté administration
 * (`slot_mismatch`), réécrite ici sous forme de simple filtre parce que
 * l'élève n'a pas besoin du diagnostic entrée par entrée.
 *
 * Le STATUT n'est pas filtré ici : la RLS ne rend que des recettes `active` à
 * un élève. Filtrer une seconde fois côté client donnerait l'illusion que
 * c'est le client qui protège.
 *
 * Tri DÉTERMINISTE : nom en français, puis identifiant pour départager.
 */
export function recipesForSlot(
  recipes: readonly RecipeWithTags[],
  slot: MealSlotKey,
): readonly RecipeWithTags[] {
  return recipes
    .filter((r) => r.slotKey === null || r.slotKey === slot)
    .slice()
    .sort(
      (a, b) =>
        a.recipe.name.localeCompare(b.recipe.name, "fr") || a.recipe.id.localeCompare(b.recipe.id),
    );
}

/** Les jours dans l'ordre canonique lundi → dimanche. */
export function orderedDays(days: readonly PlanV2Day[]): readonly PlanV2Day[] {
  return days.slice().sort((a, b) => compareWeekdays(a.day, b.day));
}

/** Les repas d'un jour, dans l'ordre des créneaux puis du nom. */
export function orderedMeals(meals: readonly PrescribedMeal[]): readonly PrescribedMeal[] {
  return meals
    .slice()
    .sort(
      (a, b) =>
        MEAL_SLOT_KEYS.indexOf(a.slot) - MEAL_SLOT_KEYS.indexOf(b.slot) ||
        a.name.localeCompare(b.name, "fr") ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Un jour vide pour chacune des sept clés manquantes. Utilisé par le
 * constructeur coach : la base garantit sept jours, mais un état de
 * formulaire en cours de construction peut être incomplet.
 */
export function completeWeek(
  days: readonly PlanV2Day[],
  profileKeyParDéfaut: string,
): readonly PlanV2Day[] {
  const parJour = new Map(days.map((d) => [d.day, d]));
  return WEEKDAY_KEYS.map(
    (jour) =>
      parJour.get(jour) ?? {
        id: `nouveau:${jour}`,
        day: jour,
        profileKey: profileKeyParDéfaut,
        status: "non-commence",
        meals: [],
      },
  );
}
