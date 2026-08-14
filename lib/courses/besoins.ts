/**
 * COURSES C1 — LE MOTEUR : DES CIBLES AUX BESOINS ALIMENTAIRES.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE CALCULE NI MACRO NI PORTION
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Il n'écrit aucune formule. Les cibles viennent de
 * `buildRecipeTargetForMealSlot` (donc de `computeDailyMacroTargets` puis
 * `computeMealDistribution`), et les quantités de `solveRecipe`. Écrire ici un
 * second moteur de portions — même « simple » — créerait deux vérités qui
 * divergeraient au premier ajustement des bornes.
 *
 * Ce module ORCHESTRE : pour chaque date, pour chaque créneau activé, il
 * choisit une recette et demande au solveur de l'adapter.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * IL NE TOUCHE À RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * Aucun client Supabase, aucune RPC, aucune fonction d'écriture n'est importée.
 * Le plan du coach et l'historique alimentaire sont des ENTRÉES en lecture, et
 * Courses est leur consommateur — jamais leur éditeur. C'est structurel, pas
 * une promesse de commentaire, et deux tests le vérifient (C1-27, C1-28).
 */

import {
  type CategorieCourses,
  type BesoinBrut,
  type LigneCourses,
  agregerCourses,
} from "@/lib/courses/agregation";
import { type JourCourses } from "@/lib/courses/periode";
import {
  type PreferencesCourses,
  enviesNormalisees,
  normaliserLibelle,
} from "@/lib/courses/preferences";
import {
  type ContexteSelection,
  type ScoreRecette,
  choisirRecette,
} from "@/lib/courses/selection";
import { MEAL_SLOT_KEYS, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import { buildRecipeTargetForMealSlot } from "@/lib/nutrition/recipe-matching";
import type { PlanV2Week } from "@/lib/nutrition/plan-v2-week";
import { recipesForSlot } from "@/lib/nutrition/plan-v2-week";
import type { RecipeWithTags } from "@/lib/nutrition/recipe-rows";
import type { RecipeIngredient } from "@/lib/nutrition/recipe-types";
import { solveRecipe } from "@/lib/nutrition/recipe-solver";
import type { SolvedIngredient } from "@/lib/nutrition/recipe-solver";

/** Comment l'élève veut construire ses courses — le §9 du cahier des charges. */
export type ModeGeneration = "plan_envies" | "plan_habitudes" | "plan_seul";

export interface EntreeGeneration {
  readonly jours: readonly JourCourses[];
  readonly week: PlanV2Week | null;
  readonly recettes: readonly RecipeWithTags[];
  readonly preferences: PreferencesCourses;
  /** Libellés des favoris de l'élève — A5. */
  readonly favoris: readonly string[];
  /** Libellé normalisé → nombre de consommations récentes — A5.7. */
  readonly habitudes: Readonly<Record<string, number>>;
  readonly mode: ModeGeneration;
}

export type AvertissementCourses =
  | { readonly code: "aucun_plan"; readonly date?: string }
  | { readonly code: "aucune_cible"; readonly date: string; readonly slot: MealSlotKey }
  | { readonly code: "aucune_recette"; readonly date: string; readonly slot: MealSlotKey }
  | { readonly code: "tout_exclu"; readonly date: string; readonly slot: MealSlotKey }
  | {
      readonly code: "cible_approchee";
      readonly date: string;
      readonly slot: MealSlotKey;
      readonly recette: string;
    }
  | {
      readonly code: "cible_impossible";
      readonly date: string;
      readonly slot: MealSlotKey;
      readonly recette: string;
    }
  | { readonly code: "variete_limitee"; readonly slot: MealSlotKey; readonly candidates: number };

export interface RepasRetenu {
  readonly date: string;
  readonly slot: MealSlotKey;
  readonly recetteId: string;
  readonly recetteNom: string;
  readonly statut: "exact" | "approximate" | "impossible";
  readonly score: number;
}

export interface ResultatCourses {
  readonly dates: readonly string[];
  readonly repas: readonly RepasRetenu[];
  readonly lignes: readonly LigneCourses[];
  readonly avertissements: readonly AvertissementCourses[];
}

/**
 * Le rayon d'un ingrédient, déduit de son RÔLE dans la recette puis de son
 * libellé.
 *
 * Le rôle d'abord : c'est une donnée structurée, saisie par le coach, alors que
 * le libellé est du texte. On ne descend au libellé que pour les rôles qui ne
 * disent rien du rayon (`fixed`, `free`).
 */
export function rayonDeLIngredient(ing: Pick<RecipeIngredient, "role" | "name">): CategorieCourses {
  const n = normaliserLibelle(ing.name);
  const contient = (...mots: string[]) => mots.some((m) => n.split(" ").includes(m));

  if (contient("banane", "bananes", "pomme", "pommes", "orange", "kiwi", "fraise", "fraises", "myrtille", "myrtilles"))
    return "fruits";
  if (contient("skyr", "yaourt", "fromage", "lait", "mozzarella", "ricotta", "cottage"))
    return "laitiers";
  if (contient("courgette", "brocoli", "epinard", "epinards", "carotte", "poivron", "tomate", "salade", "haricots"))
    return "legumes";

  switch (ing.role) {
    case "protein":
      return "proteines";
    case "carbohydrate":
      return "feculents";
    case "fat":
      return "autres";
    default:
      return "autres";
  }
}

/**
 * Un ingrédient résolu devient un besoin de courses.
 *
 * ⚠️ L'UNITÉ EST CELLE RÉELLEMENT EXPRIMÉE. Si le solveur a décidé « 2 wraps »,
 * la ligne est en wraps ; s'il a décidé 180 g, elle est en grammes. On ne
 * convertit pas les wraps en grammes « pour homogénéiser » : le poids d'une
 * pièce n'est pas une donnée fiable ici, et une conversion inventée se lirait
 * comme une mesure. C'est la décision 4, et C1-25 la garde.
 */
export function besoinDeLIngredient(
  résolu: SolvedIngredient,
  source: { readonly date: string; readonly slot: MealSlotKey; readonly recetteId: string; readonly recetteNom: string },
): BesoinBrut | null {
  const enUnites = résolu.units !== null && résolu.units > 0 && résolu.unitLabel !== null;
  const quantite = enUnites ? (résolu.units as number) : résolu.displayGrams;
  if (!Number.isFinite(quantite) || quantite <= 0) return null;

  // Le nom de l'unité libre est extrait du libellé du solveur (« 2 wraps
  // (64 g) » → « wrap ») ; à défaut, des grammes.
  const unite = enUnites ? uniteDepuisLibelle(résolu.unitLabel as string) : "g";

  return {
    source: "recipe_ingredient",
    label: résolu.name,
    quantite,
    unite,
    categorie: rayonDeLIngredient({ role: résolu.role, name: résolu.name }),
    provenance: { ...source, quantite, unite },
  };
}

/** « 2 wraps (64 g) » → « wrap ». Le singulier, pour que l'agrégation colle. */
export function uniteDepuisLibelle(libelle: string): string {
  const sansParenthese = libelle.replace(/\([^)]*\)/g, " ");
  const mots = sansParenthese.trim().split(/\s+/).filter((m) => !/^\d/.test(m));
  const brut = mots.join(" ").trim().toLowerCase();
  if (brut === "") return "piece";
  return brut.endsWith("s") && brut.length > 3 ? brut.slice(0, -1) : brut;
}

