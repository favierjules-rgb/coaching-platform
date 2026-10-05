import { TOTAUX_VIDES, totalsForDay, type ConsumedMeal, type MacroTotals } from "@/lib/nutrition/consumed";
import type { DailyNutritionLog } from "@/lib/nutrition-weekly";
import type { NutritionDayStatus } from "@/types";

/**
 * LE STATUT D'UNE JOURNÉE ALIMENTAIRE — DÉRIVÉ, JAMAIS STOCKÉ (P6).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE DÉFAUT CORRIGÉ
 * ────────────────────────────────────────────────────────────────────────────
 * Jusqu'ici, « cette journée est validée » vivait dans
 * `localStorage["seth-nutrition-tracking:<planId>"]` (hooks/useNutritionTracking.ts).
 * Audit du 05/10/2026 : les trois écrans qui lisaient cette clé —
 * `NutritionPlanWorkspace`, `NutritionWeekStatusClient`, `NutritionPlanCardLive`
 * — ne sont montés que dans la branche de DÉMONSTRATION des pages
 * `/nutrition` et `/nutrition/[planId]`, c'est-à-dire quand Supabase n'est
 * pas configuré. Pour un élève réel, il n'y avait donc aucun statut de
 * journée : ni en base, ni dans le navigateur.
 *
 * ⚠️ ON NE CRÉE PAS UNE SECONDE SOURCE. Le statut n'est écrit NULLE PART : il
 * est DÉRIVÉ de ce que l'élève a réellement déclaré avoir mangé
 * (`consumed_meals` + `meal_entries`). C'est la seule donnée nutritionnelle
 * qui soit à la fois persistée côté serveur, protégée par la RLS, et visible
 * du coach. Un statut stocké à côté finirait par contredire les repas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LA RÈGLE, ET POURQUOI ELLE REPRODUIT L'ANCIENNE
 * ────────────────────────────────────────────────────────────────────────────
 *   · `non-commence` — aucun repas de cette date ne porte d'aliment ;
 *   · `en-cours`     — au moins un aliment déclaré ;
 *   · `valide`       — tous les repas PRESCRITS du jour portent un aliment.
 *
 * ⚠️ `non-commence` ⇔ l'ancien `nutrition_daily_logs.calories === null`. C'est
 * exactement le test utilisé par `computeWeeklyNutritionAdjustment`
 * (lib/nutrition-weekly.ts) et par `getStudentNutritionAnalytics`
 * (lib/supabase/progress.ts) pour compter les « jours remplis ». La dérivation
 * rend donc le même `daysFilled` que la table morte, sans la table.
 *
 * ⚠️ UNE JOURNÉE VIDE NE DEVIENT JAMAIS « REMPLIE ». Un conteneur de repas
 * OUVERT mais SANS aliment ne compte pas : ouvrir un repas prescrit n'est pas
 * manger. C'est la même doctrine que `prescribedConsumedMeal` — afficher la
 * page ne crée rien, et un conteneur vide ne prouve rien.
 *
 * ⚠️ `valide` EST INATTEIGNABLE SANS LA PRESCRIPTION, ET C'EST VOULU. Le
 * nombre de repas prescrits d'une date ne vit pas dans `consumed_meals` : il
 * vient de la semaine du plan. Quand l'appelant ne le fournit pas, le statut
 * se borne à `non-commence` / `en-cours` plutôt que de supposer une
 * complétude. Les écrans qui ne comptent que les jours remplis n'en ont pas
 * besoin ; ceux qui veulent « validé » doivent dire ce qui était attendu.
 *
 * Module FEUILLE : ni React, ni Supabase, ni réseau. Fonctions PURES.
 */

/** Une journée du journal alimentaire, telle qu'elle se dérive. */
export interface JourneeNutrition {
  /** `yyyy-mm-dd`. */
  readonly date: string;
  readonly statut: NutritionDayStatus;
  /** Somme des instantanés du jour — `totalsForDay`, jamais recalculé ici. */
  readonly totaux: MacroTotals;
  /** Repas (prescrits ou libres) portant au moins un aliment. */
  readonly repasAvecAliments: number;
  /** Repas PRESCRITS distincts portant au moins un aliment. */
  readonly repasPrescritsConsommes: number;
  /** Ce que le plan prescrivait ce jour-là. `null` quand l'appelant l'ignore. */
  readonly repasPrescritsDuJour: number | null;
}

/** Un repas porte-t-il au moins un aliment ? */
function porteUnAliment(repas: ConsumedMeal): boolean {
  return repas.entries.length > 0;
}

/**
 * Les repas PRESCRITS distincts réellement consommés.
 *
 * ⚠️ PAR `prescribedMealId`, PAS PAR LIGNE. Deux conteneurs ouverts sur le même
 * repas prescrit — ce que la base n'interdit pas — compteraient deux fois, et
 * une journée de deux repas prescrits passerait « validée » avec un seul
 * réellement mangé.
 */
function prescritsConsommes(repasDuJour: readonly ConsumedMeal[]): number {
  const vus = new Set<string>();
  for (const repas of repasDuJour) {
    if (repas.kind !== "prescribed") continue;
    if (!porteUnAliment(repas)) continue;
    if (repas.prescribedMealId === null) continue;
    vus.add(repas.prescribedMealId);
  }
  return vus.size;
}

