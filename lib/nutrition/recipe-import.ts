import {
  createBlankRecipeForm,
  validateRecipeForm,
  type RecipeFormIngredient,
  type RecipeFormState,
} from "@/lib/nutrition/recipe-form";
import {
  RECIPE_INGREDIENT_ROLES,
  RECIPE_SLOT_KEYS,
  RECIPE_TAG_KINDS,
  RECIPE_TAG_VOCABULARY,
  type RecipeSlotKey,
  type RecipeTagKind,
} from "@/lib/nutrition/recipe-rows";
import type { RecipeIngredientRole } from "@/lib/nutrition/recipe-types";

/**
 * IMPORT DE RECETTES — analyse pure, sans la moindre écriture.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POURQUOI DU JSON, ET PAS DU CSV
 * ─────────────────────────────────────────────────────────────────────────
 * Une recette n'est pas une ligne : c'est un objet qui contient une LISTE
 * d'ingrédients, chacun portant dix-huit champs, dont deux qui désignent un
 * AUTRE ingrédient de la même recette. En CSV, il faudrait soit une ligne par
 * ingrédient avec une colonne de regroupement, soit encoder la liste dans une
 * cellule — deux façons de fabriquer un format fragile que personne ne remplit
 * correctement à la main.
 *
 * Et surtout : le dépôt n'a AUCUNE dépendance capable de lire un CSV
 * (vérifié : ni papaparse, ni csv-parse, ni xlsx dans package.json). Il
 * faudrait soit en ajouter une — interdit sans nécessité — soit écrire un
 * analyseur qui gère les guillemets, les séparateurs échappés et les retours
 * à la ligne dans les cellules. `JSON.parse` est natif, exact, et refuse
 * bruyamment ce qu'il ne comprend pas.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LA VALIDATION N'EST PAS RÉÉCRITE ICI
 * ─────────────────────────────────────────────────────────────────────────
 * Chaque recette lue est convertie en `RecipeFormState` — exactement l'état
 * que produirait le formulaire — puis soumise à `validateRecipeForm`, la
 * fonction qui valide déjà toute saisie manuelle.
 *
 * C'est ce qui garantit la propriété la plus importante de cet import : une
 * recette importée valide se comporte EXACTEMENT comme une recette créée à la
 * main. Elles ont franchi le même contrôle, mot pour mot. Une seconde
 * validation « spéciale import » finirait par diverger, et un jour le
 * catalogue contiendrait des recettes que le formulaire aurait refusées.
 *
 * Ce module n'ajoute donc que les erreurs que le formulaire ne peut PAS
 * commettre : un JSON illisible, un rôle inconnu, un créneau inconnu, une
 * étiquette hors vocabulaire, une liaison vers une position inexistante.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LES LIAISONS SE DÉSIGNENT PAR POSITION
 * ─────────────────────────────────────────────────────────────────────────
 * Le fichier ne manipule aucun identifiant : `linkedToPosition` renvoie au
 * rang d'un ingrédient DANS LA MÊME recette. Un fichier n'a donc aucun moyen
 * de désigner une ligne appartenant à quelqu'un d'autre — la sécurité ne
 * repose pas sur une vérification, mais sur l'absence de vocabulaire pour
 * l'exprimer.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CE MODULE N'ÉCRIT RIEN, ET NE DÉCIDE RIEN
 * ─────────────────────────────────────────────────────────────────────────
 * Il lit un texte et rend un diagnostic. L'écriture passe par la RPC
 * `import_nutrition_recipes` (migration 20260818090000), qui détermine
 * elle-même le propriétaire, impose le statut « brouillon », et annule le lot
 * entier à la moindre erreur. Un diagnostic optimiste ici n'ouvre donc rien.
 */

// ────────────────────────────────────────────────────────────────────────────
// Le format attendu — miroir du VRAI schéma, et rien de plus
// ────────────────────────────────────────────────────────────────────────────

/** Un ingrédient tel qu'il s'écrit dans le fichier. */
export interface ImportIngredientInput {
  readonly name?: unknown;
  readonly role?: unknown;
  readonly proteinPer100g?: unknown;
  readonly carbPer100g?: unknown;
  readonly fatPer100g?: unknown;
  readonly referenceGrams?: unknown;
  readonly minGrams?: unknown;
  readonly maxGrams?: unknown;
  readonly unitName?: unknown;
  readonly maxUnits?: unknown;
  readonly fixedLabel?: unknown;
  readonly eggGrams?: unknown;
  readonly linkedToPosition?: unknown;
  readonly linkRatioBp?: unknown;
}

