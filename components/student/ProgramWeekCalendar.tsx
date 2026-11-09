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
  /**
   * Nommer le jour d'aujourd'hui en mots, en plus de le teinter.
   *
   * ⚠️ ELLE EXISTE À CAUSE DU VERT. Dès que des séances portent un contour vert,
   * le fond légèrement teinté du jour courant devient une seconde couleur à
   * interpréter, et deux informations différentes se disputent le même canal.
   * La pastille lève l'ambiguïté sans toucher au reste — et elle la lève aussi
   * pour qui ne distingue pas le vert du neutre.
   *
   * ⚠️ ABSENTE SUR LE PARCOURS ÉLÈVE, où il n'y a pas de vert : son calendrier
   * garde exactement l'apparence qu'il avait.
   */
  marqueAujourdhui?: boolean;
}

/**
 * « Aujourd'hui » — le repère du calendrier, écrit.
 *
 * ⚠️ IL NE DIT RIEN DE CE QUI A ÉTÉ FAIT. C'est le jour réel, lu du calendrier,
 * et il reste à sa place qu'une séance soit validée, en retard ou en avance.
 */
function ChipAujourdhui() {
  return (
    <span className="mt-auto inline-flex w-fit items-center rounded-control border border-primary/50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
      Aujourd&apos;hui
    </span>
  );
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
  marqueAujourdhui = false,
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
              data-jour-courant={day.isToday ? "oui" : undefined}
              className={`flex flex-col gap-2 rounded-panel border border-dashed p-4 ${
                day.isToday ? "border-primary/50 bg-primary/5" : "border-border/70 bg-surface-soft/40"
              }`}
            >
              {dayLabel}
              <span className="text-sm text-muted-foreground">Repos</span>
              {marqueAujourdhui && day.isToday ? <ChipAujourdhui /> : null}
            </div>
          );
        }

        const blocks = session.blocks ?? [];
        const typeLabel = blocks.length ? derivedSessionTypeLabel(deriveSessionType(blocks)) : null;

        const realisee = seancesTerminees?.has(session.id) ?? false;

        /*
         * ⚠️ TROIS SIGNAUX, TROIS SOURCES, ET AUCUN NE PARLE POUR UN AUTRE :
         *
         *   · le CONTOUR vient de la séance : vert si elle est enregistrée en
         *     base, neutre sinon. Il ne dépend NI de la date, NI de la
         *     progression globale ;
         *   · le FOND vient du calendrier : teinté le jour d'aujourd'hui. Il ne
         *     dépend PAS de ce qui a été fait ;
         *   · la MENTION vient de la séance, et redit le contour en mots —
         *     parce qu'une information portée par la seule couleur est perdue
         *     pour qui ne la distingue pas.
         *
         * ⚠️ ILS SE CUMULENT, ILS NE SE REMPLACENT PAS. Une séance faite
         * AUJOURD'HUI doit garder son contour vert ET son fond du jour : écrire
         * `realisee ? vert : (isToday ? aujourdhui : neutre)` aurait fait
         * disparaître le repère du jour dès la séance validée — c'est-à-dire
         * au moment précis où le coach cherche où il en est.
         */
        const contour = realisee
          ? "border-success"
          : day.isToday
            ? "border-primary/40"
            : "border-border";
        const fond = day.isToday ? "bg-primary/5" : "bg-card";

        return (
          <Link
            key={day.day}
            href={lienSeance ? lienSeance(session) : `/entrainement/seance/${session.id}`}
            data-seance-realisee={seancesTerminees ? (realisee ? "oui" : "non") : undefined}
            data-jour-courant={day.isToday ? "oui" : undefined}
            className={`pressable flex flex-col gap-2 rounded-panel border p-4 hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${contour} ${fond}`}
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
              {marqueAujourdhui && day.isToday ? <ChipAujourdhui /> : null}
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
