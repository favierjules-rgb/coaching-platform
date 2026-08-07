import { MEAL_SLOT_LABELS_FR } from "@/lib/nutrition/meal-distribution";
import {
  RECIPE_TAG_VOCABULARY,
  type RecipeSlotKey,
  type RecipeStatus,
  type RecipeTagKind,
} from "@/lib/nutrition/recipe-rows";
import type { RecipeIngredientRole } from "@/lib/nutrition/recipe-types";

/**
 * Libellés FRANÇAIS de l'administration des recettes.
 *
 * SÉPARATION STRICTE. Les CLÉS TECHNIQUES vivent dans `recipe-rows.ts` et
 * `recipe-types.ts` (PR A) et sont la seule chose écrite en base. Ce fichier
 * ne fait que les habiller pour l'écran : il n'en invente aucune, n'en
 * redéfinit aucune, et un test vérifie que chaque clé du vocabulaire a bien
 * son libellé — et réciproquement.
 *
 * Les créneaux réutilisent `MEAL_SLOT_LABELS_FR` du modèle v2 : les six
 * valeurs sont les mêmes, il n'y a aucune raison d'en tenir une seconde liste.
 */

export const RECIPE_ROLE_LABELS_FR: Readonly<Record<RecipeIngredientRole, string>> = {
  protein: "Protéines (ajustable)",
  carbohydrate: "Glucides (ajustable)",
  fat: "Lipides (ajustable)",
  fixed: "Quantité fixe",
  free: "À volonté",
};

/** Explication courte du rôle, affichée sous le sélecteur. */
export const RECIPE_ROLE_HINTS_FR: Readonly<Record<RecipeIngredientRole, string>> = {
  protein: "Sa quantité varie pour atteindre la cible en protéines.",
  carbohydrate: "Sa quantité varie pour atteindre la cible en glucides.",
  fat: "Sa quantité varie pour atteindre la cible en lipides.",
  fixed: "Quantité figée : pain, tranche de fromage, œuf compté à l'unité.",
  free: "Exclu du calcul : légumes verts, épices, édulcorant.",
};

/**
 * « Publiée » plutôt que « Active » depuis la PR D : c'est le mot que
 * l'interface emploie partout ailleurs pour désigner un contenu visible par
 * les élèves (`AdminDocumentStatus` dit déjà « publié »), et le couple
 * Publier / Dépublier n'a de sens qu'avec lui. La VALEUR en base reste
 * `'active'` — la renommer casserait les trois policies élèves qui la
 * comparent littéralement, pour un gain purement cosmétique.
 */
export const RECIPE_STATUS_LABELS_FR: Readonly<Record<RecipeStatus, string>> = {
  draft: "Brouillon",
  active: "Publiée",
  archived: "Archivée",
};

export const RECIPE_SLOT_LABELS_FR: Readonly<Record<RecipeSlotKey, string>> = MEAL_SLOT_LABELS_FR;

/** Libellé d'un créneau, ou « Toutes les occasions » pour une recette générique. */
export function describeSlot(slot: RecipeSlotKey | null): string {
  return slot === null ? "Toutes les occasions" : RECIPE_SLOT_LABELS_FR[slot];
}

export const RECIPE_TAG_KIND_LABELS_FR: Readonly<Record<RecipeTagKind, string>> = {
  allergen: "Allergènes présents",
  intolerance: "Intolérances concernées",
  diet: "Régimes compatibles",
  excludes: "Catégories présentes",
};

/**
 * Un libellé par clé du vocabulaire contrôlé. Aucune clé n'est saisie
 * librement : ce dictionnaire est la seule surface d'affichage.
 */