/** Une recette telle qu'elle s'écrit dans le fichier. */
export interface ImportRecipeInput {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly slot?: unknown;
  readonly tags?: unknown;
  readonly ingredients?: unknown;
}

export interface ImportIssue {
  /** « recette », « ingrédient 2 »… — où se situe le problème. */
  readonly where: string;
  readonly message: string;
}

export interface AnalyzedRecipe {
  /** Rang dans le fichier, à partir de 1 — ce que le coach voit. */
  readonly line: number;
  readonly name: string;
  readonly issues: readonly ImportIssue[];
  readonly valid: boolean;
  /** Une recette du MÊME coach porte déjà ce nom (comparaison normalisée). */
  readonly duplicate: boolean;
  /** Décochée par le coach = ne sera pas importée. */
  readonly ingredientCount: number;
  /** Charge utile prête pour la RPC. `null` si la recette est invalide. */
  readonly payload: Record<string, unknown> | null;
}

export interface ImportAnalysis {
  /** Erreur empêchant toute lecture (JSON illisible, structure absente). */
  readonly fileError: string | null;
  readonly recipes: readonly AnalyzedRecipe[];
  readonly total: number;
  readonly valid: number;
  readonly invalid: number;
  readonly duplicates: number;
}

const ANALYSE_VIDE = { recipes: [], total: 0, valid: 0, invalid: 0, duplicates: 0 } as const;

/** Limite alignée sur celle de la RPC : mieux vaut le dire avant d'envoyer. */
export const IMPORT_MAX_RECIPES = 200;

// ────────────────────────────────────────────────────────────────────────────
// Normalisation des noms — pour la détection de doublons
// ────────────────────────────────────────────────────────────────────────────

/**
 * « Bol Poulet-Riz  » et « bol poulet riz » sont le même nom pour un humain.
 * On retire les accents, la casse, la ponctuation et les espaces multiples —
 * mais on ne fait que SIGNALER : rien n'est bloqué, rien n'est écrasé.
 */
