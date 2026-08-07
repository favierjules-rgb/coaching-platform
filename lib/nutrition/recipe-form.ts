import {
  RECIPE_TAG_KINDS,
  RECIPE_TAG_VOCABULARY,
  type RecipeSlotKey,
  type RecipeStatus,
  type RecipeTag,
  type RecipeTagKind,
  type RecipeWithTags,
} from "@/lib/nutrition/recipe-rows";
import {
  SCALABLE_ROLES,
  type Recipe,
  type RecipeIngredient,
  type RecipeIngredientRole,
} from "@/lib/nutrition/recipe-types";

/**
 * État PUR du formulaire de recette — aucun React, aucun Supabase.
 *
 * MÊME PARTI PRIS QUE `plan-v2-form.ts` (PR 2 du chantier nutrition) : toute
 * la logique d'édition vit dans des fonctions pures, testables sans rendu et
 * sans base. Le composant ne fait qu'appeler ces fonctions et rendre l'état.
 *
 * TROIS GARANTIES TENUES ICI :
 *   1. les positions sont RENUMÉROTÉES en continu, de 1 à N, avant la
 *      sauvegarde — jamais de doublon, jamais de trou ;
 *   2. une liaison ne peut désigner ni l'ingrédient lui-même, ni un
 *      ingrédient absent de la recette, ni former une boucle ;
 *   3. aucune quantité calculée par le solveur n'entre jamais ici : ce
 *      module ne connaît ni `RecipeSolution`, ni `SolvedIngredient`.
 */

/** Identifiants d'ingrédients générés côté client — voir `newIngredientId`. */
export type IngredientId = string;

export interface RecipeFormIngredient {
  readonly id: IngredientId;
  readonly name: string;
  readonly role: RecipeIngredientRole;
  /** Saisies libres conservées EN TEXTE : « 25,5 » reste tel quel tant qu'il est valide. */
  readonly proteinPer100g: string;
  readonly carbPer100g: string;
  readonly fatPer100g: string;
  readonly referenceGrams: string;
  readonly minGrams: string;
  readonly maxGrams: string;
  readonly unitScalable: boolean;
  readonly maxUnits: string;
  readonly unitName: string;
  readonly fixedLabel: string;
  readonly egg: boolean;
  readonly eggGrams: string;
  readonly linkedToIngredientId: IngredientId | null;
  readonly linkRatioBp: string;
}

export interface RecipeFormState {
  readonly recipeId: string | null;
  readonly coachId: string;
  readonly sourceKey: string | null;
  readonly name: string;
  readonly description: string;
  readonly slotKey: RecipeSlotKey | null;
  readonly status: RecipeStatus;
  readonly ingredients: readonly RecipeFormIngredient[];
  readonly tags: readonly RecipeTag[];
}

/* ─────────────────────────── Création d'état ─────────────────────────── */

/**
 * Identifiant d'un NOUVEL ingrédient, généré côté client.
 *
 * POURQUOI CÔTÉ CLIENT. `linked_to_ingredient_id` doit pouvoir désigner un
 * autre ingrédient du MÊME payload, y compris quand les deux sont nouveaux.
 * Laisser la base attribuer les identifiants rendrait cette référence
 * impossible à exprimer avant la sauvegarde.
 */
export function newIngredientId(): IngredientId {
  return globalThis.crypto.randomUUID();
}

export function createEmptyIngredient(id: IngredientId = newIngredientId()): RecipeFormIngredient {
  return {
    id,
    name: "",
    role: "protein",
    proteinPer100g: "",
    carbPer100g: "",
    fatPer100g: "",
    referenceGrams: "",
    minGrams: "",
    maxGrams: "",
    unitScalable: false,
    maxUnits: "",
    unitName: "",
    fixedLabel: "",
    egg: false,
    eggGrams: "",
    linkedToIngredientId: null,
    linkRatioBp: "",
  };
}

export function createBlankRecipeForm(coachId: string): RecipeFormState {
  return {
    recipeId: null,
    coachId,
    sourceKey: null,
    name: "",
    description: "",
    slotKey: null,
    status: "draft",
    ingredients: [createEmptyIngredient()],
    tags: [],
  };
}

