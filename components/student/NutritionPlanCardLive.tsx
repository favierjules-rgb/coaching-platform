"use client";

import { NutritionPlanCard } from "@/components/student/NutritionPlanCard";
import { useNutritionTracking } from "@/hooks/useNutritionTracking";
import type { NutritionPlan } from "@/types";

/**
 * Variante de NutritionPlanCard qui lit l'état de suivi partagé
 * (localStorage) au lieu des données mockées figées, pour que la
 * progression affichée reste cohérente avec /nutrition/[planId].
 */
export function NutritionPlanCardLive({ plan }: { plan: NutritionPlan }) {
  const { days } = useNutritionTracking(plan);
  return <NutritionPlanCard plan={plan} days={days} />;
}
