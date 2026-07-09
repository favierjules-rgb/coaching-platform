import { feedbackStatusLabels, feedbackTypeLabels, formatDate } from "@/lib/admin";
import { formatSets, formatTonnage, formatVolume } from "@/lib/training-metrics";
import type { StudentWorkoutAnalytics } from "@/lib/supabase/progress";

function ExerciseProgressRow({ series }: { series: StudentWorkoutAnalytics["topExercises"][number] }) {
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const delta = first.maxLoadKg !== null && last.maxLoadKg !== null ? Math.round((last.maxLoadKg - first.maxLoadKg) * 10) / 10 : null;

  return (
    <div className="border border-border p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-foreground">{series.exerciseName}</span>
        {delta !== null && (
          <span className={`text-xs font-bold ${delta > 0 ? "text-green-400" : delta < 0 ? "text-amber-400" : "text-muted-foreground"}`}>
            {delta > 0 ? "+" : ""}
            {delta} kg depuis le premier relevé
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {formatDate(first.date)} : {first.maxLoadKg !== null ? `${first.maxLoadKg} kg` : "charge non chiffrable"} → {formatDate(last.date)} :{" "}
        {last.maxLoadKg !== null ? `${last.maxLoadKg} kg` : "charge non chiffrable"} ({series.points.length} relevé{series.points.length > 1 ? "s" : ""})
      </p>
      {series.hasUnparsedLoads && (
        <p className="mt-1 text-[11px] text-muted-foreground">Certaines séries de cet exercice ont une charge non chiffrable (poids du corps, machine sans charge saisie...).</p>
      )}
    </div>
  );
}

/** Entraînement (section 4) — jamais de donnée inventée : si aucun retour n'existe, état vide explicite. */
export function ProgressWorkoutSection({ workout, showRecentFeedback = true }: { workout: StudentWorkoutAnalytics; showRecentFeedback?: boolean }) {
  if (workout.sessionsCompleted === 0 && workout.recentFeedback.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucune donnée disponible pour le moment.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5" role="list" aria-label="Statistiques d'entraînement">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Séances réalisées</span>
          <span className="text-lg font-bold text-foreground">{workout.sessionsCompleted}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Volume total</span>
          <span className="text-lg font-bold text-foreground">{formatVolume(workout.totalVolume)}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Tonnage total</span>
          <span className="text-lg font-bold text-foreground">{formatTonnage(workout.totalTonnageKg)}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Séries réalisées</span>
          <span className="text-lg font-bold text-foreground">{formatSets(workout.totalSets)}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">RPE moyen</span>
          <span className="text-lg font-bold text-foreground">{workout.averageRpe !== null ? `${workout.averageRpe} / 10` : "—"}</span>
        </div>
      </div>

      {workout.topExercises.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Progression sur les exercices principaux</h3>
          <div className="flex flex-col gap-3">
            {workout.topExercises.map((series) => (
              <ExerciseProgressRow key={series.exerciseName} series={series} />
            ))}
          </div>
        </div>
      )}

      {showRecentFeedback && workout.recentFeedback.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Derniers retours</h3>
          <div className="flex flex-col gap-2">
            {workout.recentFeedback.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center justify-between gap-2 border border-border p-3 text-sm">
                <span className="text-foreground">
                  {feedbackTypeLabels[f.type]} · {f.refLabel}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(f.date)} · {feedbackStatusLabels[f.status]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
