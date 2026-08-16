import { NBSP } from "@/lib/nutrition/basis-points";
import type { ColorKey } from "@/lib/ui/color-keys";

/**
 * COURSES C1 — L'AGRÉGATION. ELLE ADDITIONNE, ELLE NE CALCULE PAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE MODULE NE CONNAÎT NI SOLVEUR, NI MACRO, NI PORTION PRÉFÉRÉE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUN APPEL À `solveMealChoices`, ET CE N'EST PAS UN OUBLI. Les quantités
 * ont DÉJÀ été résolues, affichées à l'élève, puis validées par lui : elles
 * sont dans `planned_meal_items.quantity`. Les recalculer ici produirait un
 * second résultat pour la même question, et le jour où les deux divergeraient
 * — un arrondi, une option retirée du snapshot — l'élève achèterait autre
 * chose que ce qu'il a validé. Il n'y a donc qu'UN solveur dans le projet, et
 * il ne tourne pas dans les courses.
 *
 * ⚠️ `preferred_quantity` N'EST PAS UNE QUANTITÉ DE COURSES. C'est une
 * suggestion de portion écrite par le coach dans le snapshot, avant que
 * l'élève ait choisi quoi que ce soit ; la quantité réelle dépend des N autres
 * aliments du repas. Ce module ne la lit jamais — il ne voit même pas le
 * snapshot.
 *
 * ⚠️ ON N'ADDITIONNE PAS LES OPTIONS D'UNE LISTE. Une occurrence propose cinq
 * aliments pour qu'on en choisisse UN. Les sommer achèterait les cinq.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA CLÉ D'AGRÉGATION, ET POURQUOI ELLE EST CE QU'ELLE EST
 * ────────────────────────────────────────────────────────────────────────────
 *      identity_type + identity_id + unit
 *
 * ⚠️ JAMAIS PAR NOM. « Poulet » du catalogue et « Poulet » d'une marque sont
 * deux produits différents avec deux compositions différentes ; deux entrées
 * Ciqual peuvent porter le même libellé. Le nom est un rendu, pas une
 * identité — il n'entre à aucun moment dans la clé.
 *
 * ⚠️ JAMAIS DE CONVERSION D'UNITÉ. 100 g de miel et 100 ml de miel ne sont pas
 * la même chose, et la densité qui les relierait n'est stockée nulle part.
 * Deux unités différentes donnent deux lignes, affichées côte à côte : c'est
 * moins joli qu'un total unique, et c'est vrai.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/* ══════════════════════════════════════════════════════════════════════════
   L'IDENTITÉ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ DEUX TYPES, JAMAIS UN TROISIÈME. `planned_meal_items` porte exactement
 * une cible par ligne (contrainte `planned_meal_items_cible_unique`) : un
 * aliment du catalogue OU un produit commercial. Les aliments saisis à la
 * main n'ont pas d'identité stable et ne peuvent pas entrer dans un repas
 * planifié — ils n'arrivent donc jamais ici.
 */
export type IdentityType = "catalog_food" | "product";

/** Une source d'une ligne agrégée : d'où vient cette quantité. */
export interface SourceDeLigne {
  readonly plannedOn: string;
  readonly mealId: string;
  readonly plannedMealId: string;
  readonly choiceSlotId: string;
  readonly quantity: number;
  readonly unit: string;
}

/** Une ligne PLANIFIÉE, telle que lue en base puis hydratée. */
export interface ItemPourAgregation {
  readonly identityType: IdentityType;
  readonly identityId: string;
  readonly quantity: number;
  readonly unit: string;
  /** Hydraté depuis `food_catalog.name` / `food_products`. AFFICHAGE SEUL. */
  readonly displayName: string;
  /** `meal_choice_slots.color_key` de l'occurrence d'origine, ou `null`. */
  readonly colorKey: ColorKey | null;
  readonly plannedOn: string;
  readonly mealId: string;
  readonly plannedMealId: string;
  readonly choiceSlotId: string;
}

export interface LigneDeCourses {
  /** `catalog_food:UUID|g`, `product:UUID|ml`. */
  readonly cle: string;
  readonly identityType: IdentityType;
  readonly identityId: string;
  readonly unit: string;
  /** Somme des quantités des sources. Aucune autre arithmétique. */
  readonly quantite: number;
  readonly displayName: string;
  /**
   * Accent visuel UNIQUEMENT si TOUTES les sources partagent la même couleur.
   * `null` dès qu'elles divergent — ou dès qu'une seule est nulle.
   */
  readonly colorKey: ColorKey | null;
  /** ⚠️ EN MÉMOIRE, JAMAIS PERSISTÉE : elle vient déjà du planifié. */
  readonly sources: readonly SourceDeLigne[];
}

