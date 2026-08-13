/**
 * LA CONSOMMATION RÉELLE — types et totaux (ALIMENTS A2).
 *
 * Module FEUILLE : aucune dépendance à React ni à Supabase, pour rester
 * testable et pour qu'aucun cycle d'import ne puisse naître (leçon de
 * `lib/rpe.ts`).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * Il ne calcule JAMAIS l'instantané d'une entrée. Les grammes de protéines,
 * de glucides et de lipides d'un aliment consommé sont écrits par le serveur,
 * dans les RPC `security definer` de la migration 20260901090000 — le
 * navigateur n'a même plus le privilège d'écrire dans `meal_entries`.
 *
 * Ce qu'il fait, c'est ADDITIONNER ce que le serveur a déjà figé, et dériver
 * les calories avec le MÊME 4/4/9 que tout le reste du produit
 * (`KCAL_PER_GRAM`, importé — jamais réécrit ici).
 */

import { KCAL_PER_GRAM } from "@/lib/nutrition/macro-targets";
import type { MealSlotKey } from "@/lib/nutrition/meal-distribution";

/** Les unités de saisie autorisées par `meal_entries_unit_check` (A1). */
export const CONSUMED_UNITS = ["g", "ml", "piece", "portion"] as const;
export type ConsumedUnit = (typeof CONSUMED_UNITS)[number];

/** Les unités qu'un aliment SAISI À LA MAIN accepte : voir `ajouter_aliment_manuel`. */
export const MANUAL_UNITS = ["g", "ml"] as const;
export type ManualUnit = (typeof MANUAL_UNITS)[number];

export const CONSUMED_UNIT_LABELS_FR: Readonly<Record<ConsumedUnit, string>> = {
  g: "g",
  ml: "ml",
  piece: "pièce",
  portion: "portion",
};

/** L'origine d'une entrée — vocabulaire de `meal_entries_source_type_check` (A1). */
export type ConsumedSourceType = "recipe" | "catalog_food" | "product" | "free";

/**
 * Un aliment consommé. Les trois macros sont l'INSTANTANÉ figé par le
 * serveur : elles ne suivent pas leur source si le catalogue change ensuite.
 */
export interface ConsumedEntry {
  readonly id: string;
  readonly consumedMealId: string;
  readonly sourceType: ConsumedSourceType;
  readonly foodId: string | null;
  readonly label: string;
  readonly quantity: number;
  readonly unit: ConsumedUnit;
  readonly proteinG: number;
  readonly carbG: number;
  readonly fatG: number;
  readonly note: string;
  /** ISO 8601. Sert l'heure affichée sur la barre compacte. */
  readonly createdAt: string;
}

/** La cible du coach, FIGÉE à l'ouverture du repas. `null` pour un repas libre. */
export interface ConsumedTarget {
  readonly kcal: number | null;
  readonly proteinG: number | null;
  readonly carbG: number | null;
  readonly fatG: number | null;
}

/**
 * Un repas réellement mangé : ouvert depuis la prescription (`prescribed`) ou
 * créé par l'élève (`student`).
 */
export interface ConsumedMeal {
  readonly id: string;
  /** `yyyy-mm-dd`. */
  readonly consumedOn: string;
  readonly kind: "prescribed" | "student";
  readonly prescribedMealId: string | null;
  readonly slotKey: MealSlotKey | null;
  readonly label: string;
  readonly position: number;
  readonly target: ConsumedTarget | null;
  readonly entries: readonly ConsumedEntry[];
}

export interface MacroTotals {
  readonly proteinG: number;
  readonly carbG: number;
  readonly fatG: number;
  readonly kcal: number;
}

export const TOTAUX_VIDES: MacroTotals = { proteinG: 0, carbG: 0, fatG: 0, kcal: 0 };

/**
 * Calories dérivées de grammes — le 4/4/9 du produit, jamais une colonne
 * stockée. Miroir exact de `consommation_du_jour` en base : les deux doivent
 * rendre la même valeur, et un test le vérifie.
 */