export const RECIPE_TAG_VALUE_LABELS_FR: Readonly<Record<RecipeTagKind, Readonly<Record<string, string>>>> = {
  allergen: {
    gluten: "Gluten",
    milk: "Lait",
    egg: "Œuf",
    peanut: "Arachide",
    tree_nut: "Fruits à coque",
    soy: "Soja",
    fish: "Poisson",
    shellfish: "Crustacés et mollusques",
    sesame: "Sésame",
    mustard: "Moutarde",
    celery: "Céleri",
    lupin: "Lupin",
    sulfites: "Sulfites",
  },
  intolerance: {
    lactose: "Lactose",
    gluten: "Gluten",
    fructose: "Fructose",
    fodmap: "FODMAP",
  },
  diet: {
    vegetarian: "Végétarien",
    vegan: "Végétalien",
    pescetarian: "Pescétarien",
    halal: "Halal",
    kosher: "Casher",
  },
  excludes: {
    pork: "Porc",
    beef: "Bœuf",
    veal: "Veau",
    lamb: "Agneau",
    poultry: "Volaille",
    red_meat: "Viande rouge",
    offal: "Abats",
    seafood: "Fruits de mer",
    raw_fish: "Poisson cru",
    raw_egg: "Œuf cru",
    alcohol: "Alcool",
    caffeine: "Caféine",
    spicy: "Épicé",
    mushroom: "Champignons",
    onion_garlic: "Oignon et ail",
    added_sugar: "Sucres ajoutés",
    artificial_sweetener: "Édulcorants",
  },
};

/** Libellé d'une étiquette, ou la clé technique si elle est inconnue (jamais silencieux). */
export function describeTag(kind: RecipeTagKind, value: string): string {
  return RECIPE_TAG_VALUE_LABELS_FR[kind][value] ?? value;
}

/** Les valeurs d'une famille, triées par libellé français — ordre d'affichage stable. */
export function tagOptionsFor(kind: RecipeTagKind): readonly { value: string; label: string }[] {
  return [...RECIPE_TAG_VOCABULARY[kind]]
    .map((value) => ({ value, label: describeTag(kind, value) }))
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

/**
 * Message français d'un code de blocage rendu par
 * `nutrition_recipe_blocking_issue`. La base reste l'arbitre ; ce
 * dictionnaire ne fait que rendre son verdict lisible.
 */
export const RECIPE_BLOCKING_MESSAGES_FR: Readonly<Record<string, string>> = {
  recipe_not_found: "Cette recette est introuvable.",
  recipe_name_empty: "Donne un nom à la recette.",
  recipe_status_unknown: "Le statut de cette recette n'est pas reconnu.",
  recipe_without_ingredient: "Ajoute au moins un ingrédient.",
  ingredient_positions_not_contiguous:
    "L'ordre des ingrédients comporte un trou : réordonne-les avant d'activer.",
  ingredient_role_unknown: "Un ingrédient porte un rôle inconnu.",
  ingredient_macro_negative: "Une valeur nutritionnelle est négative.",
  ingredient_bounds_incoherent: "Un minimum dépasse son maximum.",
  ingredient_link_outside_recipe: "Une liaison pointe vers une autre recette.",
  ingredient_link_ratio_invalid: "Une liaison n'a pas de part valide.",
  ingredient_link_cycle: "Les liaisons forment une boucle.",
  scalable_ingredient_without_reference:
    "Un ingrédient ajustable n'a pas de quantité de référence : sans elle, sa quantité ne peut pas varier.",
  unit_scalable_incoherent:
    "Un ingrédient en mode unité n'a pas de nom d'unité, ou pas de quantité de référence.",
  unit_fields_without_unit_scalable:
    "Un ingrédient porte des champs d'unité sans être en mode unité.",
  egg_fields_incoherent: "Un poids d'œuf est renseigné sur un ingrédient qui n'est pas un œuf.",
};

export function describeBlockingIssue(code: string | null | undefined): string | null {
  if (!code) return null;
  return RECIPE_BLOCKING_MESSAGES_FR[code] ?? `Cette recette n'est pas exploitable (${code}).`;
}