export function normalizeRecipeName(nom: string): string {
  return nom
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ────────────────────────────────────────────────────────────────────────────
// Lecture tolérante des scalaires
// ────────────────────────────────────────────────────────────────────────────

function texte(valeur: unknown): string {
  return typeof valeur === "string" ? valeur.trim() : "";
}

/** `""` quand la valeur est absente : c'est ce qu'attend `RecipeFormState`. */
function nombreTexte(valeur: unknown): string {
  if (typeof valeur === "number" && Number.isFinite(valeur)) return String(valeur);
  if (typeof valeur === "string" && valeur.trim() !== "") return valeur.trim();
  return "";
}

function entierOuNull(valeur: unknown): number | null {
  const n = typeof valeur === "number" ? valeur : Number(valeur);
  return Number.isInteger(n) ? n : null;
}

// ────────────────────────────────────────────────────────────────────────────
// L'analyse
// ────────────────────────────────────────────────────────────────────────────

/**
 * Lit le fichier et rend un diagnostic par recette. N'ÉCRIT RIEN.
 *
 * `existingNames` = les noms déjà présents dans le catalogue du coach, pour
 * signaler les doublons probables. Une liste vide désactive simplement ce
 * signalement, elle ne fausse rien d'autre.
 */
export function analyzeRecipeImport(
  contenu: string,
  existingNames: readonly string[] = [],
): ImportAnalysis {
  let racine: unknown;
  try {
    racine = JSON.parse(contenu);
  } catch (erreur) {
    return {
      ...ANALYSE_VIDE,
      fileError: `Le fichier n'est pas un JSON valide : ${
        erreur instanceof Error ? erreur.message : "format illisible"
      }`,
    };
  }

  // On accepte les deux écritures naturelles : un tableau nu, ou un objet
  // `{ "recipes": [...] }`. Refuser l'une des deux ne protégerait de rien.
  const brut = Array.isArray(racine)
    ? racine
    : Array.isArray((racine as { recipes?: unknown })?.recipes)
      ? ((racine as { recipes: unknown[] }).recipes)
      : null;

  if (brut === null) {
    return {
      ...ANALYSE_VIDE,
      fileError:
        "Le fichier doit contenir un tableau de recettes, ou un objet { \"recipes\": [ … ] }.",
    };
  }
  if (brut.length === 0) {
    return { ...ANALYSE_VIDE, fileError: "Le fichier ne contient aucune recette." };
  }
  if (brut.length > IMPORT_MAX_RECIPES) {
    return {
      ...ANALYSE_VIDE,
      fileError: `${brut.length} recettes : le maximum est de ${IMPORT_MAX_RECIPES} par fichier. Découpe-le en plusieurs lots.`,
    };
  }

  const déjàPris = new Set(existingNames.map(normalizeRecipeName));
  // Un doublon peut aussi être INTERNE au fichier — deux fois le même nom.
  const vusDansLeFichier = new Set<string>();

  const recipes = brut.map((entrée, index) => analyserUne(entrée, index + 1, déjàPris, vusDansLeFichier));

  return {
    fileError: null,
    recipes,
    total: recipes.length,
    valid: recipes.filter((r) => r.valid).length,
    invalid: recipes.filter((r) => !r.valid).length,
    duplicates: recipes.filter((r) => r.duplicate).length,
  };
}

function analyserUne(
  entrée: unknown,
  line: number,
  déjàPris: ReadonlySet<string>,
  vusDansLeFichier: Set<string>,
): AnalyzedRecipe {
  const issues: ImportIssue[] = [];

  if (entrée === null || typeof entrée !== "object" || Array.isArray(entrée)) {
    return {
      line,
      name: "",
      issues: [{ where: "recette", message: "Cette entrée n'est pas un objet." }],
      valid: false,
      duplicate: false,
      ingredientCount: 0,
      payload: null,
    };
  }

  const recette = entrée as ImportRecipeInput;
  const nom = texte(recette.name);
  if (nom === "") {
    issues.push({ where: "recette", message: "Le nom est obligatoire." });
  }

  // ── Créneau ────────────────────────────────────────────────────────────
  const créneauBrut = texte(recette.slot);
  let slotKey: RecipeSlotKey | null = null;
  if (créneauBrut !== "") {
    if ((RECIPE_SLOT_KEYS as readonly string[]).includes(créneauBrut)) {
      slotKey = créneauBrut as RecipeSlotKey;
    } else {
      issues.push({
        where: "recette",
        message: `Créneau inconnu « ${créneauBrut} ». Valeurs admises : ${RECIPE_SLOT_KEYS.join(", ")}, ou rien pour une recette valable à toutes les occasions.`,
      });
    }
  }

  // ── Étiquettes ─────────────────────────────────────────────────────────
  const tags: { kind: RecipeTagKind; value: string }[] = [];
  const tagsBruts = recette.tags;
  if (tagsBruts !== undefined && tagsBruts !== null) {
    if (typeof tagsBruts !== "object" || Array.isArray(tagsBruts)) {
      issues.push({ where: "étiquettes", message: "« tags » doit être un objet { type: [valeurs] }." });
    } else {
      for (const [kind, valeurs] of Object.entries(tagsBruts as Record<string, unknown>)) {
        if (!(RECIPE_TAG_KINDS as readonly string[]).includes(kind)) {
          issues.push({
            where: "étiquettes",
            message: `Type d'étiquette inconnu « ${kind} ». Types admis : ${RECIPE_TAG_KINDS.join(", ")}.`,
          });
          continue;
        }
        const liste = Array.isArray(valeurs) ? valeurs : [valeurs];
        for (const valeur of liste) {
          const v = texte(valeur);
          if (!RECIPE_TAG_VOCABULARY[kind as RecipeTagKind].includes(v)) {
            issues.push({
              where: "étiquettes",
              message: `Valeur « ${v} » inconnue pour « ${kind} ».`,
            });
            continue;
          }
          tags.push({ kind: kind as RecipeTagKind, value: v });
        }
      }
    }
  }

  // ── Ingrédients ────────────────────────────────────────────────────────
  const brutsIngrédients = Array.isArray(recette.ingredients) ? recette.ingredients : [];
  if (!Array.isArray(recette.ingredients)) {
    issues.push({ where: "ingrédients", message: "« ingredients » doit être un tableau." });
  } else if (brutsIngrédients.length === 0) {
    issues.push({ where: "ingrédients", message: "Une recette doit avoir au moins un ingrédient." });
  }

  // Identifiants LOCAUX, stables et lisibles : ils ne partent jamais en base
  // (la RPC désigne les liaisons par position), mais `validateRecipeForm` en a
  // besoin pour rattacher ses messages au bon ingrédient.
  const idPourPosition = (p: number) => `import-${line}-${p}`;

  const ingredients: RecipeFormIngredient[] = brutsIngrédients.map((brut, i) => {
    const position = i + 1;
    const ing = (brut ?? {}) as ImportIngredientInput;
    const rôleBrut = texte(ing.role);
    if (!(RECIPE_INGREDIENT_ROLES as readonly string[]).includes(rôleBrut)) {
      issues.push({
        where: `ingrédient ${position}`,
        message: `Rôle inconnu « ${rôleBrut} ». Rôles admis : ${RECIPE_INGREDIENT_ROLES.join(", ")}.`,
      });
    }
    const lien = entierOuNull(ing.linkedToPosition);
    if (ing.linkedToPosition !== undefined && ing.linkedToPosition !== null) {
      if (lien === null || lien < 1 || lien > brutsIngrédients.length) {
        issues.push({
          where: `ingrédient ${position}`,
          message: `« linkedToPosition » doit désigner un ingrédient de la même recette (1 à ${brutsIngrédients.length}).`,
        });
      } else if (lien === position) {
        issues.push({
          where: `ingrédient ${position}`,
          message: "Un ingrédient ne peut pas être lié à lui-même.",
        });
      }
    }

    const unitName = texte(ing.unitName);
    const maxUnits = nombreTexte(ing.maxUnits);
    const eggGrams = nombreTexte(ing.eggGrams);
    const lienValide = lien !== null && lien >= 1 && lien <= brutsIngrédients.length && lien !== position;

    return {
      id: idPourPosition(position),
      name: texte(ing.name),
      role: ((RECIPE_INGREDIENT_ROLES as readonly string[]).includes(rôleBrut)
        ? rôleBrut
        : "free") as RecipeIngredientRole,
      proteinPer100g: nombreTexte(ing.proteinPer100g),
      carbPer100g: nombreTexte(ing.carbPer100g),
      fatPer100g: nombreTexte(ing.fatPer100g),
      referenceGrams: nombreTexte(ing.referenceGrams),
      minGrams: nombreTexte(ing.minGrams),
      maxGrams: nombreTexte(ing.maxGrams),
      unitScalable: unitName !== "" || maxUnits !== "",
      maxUnits,
      unitName,
      fixedLabel: texte(ing.fixedLabel),
      egg: eggGrams !== "",
      eggGrams,
      linkedToIngredientId: lienValide ? idPourPosition(lien) : null,
      linkRatioBp: lienValide ? nombreTexte(ing.linkRatioBp) : "",
    };
  });

  // ── LA validation, celle du formulaire, pas une autre ───────────────────
  const état: RecipeFormState = {
    ...createBlankRecipeForm(""),
    name: nom,
    description: texte(recette.description),
    slotKey,
    status: "draft",
    ingredients,
    tags,
  };
  for (const problème of validateRecipeForm(état)) {
    const rang = ingredients.findIndex((i) => i.id === problème.ingredientId);
    issues.push({
      where: rang >= 0 ? `ingrédient ${rang + 1}` : "recette",
      message: problème.message,
    });
  }

  const clé = normalizeRecipeName(nom);
  const duplicate = clé !== "" && (déjàPris.has(clé) || vusDansLeFichier.has(clé));
  if (clé !== "") vusDansLeFichier.add(clé);

  const valid = issues.length === 0;

  return {
    line,
    name: nom,
    issues,
    valid,
    duplicate,
    ingredientCount: ingredients.length,
    payload: valid ? chargeUtile(nom, état, ingredients, tags) : null,
  };
}

/** État validé → charge utile de `import_nutrition_recipes`. Fonction pure. */
function chargeUtile(
  nom: string,
  état: RecipeFormState,
  ingredients: readonly RecipeFormIngredient[],
  tags: readonly { kind: RecipeTagKind; value: string }[],
): Record<string, unknown> {
  const positionDe = new Map(ingredients.map((ing, i) => [ing.id, i + 1]));
  const nombre = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  };

  return {
    name: nom,
    description: état.description === "" ? null : état.description,
    slot_key: état.slotKey,
    tags: tags.map((t) => ({ kind: t.kind, value: t.value })),
    ingredients: ingredients.map((ing, i) => ({
      position: i + 1,
      name: ing.name,
      role: ing.role,
      protein_per_100g: nombre(ing.proteinPer100g) ?? 0,
      carb_per_100g: nombre(ing.carbPer100g) ?? 0,
      fat_per_100g: nombre(ing.fatPer100g) ?? 0,
      reference_grams: nombre(ing.referenceGrams) ?? 0,
      min_grams: nombre(ing.minGrams),
      max_grams: nombre(ing.maxGrams),
      unit_scalable: ing.unitScalable,
      max_units: ing.unitScalable ? nombre(ing.maxUnits) : null,
      unit_name: ing.unitScalable && ing.unitName !== "" ? ing.unitName : null,
      fixed_label: ing.fixedLabel === "" ? null : ing.fixedLabel,
      egg: ing.egg,
      egg_grams: ing.egg ? nombre(ing.eggGrams) : null,
      linked_to_position:
        ing.linkedToIngredientId !== null ? (positionDe.get(ing.linkedToIngredientId) ?? null) : null,
      link_ratio_bp: ing.linkedToIngredientId !== null ? nombre(ing.linkRatioBp) : null,
    })),
  };
}

