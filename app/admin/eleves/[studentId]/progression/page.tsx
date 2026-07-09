"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { ProgressAppointmentsSection } from "@/components/shared/ProgressAppointmentsSection";
import { ProgressMeasurementsSection } from "@/components/shared/ProgressMeasurementsSection";
import { ProgressNutritionSection } from "@/components/shared/ProgressNutritionSection";
import { ProgressSummaryCards } from "@/components/shared/ProgressSummaryCards";
import { ProgressWeightSection } from "@/components/shared/ProgressWeightSection";
import { ProgressWorkoutSection } from "@/components/shared/ProgressWorkoutSection";
import { useSupabaseStudentDetail } from "@/hooks/useSupabaseStudentDetail";
import { useSupabaseStudentProgress } from "@/hooks/useSupabaseStudentProgress";
import { fullName } from "@/lib/admin";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 border border-border bg-card p-6">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function AdminStudentProgressionPage() {
  const params = useParams<{ studentId: string }>();
  const detail = useSupabaseStudentDetail(params.studentId);
  const progress = useSupabaseStudentProgress(params.studentId);

  if (detail.loading || progress.loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!detail.student) {
    return (
      <div>
        <Link
          href={`/admin/eleves/${params.studentId}`}
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Fiche élève
        </Link>
        <p className="text-sm text-muted-foreground">
          Progression indisponible : cet élève n&apos;est pas relié à un compte Supabase réel.
        </p>
      </div>
    );
  }

  const { summary, weight, workout, nutrition, appointments, activity } = progress;

  return (
    <div>
      <Link
        href={`/admin/eleves/${params.studentId}`}
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        {fullName(detail.student)}
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Progression — {fullName(detail.student)}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Vue d&apos;ensemble basée sur les données Supabase réelles de l&apos;élève.</p>
      </div>

      {summary && (
        <Section title="Résumé global">
          <ProgressSummaryCards summary={summary} />
        </Section>
      )}

      <Section title="Évolution du poids">{weight && <ProgressWeightSection weight={weight} />}</Section>

      <Section title="Mensurations">
        <ProgressMeasurementsSection measurements={detail.student.measurements} customMeasurements={detail.student.customMeasurements} />
      </Section>

      <Section title="Entraînement">{workout && <ProgressWorkoutSection workout={workout} />}</Section>

      <Section title="Nutrition">{nutrition && <ProgressNutritionSection nutrition={nutrition} />}</Section>

      <Section title="Rendez-vous">{appointments && <ProgressAppointmentsSection appointments={appointments} />}</Section>

      <Section title="Activité récente">
        <ActivityFeed events={activity} emptyLabel="Aucune activité récente pour cet élève." />
      </Section>
    </div>
  );
}
