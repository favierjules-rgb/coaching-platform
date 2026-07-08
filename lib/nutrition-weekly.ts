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

export interface NutritionDailyTarget {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** Objectif hebdomadaire calories du plan, si renseigné (sinon calories × 7). */
  weeklyTargetCalories: number;
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

  const calories = computeMacroAdjustment(target.calories, target.weeklyTargetCalories, sum("calories"), daysRemaining);
  const protein = computeMacroAdjustment(target.protein, null, sum("proteinG"), daysRemaining);
  const carbs = computeMacroAdjustment(target.carbs, null, sum("carbsG"), daysRemaining);
  const fat = computeMacroAdjustment(target.fat, null, sum("fatG"), daysRemaining);

  const overBudget = calories.remaining < 0;
  const lowCalorieWarning =
    calories.adjustedDaily !== null && calories.adjustedDaily < Math.max(LOW_CALORIE_FLOOR, target.calories * 0.5);

  const todayIso = toDateString(new Date());

  const days: WeekDayAdjustment[] = weekDates.map((date, index) => {
    const log = logsByDate.get(date) ?? null;
    const filled = !!log && log.calories !== null;
    return {
      date,
      label: WEEKDAY_LABELS[index],
      isToday: date === todayIso,
      filled,
      log,
      targetCalories: filled ? target.calories : calories.adjustedDaily,
      targetProtein: filled ? target.protein : protein.adjustedDaily,
      targetCarbs: filled ? target.carbs : carbs.adjustedDaily,
      targetFat: filled ? target.fat : fat.adjustedDaily,
      varianceCalories: filled && log ? (log.calories as number) - target.calories : null,
    };
  });

  return { weekDates, days, daysFilled, daysRemaining, overBudget, lowCalorieWarning, calories, protein, carbs, fat };
}