/**
 * Génère les besoins de la période.
 *
 * La boucle est volontairement plate et lisible : chaque date, chaque créneau
 * activé, une cible, une recette, un appel au solveur. Rien n'est mutualisé
 * entre deux jours — c'est ce qui garantit qu'une période de trois jours
 * n'emprunte rien au quatrième (C1-26).
 */
export function genererCourses(entree: EntreeGeneration): ResultatCourses {
  const avertissements: AvertissementCourses[] = [];
  const repas: RepasRetenu[] = [];
  const besoins: BesoinBrut[] = [];
  const dejaChoisies: Record<string, number> = {};

  if (!entree.week) {
    return {
      dates: entree.jours.map((j) => j.date),
      repas: [],
      lignes: [],
      avertissements: [{ code: "aucun_plan" }],
    };
  }

  // ────────────────────────────────────────────────────────────────────────
  // LE MODE DÉCIDE QUELS SIGNAUX SONT ÉCOUTÉS — JAMAIS QUELLES CIBLES.
  // ────────────────────────────────────────────────────────────────────────
  // ⚠️ LES EXCLUSIONS NE FIGURENT PAS DANS CE TABLEAU, ET C'EST VOULU : elles
  // s'appliquent dans les TROIS modes. « Je préfère éviter le poisson cette
  // fois-ci » n'est pas une préférence de confort qu'un mode pourrait ignorer ;
  // c'est un refus, et il vaut même en « mon plan uniquement ».
  //
  // Le reste est un contrat strict, et il l'est parce que la première version
  // le violait : `plan_habitudes` écoutait encore les envies, donc les deux
  // modes rendaient la même liste dès que l'élève avait coché quelque chose —
  // le choix affiché à l'écran ne changeait rien.
  const SIGNAUX: Readonly<
    Record<ModeGeneration, { readonly envies: boolean; readonly favoris: boolean; readonly habitudes: boolean }>
  > = {
    plan_envies: { envies: true, favoris: true, habitudes: true },
    plan_habitudes: { envies: false, favoris: true, habitudes: true },
    plan_seul: { envies: false, favoris: false, habitudes: false },
  };
  const actifs = SIGNAUX[entree.mode];

  const envies = actifs.envies ? enviesNormalisees(entree.preferences) : [];
  const favoris = actifs.favoris ? entree.favoris : [];
  const habitudes = actifs.habitudes ? entree.habitudes : {};

  for (const jour of entree.jours) {
    const journée = entree.week.days.find((d) => d.day === jour.jour) ?? null;
    if (!journée) {
      avertissements.push({ code: "aucun_plan", date: jour.date });
      continue;
    }
    const profil = entree.week.profiles.find((p) => p.profileKey === journée.profileKey) ?? null;
    if (!profil) {
      avertissements.push({ code: "aucun_plan", date: jour.date });
      continue;
    }

    for (const slot of MEAL_SLOT_KEYS) {
      // LA CIBLE DU CRÉNEAU, telle que le plan la définit pour CE jour.
      const cible = buildRecipeTargetForMealSlot(profil, slot);
      if (!cible.ok) {
        // ⚠️ NE PAS CONFONDRE « ABSENT » ET « CASSÉ ». On boucle sur les SEPT
        // créneaux du vocabulaire ; un profil n'en active qu'une partie. Un
        // créneau absent du profil (`slot_not_found`) ou explicitement
        // désactivé (`slot_disabled`) est le fonctionnement NORMAL du plan —
        // le signaler produirait cinq avertissements par jour, soit trente-cinq
        // sur une semaine, tous faux. Seul un profil sans calories exploitables
        // est une vraie anomalie.
        if (cible.reason === "no_calories") {
          avertissements.push({ code: "aucune_cible", date: jour.date, slot });
        }
        continue;
      }

      const candidates = recipesForSlot(entree.recettes, slot);
      if (candidates.length === 0) {
        avertissements.push({ code: "aucune_recette", date: jour.date, slot });
        continue;
      }

      const ctx: ContexteSelection = {
        envies,
        exclusions: entree.preferences.exclusions,
        favoris,
        habitudes,
        dejaChoisies,
      };
      const choisie: ScoreRecette | null = choisirRecette(candidates, ctx);
      if (!choisie) {
        avertissements.push({ code: "tout_exclu", date: jour.date, slot });
        continue;
      }

      // ⚠️ LE SOLVEUR EXISTANT, SUR LA CIBLE DE CE REPAS. Aucune quantité n'est
      // décidée ici.
      const solution = solveRecipe(choisie.recette.recipe, { target: cible.target });

      dejaChoisies[choisie.recette.recipe.id] = (dejaChoisies[choisie.recette.recipe.id] ?? 0) + 1;
      repas.push({
        date: jour.date,
        slot,
        recetteId: choisie.recette.recipe.id,
        recetteNom: choisie.recette.recipe.name,
        statut: solution.status,
        score: choisie.score,
      });

      if (solution.status === "approximate") {
        avertissements.push({
          code: "cible_approchee",
          date: jour.date,
          slot,
          recette: choisie.recette.recipe.name,
        });
      } else if (solution.status === "impossible") {
        avertissements.push({
          code: "cible_impossible",
          date: jour.date,
          slot,
          recette: choisie.recette.recipe.name,
        });
      }

      for (const résolu of solution.ingredients) {
        const besoin = besoinDeLIngredient(résolu, {
          date: jour.date,
          slot,
          recetteId: choisie.recette.recipe.id,
          recetteNom: choisie.recette.recipe.name,
        });
        if (besoin) besoins.push(besoin);
      }
    }
  }

  // Variété : on le SIGNALE plutôt que de le corriger. Mesuré sur la base
  // réelle, le créneau « déjeuner » n'a qu'UNE recette : répéter n'est alors
  // pas un défaut du moteur, c'est l'état du catalogue, et l'élève gagne à
  // l'apprendre.
  for (const slot of MEAL_SLOT_KEYS) {
    const utilisée = repas.filter((r) => r.slot === slot);
    if (utilisée.length < 2) continue;
    const candidates = recipesForSlot(entree.recettes, slot).length;
    if (candidates < 2) {
      avertissements.push({ code: "variete_limitee", slot, candidates });
    }
  }

  return {
    dates: entree.jours.map((j) => j.date),
    repas,
    lignes: agregerCourses(besoins),
    avertissements,
  };
}

/** Le mode recommandé par le §9 : les envies si l'élève en a exprimé. */
export function modeRecommande(preferences: PreferencesCourses): ModeGeneration {
  return enviesNormalisees(preferences).length > 0 ? "plan_envies" : "plan_habitudes";
}
