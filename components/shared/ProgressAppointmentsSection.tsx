import { StatusBadge } from "@/components/admin/StatusBadge";
import { appointmentStatusLabels, appointmentStatusTone, formatDateTime } from "@/lib/admin";
import type { StudentAppointmentStats } from "@/lib/supabase/progress";

/** Rendez-vous (section 6) — basé sur appointments, jamais de rendez-vous inventé si aucun n'a été réservé. */
export function ProgressAppointmentsSection({ appointments }: { appointments: StudentAppointmentStats }) {
  const hasAnyData = appointments.completedCount > 0 || appointments.cancelledCount > 0 || appointments.upcoming.length > 0 || appointments.lastAppointment !== null;

  if (!hasAnyData) {
    return <p className="text-sm text-muted-foreground">Aucune donnée disponible pour le moment.</p>;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" role="list" aria-label="Statistiques de rendez-vous">
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Réalisés</span>
          <span className="text-lg font-bold text-foreground">{appointments.completedCount}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Annulés</span>
          <span className="text-lg font-bold text-foreground">{appointments.cancelledCount}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">À venir</span>
          <span className="text-lg font-bold text-foreground">{appointments.upcoming.length}</span>
        </div>
        <div>
          <span className="block text-xs uppercase tracking-wide text-muted-foreground">Dernier rendez-vous</span>
          <span className="text-sm font-bold text-foreground">
            {appointments.lastAppointment ? formatDateTime(appointments.lastAppointment.startAt) : "Aucun"}
          </span>
        </div>
      </div>

      {appointments.upcoming.length > 0 && (
        <div>
          <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">Prochains rendez-vous</h3>
          <div className="flex flex-col gap-2">
            {appointments.upcoming.slice(0, 5).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 border border-border p-3 text-sm">
                <span className="text-foreground">
                  {a.appointmentType} · {formatDateTime(a.startAt)}
                </span>
                <StatusBadge label={appointmentStatusLabels[a.status]} tone={appointmentStatusTone(a.status)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