/**
 * La clé d'agrégation. Exportée parce qu'elle doit pouvoir être vérifiée de
 * l'extérieur : une règle qu'on ne peut pas tester se contourne.
 */
export function cleDeLigne(identityType: IdentityType, identityId: string, unit: string): string {
  return `${identityType}:${identityId}|${unit}`;
}

/* ══════════════════════════════════════════════════════════════════════════
   L'AGRÉGATION
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * La couleur d'une ligne : celle de ses sources, si elles sont TOUTES
 * d'accord.
 *
 * ⚠️ LA COULEUR N'AGRÈGE RIEN et ne classe rien. Elle ne dit ni un rôle
 * nutritionnel, ni une catégorie, ni un rayon de magasin — c'est un repère
 * visuel posé par le coach sur une liste d'aliments, et rien d'autre. Deux
 * sources de couleurs différentes ne se moyennent pas : l'accent disparaît,
 * parce qu'un accent faux est pire que pas d'accent.
 */
function couleurUnanime(sources: readonly (ColorKey | null)[]): ColorKey | null {
  if (sources.length === 0) return null;
  const première = sources[0];
  if (première === null) return null;
  return sources.every((c) => c === première) ? première : null;
}

/**
 * Agrège des lignes planifiées en une liste de courses.
 *
 * L'ordre de sortie est ALPHABÉTIQUE sur le nom affiché, départagé par la clé.
 * ⚠️ C'est un ordre d'AFFICHAGE, pas une agrégation : deux lignes de même nom
 * et d'identités différentes restent DEUX lignes, simplement voisines.
 *
 * Les quantités nulles ou négatives sont écartées : `planned_meal_items` les
 * interdit déjà (`quantity > 0`), et une ligne à 0 g dans une liste de courses
 * ne veut rien dire.
 */
export function agregerListeDeCourses(
  items: readonly ItemPourAgregation[],
): readonly LigneDeCourses[] {
  const parCle = new Map<
    string,
    {
      identityType: IdentityType;
      identityId: string;
      unit: string;
      quantite: number;
      displayName: string;
      couleurs: (ColorKey | null)[];
      sources: SourceDeLigne[];
    }
  >();

  for (const item of items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) continue;
    const cle = cleDeLigne(item.identityType, item.identityId, item.unit);
    const existante = parCle.get(cle);
    const source: SourceDeLigne = {
      plannedOn: item.plannedOn,
      mealId: item.mealId,
      plannedMealId: item.plannedMealId,
      choiceSlotId: item.choiceSlotId,
      quantity: item.quantity,
      unit: item.unit,
    };
    if (existante) {
      existante.quantite += item.quantity;
      existante.couleurs.push(item.colorKey);
      existante.sources.push(source);
      // Le nom ne change pas de ligne en ligne pour une même identité ; s'il
      // manquait sur la première occurrence, une suivante peut le compléter.
      if (existante.displayName === "" && item.displayName !== "") {
        existante.displayName = item.displayName;
      }
      continue;
    }
    parCle.set(cle, {
      identityType: item.identityType,
      identityId: item.identityId,
      unit: item.unit,
      quantite: item.quantity,
      displayName: item.displayName,
      couleurs: [item.colorKey],
      sources: [source],
    });
  }

  return [...parCle.entries()]
    .map(([cle, v]): LigneDeCourses => ({
      cle,
      identityType: v.identityType,
      identityId: v.identityId,
      unit: v.unit,
      quantite: v.quantite,
      displayName: v.displayName,
      colorKey: couleurUnanime(v.couleurs),
      sources: v.sources,
    }))
    .sort((a, b) => {
      const parNom = a.displayName.localeCompare(b.displayName, "fr");
      return parNom !== 0 ? parNom : a.cle.localeCompare(b.cle);
    });
}

/**
 * « 330 g », « 1 500 ml », « 2 pièces ».
 *
 * Les quantités arrivent entières (l'élève a validé l'entier affiché) ; on
 * arrondit tout de même, parce qu'une somme de décimaux hérités d'anciennes
 * lignes ne doit pas afficher « 329.99999 ». L'espace fine insécable évite
 * qu'un nombre à quatre chiffres se coupe de son unité en fin de ligne.
 */
export function formatQuantite(quantite: number, unit: string): string {
  const valeur = Math.round(quantite);
  const nombre = valeur.toLocaleString("fr-FR");
  const libelle = unit === "piece" ? (valeur > 1 ? "pièces" : "pièce") : unit;
  // ⚠️ ESPACE INSÉCABLE EXPLICITE, la constante du projet. « 1 500 » et « g »
  // ne doivent pas se retrouver sur deux lignes : un nombre coupé de son unité
  // se lit comme une autre quantité.
  return `${nombre}${NBSP}${libelle}`;
}