/**
 * Les recettes RETENUES → charge utile du lot.
 *
 * `selected` porte les rangs que le coach a gardés : les doublons décochés en
 * sortent, et rien n'est jamais écrasé — un doublon importé devient une
 * SECONDE recette, que le coach renommera ou supprimera.
 */
export function toImportRpcPayload(
  analyse: ImportAnalysis,
  selected: ReadonlySet<number>,
): { recipes: unknown[] } {
  return {
    recipes: analyse.recipes
      .filter((r) => r.valid && r.payload !== null && selected.has(r.line))
      .map((r) => r.payload as Record<string, unknown>),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Le modèle téléchargeable
// ────────────────────────────────────────────────────────────────────────────

/**
 * Le fichier d'exemple, généré depuis les MÊMES constantes que la validation :
 * la liste des rôles, des créneaux et des étiquettes ne peut donc pas devenir
 * fausse sans qu'un test le voie.
 *
 * Deux recettes seulement, mais elles couvrent tout ce qui se lit mal dans une
 * documentation : un ingrédient à quantité variable, un ingrédient fixe, une
 * unité comptée, et une liaison entre deux ingrédients.
 */
export function buildImportTemplate(): string {
  const modèle = {
    _lisez_moi: [
      "Chaque recette a un nom et au moins un ingrédient. Tout le reste est facultatif.",
      `slot : un créneau parmi ${RECIPE_SLOT_KEYS.join(", ")} — ou rien du tout, et la recette vaut pour toutes les occasions.`,
      `role : ${RECIPE_INGREDIENT_ROLES.join(", ")}. « protein », « carbohydrate » et « fat » voient leur quantité varier pour atteindre la cible ; « fixed » ne bouge pas ; « free » est exclu du calcul.`,
      "Les macros s'écrivent POUR 100 g de produit cru. referenceGrams est la quantité de départ.",
      "linkedToPosition : le RANG d'un autre ingrédient de la même recette (le premier vaut 1). linkRatioBp est la part, en dix-millièmes — 2500 = 25 %.",
      "Les recettes importées arrivent toujours en BROUILLON : rien n'est publié automatiquement.",
    ],
    recipes: [
      {
        name: "Bol poulet riz curry",
        description: "Exemple : quantités variables et sauce liée au poulet.",
        slot: "lunch",
        tags: { diet: ["halal"], allergen: ["milk"] },
        ingredients: [
          {
            name: "Blanc de poulet",
            role: "protein",
            proteinPer100g: 25,
            carbPer100g: 0,
            fatPer100g: 1,
            referenceGrams: 140,
            minGrams: 100,
            maxGrams: 220,
          },
          {
            name: "Riz basmati cru",
            role: "carbohydrate",
            proteinPer100g: 7,
            carbPer100g: 77,
            fatPer100g: 1,
            referenceGrams: 80,
          },
          {
            name: "Crème de coco",
            role: "fat",
            proteinPer100g: 2,
            carbPer100g: 3,
            fatPer100g: 20,
            referenceGrams: 30,
            linkedToPosition: 1,
            linkRatioBp: 2500,
          },
          {
            name: "Épinards",
            role: "free",
            proteinPer100g: 3,
            carbPer100g: 1,
            fatPer100g: 0,
            referenceGrams: 100,
          },
        ],
      },
      {
        name: "Omelette deux œufs et pain",
        description: "Exemple : un ingrédient compté à l'unité, et un ingrédient fixe.",
        slot: "breakfast",
        tags: { diet: ["vegetarian"], allergen: ["egg", "gluten"] },
        ingredients: [
          {
            name: "Œuf entier",
            role: "protein",
            proteinPer100g: 13,
            carbPer100g: 1,
            fatPer100g: 11,
            referenceGrams: 100,
            eggGrams: 50,
            unitName: "œuf",
            maxUnits: 4,
          },
          {
            name: "Pain complet",
            role: "carbohydrate",
            proteinPer100g: 9,
            carbPer100g: 45,
            fatPer100g: 3,
            referenceGrams: 60,
          },
          {
            name: "Beurre",
            role: "fixed",
            proteinPer100g: 1,
            carbPer100g: 1,
            fatPer100g: 82,
            referenceGrams: 10,
            fixedLabel: "1 noisette",
          },
        ],
      },
    ],
  };
  return `${JSON.stringify(modèle, null, 2)}\n`;
}