const nombre = (valeur: number | null | undefined): string =>
  valeur === null || valeur === undefined ? "" : String(valeur);

/** Recette lue en base → état de formulaire. Aucune perte, aucun arrondi. */
export function createRecipeFormFromRecord(
  record: RecipeWithTags,
  coachId: string,
  sourceKey: string | null = null,
): RecipeFormState {
  return {
    recipeId: record.recipe.id,
    coachId,
    sourceKey,
    name: record.recipe.name,
    // La description est une donnée du coach : elle est relue telle quelle.
    // La perdre ici la ferait écraser en base au premier enregistrement,
    // puisque `toRecipeSavePayload` réémet toujours ce champ.
    description: record.description ?? "",
    slotKey: record.slotKey,
    status: record.status,
    ingredients: record.recipe.ingredients.map((i) => ({
      id: i.id,
      name: i.name,
      role: i.role,
      proteinPer100g: nombre(i.proteinPer100g),
      carbPer100g: nombre(i.carbPer100g),
      fatPer100g: nombre(i.fatPer100g),
      referenceGrams: nombre(i.referenceGrams),
      minGrams: nombre(i.minGrams),
      maxGrams: nombre(i.maxGrams),
      unitScalable: i.unitScalable === true,
      maxUnits: nombre(i.maxUnits),
      unitName: i.unitName ?? "",
      fixedLabel: i.fixedLabel ?? "",
      egg: i.egg === true,
      eggGrams: nombre(i.eggGrams),
      linkedToIngredientId: i.linkedToIngredientId ?? null,
      linkRatioBp: nombre(i.linkRatioBp),
    })),
    tags: [...record.tags],
  };
}

/**
 * Une COPIE indépendante d'une recette — pour le bouton « Dupliquer ».
 *
 * TROIS CHOSES DOIVENT CHANGER, et elles sont toutes obligatoires :
 *
 *   1. `recipeId` repasse à `null`, sans quoi la RPC METTRAIT À JOUR
 *      l'original au lieu d'en créer une seconde ;
 *   2. chaque ingrédient reçoit un identifiant NEUF — un identifiant
 *      appartenant déjà à une autre recette est refusé par
 *      `save_nutrition_recipe` (`INGREDIENT_FROM_ANOTHER_RECIPE`) ;
 *   3. `sourceKey` repasse à `null` : cette clé est l'identité d'une fixture
 *      importée, et son index unique partiel refuserait un doublon.
 *
 * Les LIAISONS entre ingrédients sont réécrites vers les nouveaux
 * identifiants : une copie dont les liaisons pointeraient vers l'original
 * mélangerait les deux recettes au premier enregistrement.
 *
 * La copie naît en BROUILLON : dupliquer ne publie rien.
 *
 * `generateId` est injectable pour que les tests soient déterministes.
 */
export function duplicateRecipeForm(
  state: RecipeFormState,
  nom: string,
  generateId: () => IngredientId = newIngredientId,
): RecipeFormState {
  const nouvelId = new Map<IngredientId, IngredientId>();
  for (const ingrédient of state.ingredients) {
    nouvelId.set(ingrédient.id, generateId());
  }
  return {
    ...state,
    recipeId: null,
    sourceKey: null,
    name: nom,
    status: "draft",
    ingredients: state.ingredients.map((ingrédient) => ({
      ...ingrédient,
      id: nouvelId.get(ingrédient.id) ?? generateId(),
      // Une liaison vers un ingrédient absent de la recette est déjà
      // impossible (clé étrangère composite) ; le `?? null` couvre le cas
      // d'un état de formulaire incohérent plutôt que de le propager.
      linkedToIngredientId:
        ingrédient.linkedToIngredientId === null
          ? null
          : (nouvelId.get(ingrédient.linkedToIngredientId) ?? null),
      linkRatioBp:
        ingrédient.linkedToIngredientId !== null && nouvelId.has(ingrédient.linkedToIngredientId)
          ? ingrédient.linkRatioBp
          : "",
    })),
    tags: [...state.tags],
  };
}