export function statutDeLaJournee(entree: {
  readonly repasDuJour: readonly ConsumedMeal[];
  readonly repasPrescritsDuJour?: number | null;
}): NutritionDayStatus {
  const avecAliments = entree.repasDuJour.filter(porteUnAliment).length;
  if (avecAliments === 0) {
    return "non-commence";
  }
  const attendus = entree.repasPrescritsDuJour ?? null;
  if (attendus !== null && attendus > 0 && prescritsConsommes(entree.repasDuJour) >= attendus) {
    return "valide";
  }
  return "en-cours";
}

/**
 * Les journées d'une plage de dates, dans l'ordre des dates DEMANDÉES.
 *
 * ⚠️ L'ORDRE VIENT DE `dates`, PAS DES REPAS. L'appelant passe sept dates
 * lundi → dimanche ; les trier à partir des repas ferait disparaître les jours
 * sans repas, et c'est précisément eux qu'il faut rendre à `non-commence`.
 */
export function journeesDuJournal(
  repas: readonly ConsumedMeal[],
  dates: readonly string[],
  repasPrescritsParDate?: Readonly<Record<string, number>> | null,
): readonly JourneeNutrition[] {
  return dates.map((date) => {
    const duJour = repas.filter((r) => r.consumedOn === date);
    const attendus = repasPrescritsParDate ? (repasPrescritsParDate[date] ?? null) : null;
    return {
      date,
      statut: statutDeLaJournee({ repasDuJour: duJour, repasPrescritsDuJour: attendus }),
      totaux: duJour.length === 0 ? TOTAUX_VIDES : totalsForDay(duJour),
      repasAvecAliments: duJour.filter(porteUnAliment).length,
      repasPrescritsConsommes: prescritsConsommes(duJour),
      repasPrescritsDuJour: attendus,
    };
  });
}

/** Une journée compte-t-elle comme « remplie » ? */
export function journeeRemplie(journee: JourneeNutrition): boolean {
  return journee.statut !== "non-commence";
}

/**
 * Projection vers la forme historique `DailyNutritionLog`.
 *
 * POURQUOI CETTE PROJECTION PLUTÔT QU'UN NOUVEAU TYPE. `CaloriesWeekChart`,
 * `computeWeeklyNutritionAdjustment` et `StudentNutritionAnalytics` consomment
 * déjà `DailyNutritionLog`. Leur faire parler un second vocabulaire aurait
 * demandé de réécrire trois calculs justes pour changer leur source.
 *
 * ⚠️ UNE JOURNÉE `non-commence` N'EST PAS ÉMISE. Elle ne doit pas apparaître
 * avec `calories: 0`, que les consommateurs liraient comme « 0 kcal mangées »
 * au lieu de « rien déclaré » — et qui ferait monter `daysFilled`.
 *
 * ⚠️ `note` EST TOUJOURS VIDE, et ce n'est pas un oubli : la note de
 * `nutrition_daily_logs` était un commentaire libre de l'élève sur sa journée.
 * Rien dans `consumed_meals` n'en tient lieu, et fabriquer un texte serait
 * inventer.
 */
export function logsDepuisJournal(journees: readonly JourneeNutrition[]): DailyNutritionLog[] {
  return journees.filter(journeeRemplie).map((journee) => ({
    logDate: journee.date,
    calories: Math.round(journee.totaux.kcal),
    proteinG: Math.round(journee.totaux.proteinG),
    carbsG: Math.round(journee.totaux.carbG),
    fatG: Math.round(journee.totaux.fatG),
    note: "",
  }));
}

/**
 * LE JOURNAL D'ABORD, L'HISTORIQUE ENSUITE — fusion à sens unique (P7).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * POURQUOI NE PAS SIMPLEMENT ABANDONNER `nutrition_daily_logs`
 * ────────────────────────────────────────────────────────────────────────────
 * Mesuré en production le 05/10/2026 : 9 lignes, 4 élèves, dernière écriture le
 * 22/08/2026 — la table n'est plus alimentée (son seul chemin d'écriture,
 * `upsertNutritionDailyLog` via `saveDay`, n'a aucun appelant). Mais ces
 * 9 lignes ont été saisies par de vrais élèves : les jeter ferait disparaître
 * de l'historique.
 *
 * La règle est donc : pour une date donnée, le journal (`consumed_meals`)
 * PRIME ; l'ancienne ligne ne sert que là où le journal n'a RIEN. Une ligne
 * historique ne peut donc jamais contredire un repas déclaré, et ne peut pas
 * non plus « remplir » une journée artificiellement — elle n'existe que parce
 * que l'élève l'avait remplie.
 *
 * ⚠️ L'ORDRE DE SORTIE SUIT `dates`, et une date sans aucune des deux sources
 * n'est pas émise : c'est ce qui la laisse `non-commence` en aval.
 */
export function fusionnerJournalEtHistorique(
  dates: readonly string[],
  journal: readonly DailyNutritionLog[],
  historique: readonly DailyNutritionLog[],
): DailyNutritionLog[] {
  const parDateJournal = new Map(journal.map((log) => [log.logDate, log]));
  const parDateHistorique = new Map(historique.map((log) => [log.logDate, log]));
  const fusion: DailyNutritionLog[] = [];
  for (const date of dates) {
    const retenu = parDateJournal.get(date) ?? parDateHistorique.get(date);
    if (retenu) fusion.push(retenu);
  }
  return fusion;
}

/**
 * La plus récente de deux dates `yyyy-mm-dd`, `null` si les deux sont absentes.
 *
 * ⚠️ COMPARAISON DE CHAÎNES, PAS DE `Date`. Même raison que `indexDuJour`
 * (lib/nutrition/progression.ts) : construire un `Date` ferait entrer le fuseau
 * horaire dans une question qui n'en a pas.
 */
export function dateLaPlusRecente(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}
