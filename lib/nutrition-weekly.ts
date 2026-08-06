/**
 * Calcul pur de l'ajustement hebdomadaire nutrition — voir composant
 * WeeklyNutritionTracker et lib/supabase/nutrition-logs.ts pour l'I/O
 * Supabase. Aucune dépendance à React/Supabase ici, pour rester testable et
 * réutilisable côté admin (résumé dans /admin/eleves/[studentId]).
 *
 * Règle : weeklyTarget - consommé sur les jours déjà remplis = calories
 * restantes, réparties sur les jours non remplis. Les jours déjà remplis
 * gardent l'objectif normal (jamais modifiés a posteriori) ; seuls les
 * jours non remplis reçoivent l'objectif ajusté.
 */

export const WEEKDAY_LABELS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"] as const;

export interface DailyNutritionLog {
  logDate: string;
  calories: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  note: string;
}

/** Les quatre objectifs d'UNE journée prescrite. */
export interface NutritionDayValues {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface NutritionDailyTarget {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Objectif hebdomadaire calories du plan, si renseigné (sinon calories × 7). */
  weeklyTargetCalories: number;
  /**
   * Les SEPT objectifs PRESCRITS, lundi → dimanche.
   *
   * POURQUOI. Depuis que le coach construit une semaine où chaque jour porte
   * ses propres calories, « l'objectif du jour » n'est plus un nombre unique.
   * Sans cette liste, tous les jours affichaient la même moyenne — un plan à
   * 3 000 kcal du lundi au dimanche sauf 2 000 le mardi montrait 2 857 kcal
   * SEPT FOIS, ce qui ne correspondait à aucune journée réellement prescrite.
   *
   * Absente ou de longueur ≠ 7 : on retombe sur l'ancien comportement, un
   * objectif quotidien unique. Les plans mock et les plans sans semaine
   * continuent donc de fonctionner à l'identique.
   */
  perDay?: readonly (NutritionDayValues | null)[];
}

export interface WeekDayAdjustment {
  date: string;
  label: string;
  isToday: boolean;
  filled: boolean;
  log: DailyNutritionLog | null;
  /** null quand l'objectif hebdomadaire est déjà dépassé (jour non rempli). */
  targetCalories: number | null;
  targetProtein: number | null;
  targetCarbs: number | null;
  targetFat: number | null;
  varianceCalories: number | null;
}

interface MacroAdjustment {
  weeklyTarget: number;
  consumed: number;
  remaining: number;
  /** null quand remaining < 0 (objectif déjà dépassé) ou 0 jour restant. */
  adjustedDaily: number | null;
}

export interface WeeklyNutritionAdjustment {
  weekDates: string[];
  days: WeekDayAdjustment[];
  daysFilled: number;
  daysRemaining: number;
  overBudget: boolean;
  lowCalorieWarning: boolean;
  calories: MacroAdjustment;
  protein: MacroAdjustment;
  carbs: MacroAdjustment;
  fat: MacroAdjustment;
}

/** Seuil en-deçà duquel un objectif ajusté trop bas déclenche une alerte (sans jamais bloquer la saisie). */
const LOW_CALORIE_FLOOR = 1200;

function toDateString(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Lundi de la semaine courante (locale) au format yyyy-mm-dd, puis les 6 jours suivants. */
export function getCurrentWeekDates(referenceDate: Date = new Date()): string[] {
  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const weekday = date.getDay(); // 0 = dimanche ... 6 = samedi
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  date.setDate(date.getDate() + diffToMonday);

  const dates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(date);
    d.setDate(date.getDate() + i);
    dates.push(toDateString(d));
  }
  return dates;
}

function computeMacroAdjustment(
  dailyValue: number,
  weeklyOverride: number | null,
  consumed: number,
  daysRemaining: number,
): MacroAdjustment {
  const weeklyTarget = weeklyOverride && weeklyOverride > 0 ? weeklyOverride : dailyValue * 7;
  const remaining = weeklyTarget - consumed;
  const adjustedDaily = daysRemaining > 0 && remaining >= 0 ? Math.round(remaining / daysRemaining) : null;
  return { weeklyTarget, consumed, remaining, adjustedDaily };
}

/** Les sept jours prescrits, ou `null` si le plan n'en fournit pas sept. */
function septJoursPrescrits(
  target: NutritionDailyTarget,
): readonly (NutritionDayValues | null)[] | null {
  return target.perDay && target.perDay.length === 7 ? target.perDay : null;
}

function lireMacroJour(jour: NutritionDayValues, cle: keyof NutritionDayValues): number {
  const valeur = jour[cle];
  return Number.isFinite(valeur) && valeur > 0 ? valeur : 0;
}

/**
 * Répartit ce qu'il reste sur les jours NON REMPLIS, **au prorata de ce qui
 * a été prescrit pour chacun**.
 *
 * C'est le cœur du correctif : un mardi prescrit à 2 000 kcal reste plus bas
 * qu'un lundi à 3 000, même après ajustement. La répartition à parts égales
 * écrasait la forme de la semaine construite par le coach.
 *
 * Quand la somme prescrite des jours restants est nulle (aucun objectif
 * saisi), on retombe sur un partage égal : c'est le seul repli possible, et
 * il ne peut concerner qu'un plan vide.
 *
 * Rendu : un tableau de 7 valeurs, `null` pour un jour déjà rempli ou quand
 * l'objectif hebdomadaire est déjà dépassé.
 */
function repartirAuProrata(
  prescrits: readonly (NutritionDayValues | null)[],
  cle: keyof NutritionDayValues,
  restant: number,
  jourRempli: readonly boolean[],
): readonly (number | null)[] {
  const indices = prescrits.map((_, i) => i).filter((i) => !jourRempli[i]);
  if (indices.length === 0 || restant < 0) {
    return prescrits.map(() => null);
  }

  const poids = indices.map((i) => lireMacroJour(prescrits[i] ?? { calories: 0, protein: 0, carbs: 0, fat: 0 }, cle));
  const sommePoids = poids.reduce((t, p) => t + p, 0);

  const valeurs = new Map<number, number>();
  if (sommePoids <= 0) {
    const part = Math.round(restant / indices.length);
    for (const i of indices) valeurs.set(i, part);
  } else {
    for (let rang = 0; rang < indices.length; rang += 1) {
      valeurs.set(indices[rang], Math.round((restant * poids[rang]) / sommePoids));
    }
  }

  return prescrits.map((_, i) => valeurs.get(i) ?? null);
}

export function computeWeeklyNutritionAdjustment(
  target: NutritionDailyTarget,
  logs: DailyNutritionLog[],
  weekDates: string[] = getCurrentWeekDates(),
): WeeklyNutritionAdjustment {
  const logsByDate = new Map(logs.map((log) => [log.logDate, log]));
  const filledLogs = weekDates
    .map((d) => logsByDate.get(d))
    .filter((log): log is DailyNutritionLog => !!log && log.calories !== null);

  const sum = (key: "calories" | "proteinG" | "carbsG" | "fatG") =>
    filledLogs.reduce((total, log) => total + (log[key] ?? 0), 0);

  const daysFilled = filledLogs.length;
  const daysRemaining = 7 - daysFilled;

  const prescrits = septJoursPrescrits(target);

  // Objectif hebdomadaire : la SOMME des sept jours prescrits quand ils sont
  // fournis. Jamais « objectif du jour × 7 », qui est faux dès que deux jours
  // diffèrent — précisément ce que le nouveau constructeur permet.
  const semaineCalories =
    prescrits !== null
      ? prescrits.reduce((t, j) => t + (j ? lireMacroJour(j, "calories") : 0), 0)
      : 0;
  const semaineProteines =
    prescrits !== null ? prescrits.reduce((t, j) => t + (j ? lireMacroJour(j, "protein") : 0), 0) : 0;
  const semaineGlucides =
    prescrits !== null ? prescrits.reduce((t, j) => t + (j ? lireMacroJour(j, "carbs") : 0), 0) : 0;
  const semaineLipides =
    prescrits !== null ? prescrits.reduce((t, j) => t + (j ? lireMacroJour(j, "fat") : 0), 0) : 0;

  const calories = computeMacroAdjustment(
    target.calories,
    target.weeklyTargetCalories > 0 ? target.weeklyTargetCalories : semaineCalories,
    sum("calories"),
    daysRemaining,
  );
  const protein = computeMacroAdjustment(target.protein, semaineProteines || null, sum("proteinG"), daysRemaining);
  const carbs = computeMacroAdjustment(target.carbs, semaineGlucides || null, sum("carbsG"), daysRemaining);
  const fat = computeMacroAdjustment(target.fat, semaineLipides || null, sum("fatG"), daysRemaining);

  const overBudget = calories.remaining < 0;
  const lowCalorieWarning =
    calories.adjustedDaily !== null && calories.adjustedDaily < Math.max(LOW_CALORIE_FLOOR, target.calories * 0.5);

  const todayIso = toDateString(new Date());
  const rempli = weekDates.map((date) => {
    const log = logsByDate.get(date);
    return !!log && log.calories !== null;
  });

  // Objectifs ajustés PAR JOUR, au prorata de ce qui a été prescrit.
  const ajustés =
    prescrits !== null
      ? {
          calories: repartirAuProrata(prescrits, "calories", calories.remaining, rempli),
          protein: repartirAuProrata(prescrits, "protein", protein.remaining, rempli),
          carbs: repartirAuProrata(prescrits, "carbs", carbs.remaining, rempli),
          fat: repartirAuProrata(prescrits, "fat", fat.remaining, rempli),
        }
      : null;

  const days: WeekDayAdjustment[] = weekDates.map((date, index) => {
    const log = logsByDate.get(date) ?? null;
    const filled = rempli[index];
    const jourPrescrit = prescrits?.[index] ?? null;

    // Un jour REMPLI garde son objectif prescrit — on ne réécrit jamais le
    // passé. Un jour à venir reçoit sa part du restant.
    const prescritCalories = jourPrescrit ? lireMacroJour(jourPrescrit, "calories") : target.calories;

    return {
      date,
      label: WEEKDAY_LABELS[index],
      isToday: date === todayIso,
      filled,
      log,
      targetCalories: filled ? prescritCalories : (ajustés?.calories[index] ?? calories.adjustedDaily),
      targetProtein: filled
        ? (jourPrescrit ? lireMacroJour(jourPrescrit, "protein") : target.protein)
        : (ajustés?.protein[index] ?? protein.adjustedDaily),
      targetCarbs: filled
        ? (jourPrescrit ? lireMacroJour(jourPrescrit, "carbs") : target.carbs)
        : (ajustés?.carbs[index] ?? carbs.adjustedDaily),
      targetFat: filled
        ? (jourPrescrit ? lireMacroJour(jourPrescrit, "fat") : target.fat)
        : (ajustés?.fat[index] ?? fat.adjustedDaily),
      varianceCalories: filled && log ? (log.calories as number) - prescritCalories : null,
    };
  });

  return { weekDates, days, daysFilled, daysRemaining, overBudget, lowCalorieWarning, calories, protein, carbs, fat };
}