/* ─────────────────────────── Ingrédients ─────────────────────────── */

export function addIngredient(state: RecipeFormState, id?: IngredientId): RecipeFormState {
  return { ...state, ingredients: [...state.ingredients, createEmptyIngredient(id)] };
}

/**
 * Duplique un ingrédient. Le doublon reçoit un NOUVEL identifiant et perd sa
 * liaison : dupliquer un ingrédient lié créerait sinon deux enfants d'un même
 * parent, ce qui double silencieusement la quantité liée.
 */
export function duplicateIngredient(
  state: RecipeFormState,
  id: IngredientId,
  nouvelId: IngredientId = newIngredientId(),
): RecipeFormState {
  const index = state.ingredients.findIndex((i) => i.id === id);
  if (index < 0) return state;
  const copie: RecipeFormIngredient = {
    ...state.ingredients[index],
    id: nouvelId,
    name: `${state.ingredients[index].name} (copie)`,
    linkedToIngredientId: null,
    linkRatioBp: "",
  };
  const suivants = [...state.ingredients];
  suivants.splice(index + 1, 0, copie);
  return { ...state, ingredients: suivants };
}

/** Ingrédients qui dépendent de `id` — à consulter AVANT un retrait. */
export function dependentsOf(state: RecipeFormState, id: IngredientId): readonly RecipeFormIngredient[] {
  return state.ingredients.filter((i) => i.linkedToIngredientId === id);
}

/**
 * Retire un ingrédient.
 *
 * Les liaisons qui le désignaient sont ROMPUES explicitement (parent et part
 * remis à vide), jamais laissées pendantes. L'interface doit avertir AVANT
 * d'appeler : `dependentsOf` donne la liste exacte.
 */
export function removeIngredient(state: RecipeFormState, id: IngredientId): RecipeFormState {
  return {
    ...state,
    ingredients: state.ingredients
      .filter((i) => i.id !== id)
      .map((i) =>
        i.linkedToIngredientId === id ? { ...i, linkedToIngredientId: null, linkRatioBp: "" } : i,
      ),
  };
}

/** Déplace un ingrédient d'un cran. L'ordre du tableau EST l'ordre affiché. */
export function moveIngredient(
  state: RecipeFormState,
  id: IngredientId,
  direction: -1 | 1,
): RecipeFormState {
  const index = state.ingredients.findIndex((i) => i.id === id);
  const cible = index + direction;
  if (index < 0 || cible < 0 || cible >= state.ingredients.length) return state;
  const suivants = [...state.ingredients];
  [suivants[index], suivants[cible]] = [suivants[cible], suivants[index]];
  return { ...state, ingredients: suivants };
}

export function updateIngredient(
  state: RecipeFormState,
  id: IngredientId,
  patch: Partial<RecipeFormIngredient>,
): RecipeFormState {
  return {
    ...state,
    ingredients: state.ingredients.map((i) => {
      if (i.id !== id) return i;
      const suivant = { ...i, ...patch };
      // Cohérences que la base impose : on les tient ici plutôt que de laisser
      // partir un payload qu'elle refusera.
      if (!suivant.unitScalable) {
        suivant.maxUnits = "";
        suivant.unitName = "";
      }
      if (!suivant.egg) {
        suivant.eggGrams = "";
      }
      if (suivant.linkedToIngredientId === null) {
        suivant.linkRatioBp = "";
      }
      // Un ingrédient ne peut pas être lié à lui-même.
      if (suivant.linkedToIngredientId === suivant.id) {
        suivant.linkedToIngredientId = null;
        suivant.linkRatioBp = "";
      }
      return suivant;
    }),
  };
}

/* ─────────────────────────── Étiquettes ─────────────────────────── */

/**
 * Coche/décoche une étiquette. Une valeur HORS vocabulaire est refusée —
 * l'état n'est pas modifié. Il n'existe aucun chemin de saisie libre.
 */
