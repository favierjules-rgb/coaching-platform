import type {
  NutritionAdjustment,
  NutritionDay,
  NutritionGoalType,
  NutritionPlan,
  WeeklyNutritionSummary,
} from "@/types";

export const nutritionGoalLabels: Record<NutritionGoalType, string> = {
  "perte-de-poids": "Perte de poids",
  maintien: "Maintien",
  "prise-de-masse": "Prise de masse",
  performance: "Performance",
};

/** Écart (en kcal) en-deçà duquel une journée est considérée "alignée". */
const GREEN_THRESHOLD = 100;
/** Écart (en kcal) au-delà duquel une journée est considérée "gros écart". */
const ORANGE_THRESHOLD = 300;

export type VarianceDirection = "on-track" | "over" | "under";
export type VarianceSeverity = "green" | "orange" | "red";

export function getVarianceDirection(deltaKcal: number): VarianceDirection {
  if (deltaKcal > GREEN_THRESHOLD) return "over";
  if (deltaKcal < -GREEN_THRESHOLD) return "under";
  return "on-track";
}

export function getVarianceSeverity(deltaKcal: number): VarianceSeverity {
  const magnitude = Math.abs(deltaKcal);
  if (magnitude <= GREEN_THRESHOLD) return "green";
  if (magnitude <= ORANGE_THRESHOLD) return "orange";
  return "red";
}

export function computeWeeklySummary(
  studentId: string,
  plan: NutritionPlan,
  days: NutritionDay[],
): WeeklyNutritionSummary {
  const validatedDays = days.filter(
    (day) => day.status === "valide" && day.actual,
  );
  const consumedCalories = validatedDays.reduce(
    (sum, day) => sum + (day.actual?.macros.calories ?? 0),
    0,
  );
  const daysValidated = validatedDays.length;
  const daysRemaining = days.length - daysValidated;
  const remainingCalories = plan.weeklyTargetCalories - consumedCalories;
  const recommendedDailyAverage =
    daysRemaining > 0 ? Math.round(remainingCalories / daysRemaining) : 0;

  return {
    studentId,
    planId: plan.id,
    weekStartDate: days[0]?.weekStartDate ?? "",
    weeklyTargetCalories: plan.weeklyTargetCalories,
    consumedCalories,
    remainingCalories,
    daysValidated,
    daysRemaining,
    recommendedDailyAverage,
  };
}

function formatKcal(value: number): string {
  return Math.round(value).toLocaleString("fr-FR");
}

export function computeAdjustment(
  studentId: string,
  plan: NutritionPlan,
  days: NutritionDay[],
): NutritionAdjustment {
  const summary = computeWeeklySummary(studentId, plan, days);
  const base = {
    studentId,
    planId: plan.id,
    weekStartDate: summary.weekStartDate,
    summary,
  };

  if (summary.daysValidated === 0) {
    return {
      ...base,
      tone: "no-data",
      message: `Aucune journée validée pour l'instant cette semaine. Objectif : ${formatKcal(plan.weeklyTargetCalories)} kcal.`,
    };
  }

  const varianceSoFar =
    summary.consumedCalories - plan.dailyTarget.calories * summary.daysValidated;

  if (summary.daysRemaining === 0) {
    const WEEK_COMPLETE_TOLERANCE = 200;
    const outcome =
      varianceSoFar > WEEK_COMPLETE_TOLERANCE
        ? "dépassé"
        : varianceSoFar < -WEEK_COMPLETE_TOLERANCE
          ? "non atteint"
          : "atteint";
    return {
      ...base,
      tone: "week-complete",
      message: `Tous les jours sont validés. Objectif semaine ${outcome}.`,
    };
  }

  const direction = getVarianceDirection(varianceSoFar);
  const roundedVariance = formatKcal(Math.abs(varianceSoFar));

  if (direction === "on-track") {
    return {
      ...base,
      tone: "on-track",
      message: "Tu es parfaitement aligné avec l'objectif hebdomadaire.",
    };
  }

  if (direction === "over") {
    return {
      ...base,
      tone: "over",
      message: `Tu es à +${roundedVariance} kcal. Vise environ ${formatKcal(summary.recommendedDailyAverage)} kcal/jour sur les ${summary.daysRemaining} prochains jours.`,
    };
  }

  return {
    ...base,
    tone: "under",
    message: `Tu es à -${roundedVariance} kcal. Tu peux viser environ ${formatKcal(summary.recommendedDailyAverage)} kcal/jour sur les ${summary.daysRemaining} prochains jours.`,
  };
}
