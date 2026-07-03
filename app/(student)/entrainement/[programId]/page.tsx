import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { NextSessionHighlight } from "@/components/student/NextSessionHighlight";
import { ProgramWeekCalendar } from "@/components/student/ProgramWeekCalendar";
import { ProgressBar } from "@/components/student/ProgressBar";
import { StatusBadge } from "@/components/student/StatusBadge";
import { MuscleGroupBars, TrainingStatCards } from "@/components/shared/TrainingMetricsSummary";
import {
  getHighlightedScheduleDay,
  getTrainingProgram,
  getWorkoutSession,
  trainingPrograms,
  workoutSessions,
} from "@/data/student";
import { calculateTrainingMetrics, formatSets } from "@/lib/training-metrics";

export function generateStaticParams() {
  return trainingPrograms.map((program) => ({ programId: program.id }));
}

export default async function ProgramDetailPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const program = getTrainingProgram(programId);

  if (!program) {
    notFound();
  }

  const programSessions = workoutSessions.filter(
    (session) => session.programId === program.id,
  );

  const highlightedDay = getHighlightedScheduleDay(program.schedule);
  const highlightedSession = highlightedDay?.sessionId
    ? getWorkoutSession(highlightedDay.sessionId)
    : undefined;

  const metricsSessions = programSessions.map((s) => ({ ...s, muscleGroup: s.muscleGroups }));
  const weekMetrics = calculateTrainingMetrics(metricsSessions);
  const dayLoad = metricsSessions
    .map((s) => ({ day: s.day, sets: s.exercises.reduce((sum, ex) => sum + ex.sets, 0) }))
    .sort((a, b) => b.sets - a.sets);

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

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Analyse de la semaine</h2>
        <div className="flex flex-col gap-6">
          <TrainingStatCards
            totalSets={weekMetrics.totalSets}
            totalVolume={weekMetrics.totalVolume}
            totalTonnageKg={weekMetrics.totalTonnageKg}
          />
          <div>
            <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              Séries par groupe musculaire
            </h3>
            <MuscleGroupBars breakdown={weekMetrics.muscleGroupBreakdown} />
          </div>
          {dayLoad.length > 0 && (
            <div>
              <h3 className="mb-3 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Jours les plus chargés
              </h3>
              <div className="flex flex-wrap gap-2">
                {dayLoad.map((d) => (
                  <span key={d.day} className="border border-border px-3 py-1.5 text-xs text-foreground">
                    {d.day} · {formatSets(d.sets)}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

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
