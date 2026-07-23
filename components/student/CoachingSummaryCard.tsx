import { CoachingStatusBadge } from "@/components/student/CoachingStatusBadge";
import type { StudentProfile } from "@/types";

export function CoachingSummaryCard({ profile }: { profile: StudentProfile }) {
  return (
    <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Résumé du coaching
        </h2>
        <CoachingStatusBadge status={profile.coachingStatus} />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            Semaine actuelle
          </span>
          <span className="font-heading text-xl font-bold text-foreground">
            S{profile.weekNumber}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            Début du coaching
          </span>
          <span className="font-heading text-xl font-bold text-foreground">
            {new Date(profile.startDate).toLocaleDateString("fr-FR")}
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            Fréquence
          </span>
          <span className="font-heading text-xl font-bold text-foreground">
            {profile.trainingFrequencyPerWeek}x / semaine
          </span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">
            Lieu
          </span>
          <span className="font-heading text-xl font-bold text-foreground">
            {profile.trainingLocation}
          </span>
        </div>
      </div>
    </div>
  );
}