export function kcalFromMacros(proteinG: number, carbG: number, fatG: number): number {
  return (
    proteinG * KCAL_PER_GRAM.protein + carbG * KCAL_PER_GRAM.carb + fatG * KCAL_PER_GRAM.fat
  );
}

/** Les kcal d'une entrée, dérivées de son instantané. */
export function entryKcal(entrée: Pick<ConsumedEntry, "proteinG" | "carbG" | "fatG">): number {
  return kcalFromMacros(entrée.proteinG, entrée.carbG, entrée.fatG);
}

/** La somme d'une liste d'entrées. */
export function totalsForEntries(entrées: readonly ConsumedEntry[]): MacroTotals {
  const somme = entrées.reduce(
    (acc, e) => ({
      proteinG: acc.proteinG + e.proteinG,
      carbG: acc.carbG + e.carbG,
      fatG: acc.fatG + e.fatG,
    }),
    { proteinG: 0, carbG: 0, fatG: 0 },
  );
  return { ...somme, kcal: kcalFromMacros(somme.proteinG, somme.carbG, somme.fatG) };
}

/** Le total consommé d'UN repas. */
export function totalsForMeal(repas: Pick<ConsumedMeal, "entries">): MacroTotals {
  return totalsForEntries(repas.entries);
}

/**
 * Le total consommé d'une JOURNÉE : repas prescrits ET repas libres
 * confondus. C'est le §7 de l'énoncé — un aliment posé dans une collation
 * compte exactement comme un aliment posé dans le déjeuner.
 */
export function totalsForDay(repas: readonly ConsumedMeal[]): MacroTotals {
  return totalsForEntries(repas.flatMap((r) => r.entries));
}

/**
 * Ce qu'il RESTE : objectif moins consommé.
 *
 * La valeur peut être NÉGATIVE, et on la rend telle quelle. Tronquer à zéro
 * masquerait précisément l'information la plus utile — le dépassement.
 * `null` quand il n'y a pas d'objectif : un repas libre n'a pas de cible, et
 * « pas de cible » n'est pas « cible à zéro ».
 */
export function remainingForTarget(
  cible: ConsumedTarget | null,
  consommé: MacroTotals,
): MacroTotals | null {
  if (!cible) return null;
  if (
    cible.kcal === null &&
    cible.proteinG === null &&
    cible.carbG === null &&
    cible.fatG === null
  ) {
    return null;
  }
  return {
    proteinG: (cible.proteinG ?? 0) - consommé.proteinG,
    carbG: (cible.carbG ?? 0) - consommé.carbG,
    fatG: (cible.fatG ?? 0) - consommé.fatG,
    kcal: (cible.kcal ?? 0) - consommé.kcal,
  };
}

/**
 * L'heure d'une entrée, `HH:MM`, en heure locale.
 *
 * Rend une chaîne vide plutôt qu'« Invalid Date » si l'horodatage est
 * illisible : une barre sans heure reste lisible, une barre qui affiche
 * « Invalid Date » ne l'est pas.
 */