export function toggleTag(
  state: RecipeFormState,
  kind: RecipeTagKind,
  value: string,
  checked: boolean,
): RecipeFormState {
  if (!RECIPE_TAG_KINDS.includes(kind)) return state;
  if (!RECIPE_TAG_VOCABULARY[kind].includes(value)) return state;
  const présente = state.tags.some((t) => t.kind === kind && t.value === value);
  if (checked && !présente) {
    return { ...state, tags: [...state.tags, { kind, value }] };
  }
  if (!checked && présente) {
    return { ...state, tags: state.tags.filter((t) => !(t.kind === kind && t.value === value)) };
  }
  return state;
}

export function hasTag(state: RecipeFormState, kind: RecipeTagKind, value: string): boolean {
  return state.tags.some((t) => t.kind === kind && t.value === value);
}

/* ─────────────────────────── Validation locale ─────────────────────────── */

export type RecipeFormIssueCode =
  | "name_empty"
  | "no_ingredient"
  | "ingredient_name_empty"
  | "macro_invalid"
  | "reference_invalid"
  | "bounds_incoherent"
  | "scalable_without_reference"
  | "unit_without_name"
  | "unit_scalable_incoherent"
  | "egg_fields_incoherent"
  | "link_ratio_invalid"
  | "link_unknown"
  | "link_cycle";

export interface RecipeFormIssue {
  readonly code: RecipeFormIssueCode;
  readonly ingredientId?: IngredientId;
  readonly field?: string;
  readonly message: string;
}

