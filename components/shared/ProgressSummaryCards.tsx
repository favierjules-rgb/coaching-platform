import { Calendar, CheckCircle2, MessageSquare, Percent, Scale, Target, Utensils } from "lucide-react";

import { StatCard } from "@/components/shared/StatCard";
import { formatDate, formatDateTime } from "@/lib/admin";
import type { StudentProgressSummary } from "@/lib/supabase/progress";

/** Résumé global (section 1) — cartes chiffrées avec label textuel systématique, jamais uniquement une couleur ou une icône pour porter l'information. */
export function ProgressSummaryCards({ summary }: { summary: StudentProgressSummary }) {
  const weightValue =
    summary.currentWeightKg !== null
      ? `${summary.currentWeightKg} kg${summary.weightDeltaKg !== null ? ` (${summary.weightDeltaKg > 0 ? "+" : ""}${summary.weightDeltaKg} kg)` : ""}`
      : "Non renseigné";

  const distanceValue =
    summary.weightDistanceToGoalKg !== null
      ? `${Math.abs(summary.weightDistanceToGoalKg)} kg ${summary.weightDistanceToGoalKg === 0 ? "(atteint)" : summary.weightDistanceToGoalKg > 0 ? "à prendre" : "à perdre"}`
      : "Objectif non renseigné";

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" role="list" aria-label="Résumé global de la progression">
      <StatCard icon={Scale} label="Poids actuel" value={weightValue} hint={summary.startWeightKg !== null ? `Départ : ${summary.startWeightKg} kg` : undefined} />
      <StatCard icon={Target} label="Distance objectif" value={distanceValue} hint={summary.targetWeightKg !== null ? `Objectif : ${summary.targetWeightKg} kg` : undefined} />
      <StatCard icon={Calendar} label="Jours de coaching" value={summary.daysSinceStart !== null ? String(summary.daysSinceStart) : "—"} />
      <StatCard icon={CheckCircle2} label="Séances réalisées" value={String(summary.sessionsCompleted)} />
      <StatCard icon={MessageSquare} label="Retours envoyés" value={String(summary.feedbackSentCount)} />
      <StatCard
        icon={Percent}
        label="Taux d'assiduité"
        value={summary.attendanceRatePercent !== null ? `${summary.attendanceRatePercent}%` : "Non calculable"}
        hint={summary.attendanceRatePercent === null ? "Aucun programme assigné" : undefined}
      />
      <StatCard
        icon={MessageSquare}
        label="Dernier retour entraînement"
        value={summary.lastWorkoutFeedbackAt ? formatDate(summary.lastWorkoutFeedbackAt) : "Aucun"}
      />
      <StatCard
        icon={Utensils}
        label="Dernier log nutrition"
        value={summary.lastNutritionLogAt ? formatDate(summary.lastNutritionLogAt) : "Aucun"}
      />
      <StatCard
        icon={Calendar}
        label="Prochain rendez-vous"
        value={summary.nextAppointmentAt ? formatDateTime(summary.nextAppointmentAt) : "Aucun"}
      />
    </div>
  );
}
