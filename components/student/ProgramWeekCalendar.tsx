import Link from "next/link";

import { SessionBlockChips } from "@/components/student/SessionBlockChips";
import { formaterDureeMinutes } from "@/lib/duree";
import { derivedSessionTypeLabel } from "@/lib/session-summary";
import { deriveSessionType } from "@/lib/training-blocks";
import type { ProgramScheduleDay, WorkoutSession } from "@/types";

interface ProgramWeekCalendarProps {
  schedule: ProgramScheduleDay[];
  sessions: WorkoutSession[];
  /**
   * MODE LIVE — où mène le clic sur une séance.
   *
   * ⚠️ ABSENTE, LA DESTINATION EST RIGOUREUSEMENT CELLE D'AVANT :
   * `/entrainement/seance/[id]`, le parcours de l'élève. Ce paramètre existe
   * pour que le coach ouvre LA MÊME grille vers la route présentielle, sans
   * qu'on écrive une seconde grille qui divergerait de celle-ci au premier
   * ajustement.
   */
  lienSeance?: (session: WorkoutSession) => string;
  /**
   * Séances déjà validées par l'élève.
   *
   * ⚠️ ABSENT, AUCUNE SÉANCE N'EST MARQUÉE et l'écran de l'élève est identique
   * à ce qu'il était. Fourni, chaque carte distingue « à réaliser » de
   * « réalisée » — c'est ce qui évite au coach de rouvrir en saisie une séance
   * dont l'historique existe déjà.
   */
  seancesTerminees?: ReadonlySet<string>;
  /** Libellé de l'action proposée sur une séance à réaliser (mode Live). */
  libelleAction?: string;
}

/**
 * Semaine élève : une carte par jour. Le contenu de chaque séance est rendu
 * depuis le modèle canonique `blocks[]` (pastilles SessionBlockChips + type
 * global dérivé), jamais depuis `exercises[]`/`cardioBlocks[]`. Les jours sans
 * séance affichent une carte de repos volontairement plus légère (pointillés).
 *
 * ⚠️ UNE SEULE GRILLE, DEUX PARCOURS. L'élève et le coach en mode Live rendent
 * ce composant-ci ; seules la DESTINATION du lien et la mention « réalisée »
 * changent, par propriétés optionnelles. Une copie « simplifiée » pour le coach
 * aurait cessé d'afficher les pastilles de blocs le jour où elles ont changé de
 * forme, et personne ne l'aurait vu.
 */
export function ProgramWeekCalendar({
  schedule,
  sessions,
  lienSeance,
  seancesTerminees,
  libelleAction,
}: ProgramWeekCalendarProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {schedule.map((day) => {
        const session = day.sessionId ? sessions.find((item) => item.id === day.sessionId) : undefined;

        const dayLabel = (
          <span
            className={`font-heading text-xs font-semibold uppercase tracking-widest ${
              day.isToday ? "text-primary" : "text-muted-foreground"
            }`}
          >
            {day.day}
          </span>
        );

        // Jour de repos : carte plus légère (pointillés), aucune fausse pastille.
        if (!session) {
          return (
            <div
              key={day.day}
              className={`flex flex-col gap-2 rounded-panel border border-dashed p-4 ${
                day.isToday ? "border-primary/50 bg-primary/5" : "border-border/70 bg-surface-soft/40"
              }`}
            >
              {dayLabel}
              <span className="text-sm text-muted-foreground">Repos</span>
            </div>
          );
        }

        const blocks = session.blocks ?? [];
        const typeLabel = blocks.length ? derivedSessionTypeLabel(deriveSessionType(blocks)) : null;

        const realisee = seancesTerminees?.has(session.id) ?? false;

        return (
          <Link
            key={day.day}
            href={lienSeance ? lienSeance(session) : `/entrainement/seance/${session.id}`}
            data-seance-realisee={seancesTerminees ? (realisee ? "oui" : "non") : undefined}
            className={`pressable flex flex-col gap-2 rounded-panel border p-4 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              day.isToday ? "border-primary/40 bg-primary/5" : "border-border bg-card"
            }`}
          >
            {dayLabel}
            <div className="flex flex-1 flex-col gap-2">
              <div>
                <span className="block text-sm font-medium leading-snug text-foreground">{session.name}</span>
                <span className="text-[11px] text-muted-foreground">
                  {formaterDureeMinutes(session.durationMinutes)}{typeLabel ? ` · ${typeLabel}` : ""}
                </span>
              </div>
              <SessionBlockChips blocks={blocks} max={3} />
              {/* ⚠️ RENDU SEULEMENT QUAND L'APPELANT A FOURNI L'HISTORIQUE.
                  L'écran de l'élève ne passe pas `seancesTerminees` : il ne
                  gagne ni mention, ni action, et reste tel quel. */}
              {seancesTerminees ? (
                realisee ? (
                  <span className="mt-auto text-[11px] font-semibold uppercase tracking-widest text-success">
                    Réalisée · consulter
                  </span>
                ) : (
                  <span className="mt-auto text-[11px] font-semibold uppercase tracking-widest text-primary">
                    {libelleAction ?? "À réaliser"}
                  </span>
                )
              ) : null}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