function lireNombre(texte: string): number | null {
  const nettoyé = texte.trim().replace(",", ".");
  if (nettoyé === "") return null;
  const n = Number(nettoyé);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Validation LOCALE : retour immédiat à l'écran, jamais l'autorité.
 *
 * L'arbitre de l'activation reste `nutrition_recipe_blocking_issue`, appelée
 * dans la transaction de la RPC. Cette fonction évite un aller-retour réseau
 * pour des erreurs évidentes ; elle ne remplace pas la base.
 */
export function validateRecipeForm(state: RecipeFormState): readonly RecipeFormIssue[] {
  const issues: RecipeFormIssue[] = [];

  if (state.name.trim().length === 0) {
    issues.push({ code: "name_empty", field: "name", message: "Donne un nom à la recette." });
  }
  if (state.ingredients.length === 0) {
    issues.push({ code: "no_ingredient", message: "Ajoute au moins un ingrédient." });
  }

  const ids = new Set(state.ingredients.map((i) => i.id));

  for (const ing of state.ingredients) {
    if (ing.name.trim().length === 0) {
      issues.push({
        code: "ingredient_name_empty", ingredientId: ing.id, field: "name",
        message: "Cet ingrédient n'a pas de nom.",
      });
    }
    for (const [champ, texte] of [
      ["proteinPer100g", ing.proteinPer100g],
      ["carbPer100g", ing.carbPer100g],
      ["fatPer100g", ing.fatPer100g],
    ] as const) {
      const n = lireNombre(texte);
      if (n === null || Number.isNaN(n) || n < 0) {
        issues.push({
          code: "macro_invalid", ingredientId: ing.id, field: champ,
          message: "Renseigne une valeur pour 100 g, positive ou nulle.",
        });
      }
    }
    const référence = lireNombre(ing.referenceGrams);
    if (référence === null || Number.isNaN(référence) || référence < 0) {
      issues.push({
        code: "reference_invalid", ingredientId: ing.id, field: "referenceGrams",
        message: "Renseigne une quantité de référence positive ou nulle.",
      });
    } else if (SCALABLE_ROLES.includes(ing.role as (typeof SCALABLE_ROLES)[number]) && référence <= 0) {
      // Sans référence non nulle, le ratio du groupe serait indéterminé :
      // une division par zéro déguisée.
      issues.push({
        code: "scalable_without_reference", ingredientId: ing.id, field: "referenceGrams",
        message: "Un ingrédient ajustable a besoin d'une quantité de référence supérieure à 0.",
      });
    }

    const min = lireNombre(ing.minGrams);
    const max = lireNombre(ing.maxGrams);
    if (
      (min !== null && (Number.isNaN(min) || min < 0)) ||
      (max !== null && (Number.isNaN(max) || max < 0)) ||
      (min !== null && max !== null && !Number.isNaN(min) && !Number.isNaN(max) && min > max)
    ) {
      issues.push({
        code: "bounds_incoherent", ingredientId: ing.id, field: "minGrams",
        message: "Le minimum doit rester inférieur ou égal au maximum, et les deux positifs.",
      });
    }

    if (ing.unitScalable && ing.unitName.trim().length === 0) {
      issues.push({
        code: "unit_without_name", ingredientId: ing.id, field: "unitName",
        message: "Donne un nom à l'unité (« wrap », « pain », « tranche »).",
      });
    }

    // Miroir de `unit_scalable_incoherent`. Sans ces deux règles, l'écran
    // annonçait « exploitable » sur une recette que la base refuse d'activer.
    if (ing.unitScalable) {
      if (référence !== null && !Number.isNaN(référence) && référence <= 0) {
        issues.push({
          code: "unit_scalable_incoherent", ingredientId: ing.id, field: "referenceGrams",
          message: "Un ingrédient en mode unité a besoin du poids d'une unité, supérieur à 0.",
        });
      }
      const maxUnités = lireNombre(ing.maxUnits);
      if (
        maxUnités !== null &&
        (Number.isNaN(maxUnités) || maxUnités < 1 || !Number.isInteger(maxUnités))
      ) {
        issues.push({
          code: "unit_scalable_incoherent", ingredientId: ing.id, field: "maxUnits",
          message: "Le nombre maximal d'unités doit être un entier supérieur ou égal à 1.",
        });
      }
    }

    // Miroir de `egg_fields_incoherent`. Un poids d'œuf nul produisait une
    // division par zéro dans l'aperçu avant que la base ne refuse la recette.
    if (ing.egg) {
      const poidsOeuf = lireNombre(ing.eggGrams);
      if (poidsOeuf !== null && (Number.isNaN(poidsOeuf) || poidsOeuf <= 0)) {
        issues.push({
          code: "egg_fields_incoherent", ingredientId: ing.id, field: "eggGrams",
          message: "Le poids d'un œuf doit être strictement supérieur à 0.",
        });
      }
    }

    if (ing.linkedToIngredientId !== null) {
      if (!ids.has(ing.linkedToIngredientId)) {
        issues.push({
          code: "link_unknown", ingredientId: ing.id, field: "linkedToIngredientId",
          message: "L'ingrédient lié n'existe plus dans cette recette.",
        });
      }
      const ratio = lireNombre(ing.linkRatioBp);
      if (ratio === null || Number.isNaN(ratio) || ratio <= 0 || !Number.isInteger(ratio)) {
        issues.push({
          code: "link_ratio_invalid", ingredientId: ing.id, field: "linkRatioBp",
          message: "La part liée doit être un entier de points de base strictement positif.",
        });
      }
    }
  }

  for (const ing of state.ingredients) {
    if (detectLinkCycle(state, ing.id)) {
      issues.push({
        code: "link_cycle", ingredientId: ing.id, field: "linkedToIngredientId",
        message: "Cette liaison forme une boucle.",
      });
      break;
    }
  }

  return issues;
}

/** Remonte la chaîne des parents, bornée au nombre d'ingrédients. */
export function detectLinkCycle(state: RecipeFormState, départ: IngredientId): boolean {
  const parents = new Map(state.ingredients.map((i) => [i.id, i.linkedToIngredientId]));
  let courant = parents.get(départ) ?? null;
  let profondeur = 0;
  while (courant !== null && profondeur <= state.ingredients.length) {
    if (courant === départ) return true;
    courant = parents.get(courant) ?? null;
    profondeur += 1;
  }
  return profondeur > state.ingredients.length;
}

/* ─────────────────────────── Sortie ─────────────────────────── */

function versNombre(texte: string, défaut: number | null = null): number | null {
  const n = lireNombre(texte);
  if (n === null || Number.isNaN(n)) return défaut;
  return n;
}

/** Poids d'un œuf utilisable par le solveur, ou `null` — jamais 0. */
function poidsOeufValide(texte: string): number | null {
  const n = versNombre(texte);
  return n !== null && n > 0 ? n : null;
}

/**
 * État → charge utile de `save_nutrition_recipe`.
 *
 * RENUMÉROTATION CONTINUE : les positions sont réattribuées 1..N dans l'ordre
 * d'affichage. Aucun trou, aucun doublon — quelles qu'aient été les
 * manipulations dans le formulaire.
 */
export function toRecipeSavePayload(
  state: RecipeFormState,
  status: RecipeStatus = state.status,
): Record<string, unknown> {
  return {
    recipe: {
      id: state.recipeId,
      coach_id: state.coachId,
      name: state.name.trim(),
      description: state.description.trim() === "" ? null : state.description.trim(),
      slot_key: state.slotKey,
      status,
      source_key: state.sourceKey,
    },
    ingredients: state.ingredients.map((ing, index) => ({
      id: ing.id,
      position: index + 1,
      name: ing.name.trim(),
      role: ing.role,
      protein_per_100g: versNombre(ing.proteinPer100g, 0),
      carb_per_100g: versNombre(ing.carbPer100g, 0),
      fat_per_100g: versNombre(ing.fatPer100g, 0),
      reference_grams: versNombre(ing.referenceGrams, 0),
      min_grams: versNombre(ing.minGrams),
      max_grams: versNombre(ing.maxGrams),
      unit_scalable: ing.unitScalable,
      max_units: ing.unitScalable ? versNombre(ing.maxUnits) : null,
      unit_name: ing.unitScalable && ing.unitName.trim() !== "" ? ing.unitName.trim() : null,
      fixed_label: ing.fixedLabel.trim() === "" ? null : ing.fixedLabel.trim(),
      egg: ing.egg,
      egg_grams: ing.egg ? versNombre(ing.eggGrams) : null,
      linked_to_ingredient_id: ing.linkedToIngredientId,
      link_ratio_bp: ing.linkedToIngredientId ? versNombre(ing.linkRatioBp) : null,
    })),
    tags: state.tags.map((t) => ({ kind: t.kind, value: t.value })),
  };
}

/**
 * État → `Recipe` en mémoire, pour l'APERÇU uniquement.
 *
 * ⚠️ Sens unique. Ce `Recipe` sert à alimenter `solveRecipe` ; la
 * `RecipeSolution` obtenue ne revient JAMAIS dans le formulaire, et aucune
 * fonction de ce module n'accepte de solution en entrée.
 */
export function toPreviewRecipe(state: RecipeFormState): Recipe {
  const ingredients: RecipeIngredient[] = state.ingredients.map((ing) => ({
    id: ing.id,
    name: ing.name.trim() === "" ? "Sans nom" : ing.name.trim(),
    role: ing.role,
    proteinPer100g: versNombre(ing.proteinPer100g, 0) ?? 0,
    carbPer100g: versNombre(ing.carbPer100g, 0) ?? 0,
    fatPer100g: versNombre(ing.fatPer100g, 0) ?? 0,
    referenceGrams: versNombre(ing.referenceGrams, 0) ?? 0,
    minGrams: versNombre(ing.minGrams),
    maxGrams: versNombre(ing.maxGrams),
    unitScalable: ing.unitScalable,
    maxUnits: ing.unitScalable ? versNombre(ing.maxUnits) : null,
    unitName: ing.unitScalable ? (ing.unitName.trim() === "" ? null : ing.unitName.trim()) : null,
    fixedLabel: ing.fixedLabel.trim() === "" ? null : ing.fixedLabel.trim(),
    egg: ing.egg,
    // Un poids d'œuf nul ou négatif est une saisie en cours, pas une donnée :
    // le passer au solveur produirait une division par zéro visible à l'écran
    // (Infinity, NaN). On retombe sur le poids par défaut du solveur, et la
    // validation signale la saisie près du champ.
    eggGrams: ing.egg ? poidsOeufValide(ing.eggGrams) : null,
    linkedToIngredientId: ing.linkedToIngredientId,
    linkRatioBp: ing.linkedToIngredientId ? versNombre(ing.linkRatioBp) : null,
  }));
  return {
    id: state.recipeId ?? "preview",
    name: state.name,
    slot: state.slotKey,
    ingredients,
  };
}
