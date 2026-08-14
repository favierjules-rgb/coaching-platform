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
 * LES EXPRESSIONS QUI DÉMENTENT LEURS PROPRES MOTS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE TABLE, ET POURQUOI ELLE PASSE EN PREMIER
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ « Pommes de terre » contient le mot « pommes ». La règle générique des
 * fruits, qui travaille mot à mot, le voyait et rangeait les pommes de terre
 * au rayon FRUITS — c'est le défaut observé en Preview. Aucun ordre entre les
 * règles génériques ne peut le corriger : le mot est réellement là.
 *
 * Il faut donc une couche AU-DESSUS des règles génériques, qui reconnaisse la
 * SUITE DE MOTS et non le mot isolé. Elle est volontairement courte : on n'y
 * met que les expressions dont le rayon est démenti par leurs propres mots,
 * pas un dictionnaire d'aliments — ce serait un second système de
 * catégorisation, et il divergerait du premier.
 *
 * L'ordre de déclaration est l'ordre d'évaluation : la première expression
 * reconnue gagne.
 */
const EXPRESSIONS_SPECIFIQUES: readonly (readonly [string, CategorieCourses])[] = [
  // Le mot « pomme » est un fruit ; « pomme de terre » n'en est pas un.
  ["pomme de terre", "feculents"],
  ["pommes de terre", "feculents"],
  ["patate douce", "feculents"],
  ["patates douces", "feculents"],
  ["patate", "feculents"],
  ["patates", "feculents"],
  ["potato", "feculents"],
  ["potatoes", "feculents"],
];

/**
 * `expression` apparaît-elle dans `normalise` comme une SUITE DE MOTS entiers ?
 *
 * ⚠️ PAS UN `includes` DE CHAÎNE. « pomme de terre » ne doit pas être reconnu
 * dans un hypothétique « compomme de terrestre », et surtout « patate » ne doit
 * pas l'être dans un mot plus long. On compare donc des mots, pas des
 * caractères — la même discipline que `contient` ci-dessous, étendue à
 * plusieurs mots consécutifs.
 */
function contientExpression(normalise: string, expression: string): boolean {
  const mots = normalise.split(" ");
  const cible = expression.split(" ");
  for (let i = 0; i + cible.length <= mots.length; i += 1) {
    if (cible.every((mot, k) => mots[i + k] === mot)) return true;
  }
  return false;
}

/**
 * Le rayon d'un ingrédient, déduit de son libellé puis, à défaut, de son RÔLE.
 *
 * ⚠️ NOTE DE LECTURE — le commentaire d'origine annonçait l'ordre inverse
 * (« le rôle d'abord »), alors que le code a toujours lu le libellé en premier.
 * Corriger l'ordre déplacerait des dizaines d'ingrédients de rayon d'un coup
 * (un « Skyr » de rôle `protein` quitterait LAITIERS pour PROTÉINES) : c'est
 * hors du périmètre de cette correction, qui ne touche qu'aux pommes de terre.
 * Le commentaire est donc aligné sur le code réel, pas l'inverse, et l'écart
 * est signalé plutôt que corrigé en silence.
 */
export function rayonDeLIngredient(ing: Pick<RecipeIngredient, "role" | "name">): CategorieCourses {
  const n = normaliserLibelle(ing.name);
  const contient = (...mots: string[]) => mots.some((m) => n.split(" ").includes(m));

  // ⚠️ LE SPÉCIFIQUE AVANT LE GÉNÉRIQUE. Inverser ces deux blocs ramène le
  // défaut : « Pommes de terre » repart au rayon FRUITS.
  for (const [expression, rayon] of EXPRESSIONS_SPECIFIQUES) {
    if (contientExpression(n, expression)) return rayon;
  }

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
