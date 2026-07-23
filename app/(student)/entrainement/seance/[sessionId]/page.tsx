"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Flame, MessageSquare } from "lucide-react";

import { MuscleHeatmapSection } from "@/components/student/MuscleHeatmapSection";
import { SessionAnalysisSection } from "@/components/student/SessionAnalysisSection";
import { SessionFeedbackSection } from "@/components/student/SessionFeedbackSection";
import {
  getTrainingProgram,
  getWorkoutSession,
  student,
} from "@/data/student";
import { useSupabaseTrainingProgram } from "@/hooks/useSupabaseTrainingProgram";
import { toEleveWorkoutSession } from "@/lib/training-schedule";

export default function SessionDetailPage() {
  const params = useParams<{ sessionId: string }>();
  const supabaseTraining = useSupabaseTrainingProgram();

  if (!supabaseTraining.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseTraining.active) {
    let realSession: ReturnType<typeof toEleveWorkoutSession> | null = null;
    let realProgramName: string | null = null;
    let realProgramId: string | null = null;

    for (const program of supabaseTraining.programs) {
      const match = program.sessions.find((s) => s.id === params.sessionId);
      if (match) {
        realSession = toEleveWorkoutSession(match);
        realProgramName = program.name;
        realProgramId = program.id;
        break;
      }
    }

    if (!realSession) {
      return (
        <div>
          <Link
            href="/entrainement"
            className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowLeft size={14} />
            Entraînement
          </Link>
          <p className="text-sm text-muted-foreground">Séance introuvable.</p>
        </div>
      );
    }

    return (
      <div>
        <Link
          href={realProgramId ? `/entrainement/${realProgramId}` : "/entrainement"}
          className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft size={14} />
          {realProgramName ?? "Entraînement"}
        </Link>

        {realSession.bannerUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- bucket Storage public, URL externe
          <img src={realSession.bannerUrl} alt="" className="mb-6 h-48 w-full rounded-card border border-border object-cover" />
        )}

        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {realSession.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {realSession.day} · {realSession.durationMinutes} min
            {(realSession.sessionType ?? "strength") !== "cardio" ? ` · ${realSession.exercises.length} exercices` : ""}
            {(realSession.sessionType ?? "strength") !== "strength"
              ? ` · ${(realSession.cardioBlocks ?? []).length} bloc${(realSession.cardioBlocks ?? []).length > 1 ? "s" : ""} cardio`
              : ""}
          </p>
        </div>

        <SessionAnalysisSection session={{ ...realSession, muscleGroup: realSession.muscleGroups }} />

        <div className="mb-8">
          <MuscleHeatmapSection blocks={realSession.blocks ?? []} />
        </div>

        {realSession.warmup && (
          <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
            <Flame size={20} className="mt-0.5 flex-shrink-0 text-primary" />
            <div>
              <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">Échauffement</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{realSession.warmup}</p>
            </div>
          </div>
        )}

        {realSession.coachNotes && (
          <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
            <MessageSquare size={20} className="mt-0.5 flex-shrink-0 text-primary" />
            <div>
              <h2 className="mb-1 font-heading text-sm font-bold uppercase text-foreground">Notes du coach</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{realSession.coachNotes}</p>
            </div>
          </div>
        )}

        <SessionFeedbackSection
          studentId={supabaseTraining.studentId ?? ""}
          sessionId={realSession.id}
          programId={realProgramId}
          sessionRefLabel={realSession.name}
          blocks={realSession.blocks}
          exercises={realSession.exercises}
          cardioBlocks={realSession.cardioBlocks}
          sessionMuscleGroup={realSession.muscleGroups}
        />
      </div>
    );
  }

  const session = getWorkoutSession(params.sessionId);

  if (!session) {
    return (
      <div>
        <Link
          href="/entrainement"
          className="mb-6 inline-flex min-h-[44px] w-fit items-center gap-2 rounded-control text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft size={14} />
          Entraînement
        </Link>
        <p className="text-sm text-muted-foreground">Séance introuvable.</p>
      </div>
    );
  }

  const program = getTrainingProgram(session.programId);

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

      <SessionAnalysisSection session={{ ...session, muscleGroup: session.muscleGroups }} />

      <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
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

      <div className="mb-8 flex items-start gap-4 rounded-card border border-border bg-card p-6 shadow-soft">
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
        programId={program?.id ?? null}
        sessionRefLabel={session.name}
        blocks={session.blocks}
        exercises={session.exercises}
        cardioBlocks={session.cardioBlocks}
        sessionMuscleGroup={session.muscleGroups}
      />
    </div>
  );
}
