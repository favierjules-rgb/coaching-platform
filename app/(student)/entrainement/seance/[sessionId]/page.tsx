import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BarChart3, Flame, MessageSquare } from "lucide-react";

import { SessionFeedbackSection } from "@/components/student/SessionFeedbackSection";
import { MuscleGroupBars, TrainingStatCards } from "@/components/shared/TrainingMetricsSummary";
import {
  getTrainingProgram,
  getWorkoutSession,
  student,
  workoutSessions,
} from "@/data/student";
import { calculateSessionMetrics } from "@/lib/training-metrics";

export function generateStaticParams() {
  return workoutSessions.map((session) => ({ sessionId: session.id }));
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = getWorkoutSession(sessionId);

  if (!session) {
    notFound();
  }

  const program = getTrainingProgram(session.programId);
  const plannedMetrics = calculateSessionMetrics({ ...session, muscleGroup: session.muscleGroups });

  return (
    <div>
      <Link
        href={program ? `/entrainement/${program.id}` : "/entrainement"}
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        {program ? program.name : "Entraînement"}
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          {session.name}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {session.day} · {session.durationMinutes} min ·{" "}
          {session.exercises.length} exercices
        </p>
      </div>

      <div className="mb-8 border border-border bg-card p-6">
        <h2 className="mb-4 flex items-center gap-2 font-heading text-sm font-bold uppercase text-foreground">
          <BarChart3 size={16} className="text-primary" />
          Analyse de la séance (prévu)
        </h2>
        <div className="flex flex-col gap-4">
          <TrainingStatCards
            totalSets={plannedMetrics.totalSets}
            totalVolume={plannedMetrics.totalVolume}
            totalTonnageKg={plannedMetrics.totalTonnageKg}
            hasEstimatedValues={plannedMetrics.hasEstimatedValues}
            hasNotCalculatedValues={plannedMetrics.hasNotCalculatedValues}
          />
          <MuscleGroupBars breakdown={plannedMetrics.muscleGroupBreakdown} />
        </div>
      </div>

      <div className="mb-8 flex items-start gap-4 border border-border bg-card p-6">
        <Flame size={20} className="mt-0.5 flex-shrink-0 text-primary" />
        <div>
          <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">
            Échauffement
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {session.warmup}
          </p>
        </div>
      </div>

      <div className="mb-8 flex items-start gap-4 border border-border bg-card p-6">
        <MessageSquare size={20} className="mt-0.5 flex-shrink-0 text-primary" />
        <div>
          <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">
            Notes du coach
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {session.coachNotes}
          </p>
        </div>
      </div>

      <SessionFeedbackSection
        studentId={student.id}
        sessionId={session.id}
        exercises={session.exercises}
        sessionMuscleGroup={session.muscleGroups}
      />
    </div>
  );
}
