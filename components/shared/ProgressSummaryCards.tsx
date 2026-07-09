import type { LucideIcon } from "lucide-react";
import { Calendar, CheckCircle2, MessageSquare, Percent, Scale, Target, Utensils } from "lucide-react";

import { formatDate, formatDateTime } from "@/lib/admin";
import type { StudentProgressSummary } from "@/lib/supabase/progress";

function SummaryCard({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border bg-card p-5">
      <Icon size={18} className="text-primary" aria-hidden="true" />
      <div className="mt-3 font-heading text-xl font-bold text-foreground">{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

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
      <SummaryCard icon={Scale} label="Poids actuel" value={weightValue} hint={summary.startWeightKg !== null ? `Départ : ${summary.startWeightKg} kg` : undefined} />
      <SummaryCard icon={Target} label="Distance objectif" value={distanceValue} hint={summary.targetWeightKg !== null ? `Objectif : ${summary.targetWeightKg} kg` : undefined} />
      <SummaryCard icon={Calendar} label="Jours de coaching" value={summary.daysSinceStart !== null ? String(summary.daysSinceStart) : "—"} />
      <SummaryCard icon={CheckCircle2} label="Séances réalisées" value={String(summary.sessionsCompleted)} />
      <SummaryCard icon={MessageSquare} label="Retours envoyés" value={String(summary.feedbackSentCount)} />
      <SummaryCard
        icon={Percent}
        label="Taux d'assiduité"
        value={summary.attendanceRatePercent !== null ? `${summary.attendanceRatePercent}%` : "Non calculable"}
        hint={summary.attendanceRatePercent === null ? "Aucun programme assigné" : undefined}
      />
      <SummaryCard
        icon={MessageSquare}
        label="Dernier retour entraînement"
        value={summary.lastWorkoutFeedbackAt ? formatDate(summary.lastWorkoutFeedbackAt) : "Aucun"}
      />
      <SummaryCard
        icon={Utensils}
        label="Dernier log nutrition"
        value={summary.lastNutritionLogAt ? formatDate(summary.lastNutritionLogAt) : "Aucun"}
      />
      <SummaryCard
        icon={Calendar}
        label="Prochain rendez-vous"
        value={summary.nextAppointmentAt ? formatDateTime(summary.nextAppointmentAt) : "Aucun"}
      />
    </div>
  );
}