export function formatHeureFr(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * L'ordre d'affichage des repas d'une journée : la `position` calculée par le
 * serveur, puis le libellé pour départager. Deux collations du même nom sont
 * deux lignes distinctes — c'est tout l'objet du conteneur — donc
 * l'identifiant tranche en dernier ressort, sinon l'ordre changerait d'un
 * chargement à l'autre.
 */
export function orderedConsumedMeals(repas: readonly ConsumedMeal[]): readonly ConsumedMeal[] {
  return [...repas].sort(
    (a, b) =>
      a.position - b.position ||
      a.label.localeCompare(b.label, "fr") ||
      a.id.localeCompare(b.id),
  );
}

/** Les repas LIBRES d'une journée, dans l'ordre. */
export function studentMealsForDate(
  repas: readonly ConsumedMeal[],
  date: string,
): readonly ConsumedMeal[] {
  return orderedConsumedMeals(repas.filter((r) => r.kind === "student" && r.consumedOn === date));
}

/**
 * Le conteneur déjà ouvert pour un repas prescrit à une date — `null` s'il
 * n'existe pas encore.
 *
 * C'est le §6 de l'énoncé : afficher la page ne crée AUCUN conteneur. Tant
 * que cette fonction rend `null`, l'écran montre un repas prescrit sans
 * consommation, et rien n'a été écrit en base.
 */
export function prescribedConsumedMeal(
  repas: readonly ConsumedMeal[],
  prescribedMealId: string,
  date: string,
): ConsumedMeal | null {
  return (
    repas.find(
      (r) =>
        r.kind === "prescribed" && r.prescribedMealId === prescribedMealId && r.consumedOn === date,
    ) ?? null
  );
}

/**
 * LIRE UN NOMBRE TAPÉ PAR UN ÉLÈVE (A2.1).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI UN RÉSULTAT TYPÉ PLUTÔT QU'UN `number | null`
 * ────────────────────────────────────────────────────────────────────────────
 * Un champ vide et un champ illisible ne veulent pas dire la même chose. Sur
 * une macro, « vide » vaut légitimement zéro — une eau pétillante, c'est
 * 0 / 0 / 0. Sur une quantité, « vide » est une saisie incomplète. Et
 * « abc » n'est jamais zéro, nulle part.
 *
 * `Number("")` rend 0 et `Number(" ")` aussi : s'appuyer dessus ferait passer
 * un champ oublié pour un zéro délibéré. On distingue donc les trois cas, et
 * l'appelant décide.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * VIRGULE ET POINT
 * ────────────────────────────────────────────────────────────────────────────
 * Les deux sont acceptés — « 1,5 » comme « 1.5 » — parce que le clavier
 * décimal d'iOS produit une virgule en français et un point sur un clavier
 * physique. C'est déjà le contrat de `lireRpe` (lib/rpe.ts) : A2.1 ne crée pas
 * une seconde convention de saisie.
 *
 * En revanche « 1,5.2 » est REFUSÉ, et non pas silencieusement tronqué : deux
 * séparateurs dans un même nombre sont une faute de frappe, pas une intention.
 */
export type LectureNombre =
  | { readonly ok: true; readonly valeur: number }
  | { readonly ok: false; readonly raison: "vide" | "illisible" | "negatif" };

export function lireNombreFr(saisie: string): LectureNombre {
  const propre = saisie.trim();
  if (propre === "") return { ok: false, raison: "vide" };

  // Un seul séparateur décimal, virgule OU point.
  const séparateurs = (propre.match(/[.,]/g) ?? []).length;
  if (séparateurs > 1) return { ok: false, raison: "illisible" };
  if (!/^[+-]?\d*[.,]?\d*$/.test(propre)) return { ok: false, raison: "illisible" };

  const valeur = Number(propre.replace(",", "."));
  if (!Number.isFinite(valeur)) return { ok: false, raison: "illisible" };
  if (valeur < 0) return { ok: false, raison: "negatif" };
  return { ok: true, valeur };
}

/**
 * Une MACRO pour 100 : un champ vide vaut zéro, tout le reste doit être un
 * nombre positif. `null` quand la saisie est inexploitable.
 */
export function lireMacroPour100(saisie: string): number | null {
  const lu = lireNombreFr(saisie);
  if (lu.ok) return lu.valeur;
  return lu.raison === "vide" ? 0 : null;
}

/**
 * Une QUANTITÉ consommée : strictement positive, jamais vide. `null` sinon —
 * et c'est cette valeur qui désactive le bouton d'ajout.
 */
export function lireQuantite(saisie: string): number | null {
  const lu = lireNombreFr(saisie);
  if (!lu.ok) return null;
  return lu.valeur > 0 ? lu.valeur : null;
}
