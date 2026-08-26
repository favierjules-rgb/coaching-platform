"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { DiagnosticOffline } from "@/components/pwa/DiagnosticOffline";
import { MuscleHeatmapSection } from "@/components/student/MuscleHeatmapSection";
import { NextSessionHighlight } from "@/components/student/NextSessionHighlight";
import { ProgramWeekCalendar } from "@/components/student/ProgramWeekCalendar";
import { ProgressBar } from "@/components/student/ProgressBar";
import { StatusBadge } from "@/components/student/StatusBadge";
import { WeekAnalysisSection } from "@/components/student/WeekAnalysisSection";
import {
  getHighlightedScheduleDay,
  getTrainingProgram,
  getWorkoutSession,
  workoutSessions,
} from "@/data/student";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useSupabaseTrainingProgram } from "@/hooks/useSupabaseTrainingProgram";
import {
  buildScheduleForWeek,
  computeCurrentWeekNumber,
  toEleveTrainingProgram,
  toEleveWorkoutSession,
} from "@/lib/training-schedule";
import { Loader } from "@/components/ui/Loader";

export default function ProgramDetailPage() {
  const params = useParams<{ programId: string }>();
  const supabaseTraining = useSupabaseTrainingProgram();
  // Même diagnostic que /entrainement et /dashboard. Aucune requête tant que
  // le chargement en ligne n'a pas rendu son verdict.
  const local = useEtatOfflineEleve(supabaseTraining.ready && !supabaseTraining.active);

  if (!supabaseTraining.ready) {
    return <Loader libelle="Chargement…" variante="ligne" />;
  }

  if (supabaseTraining.active) {
    const realProgram = supabaseTraining.programs.find((p) => p.id === params.programId);

    if (!realProgram) {
      return (
        <div>
          <Link
            href="/entrainement"
            className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Mes programmes
          </Link>
          <p className="text-sm text-muted-foreground">Programme introuvable.</p>
        </div>
      );
    }

    const weekNumber = computeCurrentWeekNumber(realProgram, supabaseTraining.student);
    const program = toEleveTrainingProgram(realProgram, weekNumber);
    const weekNumbers = Array.from(new Set(realProgram.sessions.map((s) => s.weekNumber))).sort((a, b) => a - b);
    const currentWeekSessions = realProgram.sessions
      .filter((s) => s.weekNumber === weekNumber)
      .map(toEleveWorkoutSession);
    const metricsSessions = currentWeekSessions.map((s) => ({ ...s, muscleGroup: s.muscleGroups }));

    const highlightedDay = getHighlightedScheduleDay(program.schedule);
    const highlightedSession = highlightedDay?.sessionId
      ? currentWeekSessions.find((s) => s.id === highlightedDay.sessionId)
      : undefined;

    return (
      <div>
        <Link
          href="/entrainement"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes programmes
        </Link>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              {program.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{program.goal}</p>
          </div>
          <StatusBadge status={program.status} />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{program.durationWeeks} sem.</div>
            <div className="text-xs text-muted-foreground">Durée</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{program.level || "—"}</div>
            <div className="text-xs text-muted-foreground">Niveau</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{program.sessionsPerWeek}</div>
            <div className="text-xs text-muted-foreground">Séances / semaine</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">
              {program.status === "à venir" ? "—" : `${program.currentWeek} / ${program.durationWeeks}`}
            </div>
            <div className="text-xs text-muted-foreground">Semaine actuelle</div>
          </div>
        </div>

        <div className="mb-8 border border-border bg-card p-6">
          <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
            <span className="uppercase tracking-wide">Progression du programme</span>
            <span>{program.progressPercent}%</span>
          </div>
          <ProgressBar percent={program.progressPercent} />
        </div>

        {metricsSessions.length > 0 && <WeekAnalysisSection sessions={metricsSessions} />}

        {currentWeekSessions.some((s) => (s.blocks ?? []).length > 0) && (
          <div className="mb-8">
            <MuscleHeatmapSection
              blocks={currentWeekSessions.flatMap((s) => s.blocks ?? [])}
              title="Intensité musculaire de la semaine"
            />
          </div>
        )}

        {highlightedSession && highlightedDay && (
          <div className="mb-8">
            <NextSessionHighlight
              session={highlightedSession}
              dayLabel={highlightedDay.isToday ? "Aujourd'hui" : highlightedDay.day}
            />
          </div>
        )}

        <div className="flex flex-col gap-8">
          {weekNumbers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune séance planifiée pour le moment.</p>
          ) : (
            weekNumbers.map((week) => (
              <div key={week}>
                <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
                  Semaine {week}
                </h2>
                <ProgramWeekCalendar
                  schedule={buildScheduleForWeek(realProgram, week)}
                  sessions={realProgram.sessions.filter((s) => s.weekNumber === week).map(toEleveWorkoutSession)}
                />
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
   * LE SERVEUR N'A PAS RÉPONDU
   * ══════════════════════════════════════════════════════════════════
   * Le détail d'un programme — semaines, calendrier, analyse de volume — ne
   * tient pas dans le snapshot, et l'y mettre reviendrait à faire tout le
   * programme hors ligne pour corriger un repli. On le dit donc, et on
   * s'arrête là.
   *
   * Ce qu'on peut montrer sans mentir : le nom du programme, s'il s'agit
   * bien de CELUI-CI, et la séance du jour — les deux viennent du snapshot
   * réel préparé en ligne. */
  if (local.etat === "chargement") {
    return <Loader libelle="Chargement…" variante="ligne" />;
  }

  if (local.etat === "offline" || local.etat === "erreur" || local.etat === "indisponible") {
    const memeProgramme = local.contenu?.programId === params.programId;
    return (
      <div>
        <DiagnosticOffline
          titre="/entrainement/[programId]"
          lignes={{
            etat: local.etat,
            programIdUrl: params.programId,
            programIdSnapshot: local.contenu?.programId ?? null,
            sessionIdSnapshot: local.sessionId,
            businessDate: local.businessDate,
          }}
        />
        <Link
          href="/entrainement"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes programmes
        </Link>

        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {local.etat === "offline" && memeProgramme && local.contenu?.programName
              ? local.contenu.programName
              : "Programme"}
          </h1>
        </div>

        <p className="mb-8 text-sm text-muted-foreground">
          {local.etat === "erreur"
            ? "Le serveur n'a pas pu répondre correctement. Réessaie dans un instant — rien n'a été perdu."
            : "Cette partie nécessite une connexion : le détail d'un programme n'est pas conservé sur cet appareil."}
        </p>

        {local.etat === "offline" && memeProgramme && local.contenu && (
          <div className="mb-8">
            <NextSessionHighlight session={local.contenu.session} dayLabel="Aujourd'hui" />
          </div>
        )}
      </div>
    );
  }

  /* ── DÉMONSTRATION ──────────────────────────────────────────────────
   * Seul `local.etat === "mock"` arrive ici : Supabase non configuré. */
  const program = getTrainingProgram(params.programId);

  if (!program) {
    return (
      <div>
        <Link
          href="/entrainement"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes programmes
        </Link>
        <p className="text-sm text-muted-foreground">Programme introuvable.</p>
      </div>
    );
  }

  const programSessions = workoutSessions.filter((session) => session.programId === program.id);
  const highlightedDay = getHighlightedScheduleDay(program.schedule);
  const highlightedSession = highlightedDay?.sessionId ? getWorkoutSession(highlightedDay.sessionId) : undefined;
  const metricsSessions = programSessions.map((s) => ({ ...s, muscleGroup: s.muscleGroups }));

  return (
    <div>
      <Link
        href="/entrainement"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Mes programmes
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {program.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{program.goal}</p>
        </div>
        <StatusBadge status={program.status} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {program.durationWeeks} sem.
          </div>
          <div className="text-xs text-muted-foreground">Durée</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {program.level}
          </div>
          <div className="text-xs text-muted-foreground">Niveau</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {program.sessionsPerWeek}
          </div>
          <div className="text-xs text-muted-foreground">Séances / semaine</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {program.status === "à venir"
              ? "—"
              : `${program.currentWeek} / ${program.durationWeeks}`}
          </div>
          <div className="text-xs text-muted-foreground">Semaine actuelle</div>
        </div>
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <div className="mb-3 flex items-center justify-between text-xs text-muted-foreground">
          <span className="uppercase tracking-wide">Progression du programme</span>
          <span>{program.progressPercent}%</span>
        </div>
        <ProgressBar percent={program.progressPercent} />
      </div>

      <WeekAnalysisSection sessions={metricsSessions} />

      {highlightedSession && highlightedDay && (
        <div className="mb-8">
          <NextSessionHighlight
            session={highlightedSession}
            dayLabel={highlightedDay.isToday ? "Aujourd'hui" : highlightedDay.day}
          />
        </div>
      )}

      <div>
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Calendrier de la semaine
        </h2>
        <ProgramWeekCalendar schedule={program.schedule} sessions={programSessions} />
      </div>
    </div>
  );
}
