/**
 * COURSES C1 — LA PÉRIODE, ET SES CIBLES JOUR PAR JOUR.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUNE MOYENNE, JAMAIS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ Le piège de ce module tient en une ligne : « kcal d'une journée × nombre
 * de jours ». Elle est fausse dès que deux jours n'utilisent pas le même
 * profil — et c'est précisément le cas d'un plan v2, où chaque
 * `nutrition_days.profile_key` peut différer. Ici, chaque date va chercher SON
 * jour-type, donc SON profil, donc SES grammes.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LE PLAN N'A PAS DE DATES — C'EST LE FAIT CENTRAL
 * ────────────────────────────────────────────────────────────────────────────
 * `nutrition_days.day` vaut `monday`…`sunday` : un JOUR-TYPE, pas une date.
 * (`week_start_date` existe en colonne mais n'est lu nulle part dans
 * l'application.) Le pont date → jour-type est donc calculé ici, avec la même
 * convention lundi-première qu'A5.6/A5.7 — sans quoi Courses aurait son propre
 * calendrier, décalé d'un jour tous les dimanches.
 */

import {
  type DailyMacroTargets,
  type MacroGrams,
} from "@/lib/nutrition/macro-targets";
import {
  dailyTargetsForDay,
  type PlanV2Week,
} from "@/lib/nutrition/plan-v2-week";
import { WEEKDAY_KEYS, type WeekdayKey } from "@/lib/nutrition/weekdays";

/** Bornes du §1 : de un à sept jours, jamais zéro ni huit. */
export const JOURS_MIN = 1;
export const JOURS_MAX = 7;

export interface PeriodeCourses {
  /** `yyyy-mm-dd`, date de départ choisie par l'élève. */
  readonly debut: string;
  readonly nbJours: number;
  /** Les dates réellement couvertes, dans l'ordre. */
  readonly dates: readonly string[];
}

/**
 * Découpe une date ISO en trois nombres.
 *
 * ⚠️ JAMAIS `new Date("2026-08-14")`. Cette forme est interprétée en UTC : à
 * l'est de Greenwich, elle rend la veille pendant une partie de la journée, et
 * la période entière glisserait d'un jour. Même règle qu'en A5.7.
 */
function découper(iso: string): { a: number; m: number; j: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const a = Number(m[1]);
  const mo = Number(m[2]);
  const j = Number(m[3]);
  const d = new Date(a, mo - 1, j);
  // Rejette le 31 février : `Date` le décale silencieusement au 3 mars.
  if (d.getFullYear() !== a || d.getMonth() !== mo - 1 || d.getDate() !== j) return null;
  return { a, m: mo, j };
}

function versIso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * La période couverte. `null` si la date est illisible ou la durée hors bornes.
 *
 * Un refus explicite plutôt qu'une période tronquée : générer six jours quand
 * l'élève en a demandé huit produirait une liste silencieusement incomplète.
 */
export function construirePeriode(debut: string, nbJours: number): PeriodeCourses | null {
  const p = découper(debut);
  if (!p) return null;
  if (!Number.isInteger(nbJours) || nbJours < JOURS_MIN || nbJours > JOURS_MAX) return null;

  const dates: string[] = [];
  for (let i = 0; i < nbJours; i += 1) {
    // Construction LOCALE, puis `setDate` : c'est `Date` qui gère les fins de
    // mois et les changements d'année, pas une arithmétique maison.
    const d = new Date(p.a, p.m - 1, p.j);
    d.setDate(d.getDate() + i);
    dates.push(versIso(d));
  }
  return { debut, nbJours, dates };
}

/** Le jour-type d'une date. `null` si la date est illisible. */
export function jourTypeDe(iso: string): WeekdayKey | null {
  const p = découper(iso);
  if (!p) return null;
  // `getDay()` rend 0 le DIMANCHE. La convention du produit est lundi-première,
  // d'où le décalage : dimanche → index 6, et non −1.
  const index = (new Date(p.a, p.m - 1, p.j).getDay() + 6) % 7;
  return WEEKDAY_KEYS[index];
}

export interface JourCourses {
  readonly date: string;
  readonly jour: WeekdayKey;
  /** `null` quand le plan ne prescrit rien ce jour-là. On n'invente pas. */
  readonly cibles: DailyMacroTargets | null;
}

/**
 * Les jours de la période, chacun avec SES cibles.
 *
 * ⚠️ La cible vient de `dailyTargetsForDay`, qui délègue à
 * `computeDailyMacroTargets`. Aucune formule n'est réécrite ici : recalculer
 * `calories × bp / 10 000 / 4` créerait une seconde vérité qui divergerait au
 * premier ajustement du modèle v2.
 */
export function joursDeLaPeriode(
  periode: PeriodeCourses,
  week: PlanV2Week | null,
): readonly JourCourses[] {
  return periode.dates.map((date) => {
    const jour = jourTypeDe(date) ?? WEEKDAY_KEYS[0];
    const journée = week?.days.find((d) => d.day === jour) ?? null;
    return {
      date,
      jour,
      cibles: week && journée ? dailyTargetsForDay(week, journée) : null,
    };
  });
}

/**
 * La somme des grammes de la période — pour l'affichage seulement.
 *
 * Elle est calculée en ADDITIONNANT les jours, jamais en multipliant l'un
 * d'eux. Les jours sans prescription sont ignorés, pas comptés pour zéro.
 */
export function totauxDeLaPeriode(jours: readonly JourCourses[]): MacroGrams {
  return jours.reduce<MacroGrams>(
    (acc, j) =>
      j.cibles
        ? {
            proteinGrams: acc.proteinGrams + j.cibles.grams.proteinGrams,
            carbGrams: acc.carbGrams + j.cibles.grams.carbGrams,
            fatGrams: acc.fatGrams + j.cibles.grams.fatGrams,
          }
        : acc,
    { proteinGrams: 0, carbGrams: 0, fatGrams: 0 },
  );
}

/** « du 14 au 16 août », ou « le 14 août » sur une journée. */
export function libellePeriode(periode: PeriodeCourses): string {
  const première = découper(periode.dates[0] ?? "");
  const dernière = découper(periode.dates[periode.dates.length - 1] ?? "");
  if (!première || !dernière) return "";
  const MOIS = [
    "janvier", "février", "mars", "avril", "mai", "juin",
    "juillet", "août", "septembre", "octobre", "novembre", "décembre",
  ];
  const nom = (x: { m: number }) => MOIS[x.m - 1];
  if (periode.dates.length === 1) return `le ${première.j} ${nom(première)}`;
  if (première.a !== dernière.a) {
    return `du ${première.j} ${nom(première)} ${première.a} au ${dernière.j} ${nom(dernière)} ${dernière.a}`;
  }
  if (première.m !== dernière.m) {
    return `du ${première.j} ${nom(première)} au ${dernière.j} ${nom(dernière)}`;
  }
  return `du ${première.j} au ${dernière.j} ${nom(dernière)}`;
}
