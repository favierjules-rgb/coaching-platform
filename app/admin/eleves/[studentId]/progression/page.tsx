"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { ActivityFeed } from "@/components/admin/ActivityFeed";
import { BeforeAfterComparison } from "@/components/shared/BeforeAfterComparison";
import { GenerateTransformationPdfButton } from "@/components/shared/GenerateTransformationPdfButton";
import { ProgressAppointmentsSection } from "@/components/shared/ProgressAppointmentsSection";
import { ProgressMeasurementsSection } from "@/components/shared/ProgressMeasurementsSection";
import { ProgressNutritionSection } from "@/components/shared/ProgressNutritionSection";
import { ProgressPhotosSection } from "@/components/shared/ProgressPhotosSection";
import { ProgressSummaryCards } from "@/components/shared/ProgressSummaryCards";
import { ProgressWeightSection } from "@/components/shared/ProgressWeightSection";
import { ProgressWorkoutSection } from "@/components/shared/ProgressWorkoutSection";
import { useProgressPhotosGallery } from "@/hooks/useProgressPhotosGallery";
import { useSupabaseStudentDetail } from "@/hooks/useSupabaseStudentDetail";
import { useSupabaseStudentProgress } from "@/hooks/useSupabaseStudentProgress";
import { fullName } from "@/lib/admin";
import { buildTransformationRecapInput } from "@/lib/pdf/transformation-recap";

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
  const gallery = useProgressPhotosGallery(params.studentId, "coach");
  const [coachComment, setCoachComment] = useState("");
  const [nextObjective, setNextObjective] = useState("");

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
  const activePhotos = gallery.photos.filter((p) => (p.status ?? "active") === "active");
  const latestPhoto = activePhotos.slice().sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
  const beforePhoto = activePhotos.find((p) => p.isBeforeCandidate) ?? null;
  const afterPhoto = activePhotos.find((p) => p.isAfterCandidate) ?? null;

  const pdfInput =
    summary && beforePhoto && afterPhoto
      ? buildTransformationRecapInput(
          {
            firstName: summary.firstName,
            lastName: summary.lastName,
            mainGoal: summary.goal,
            startWeightKg: summary.startWeightKg,
            currentWeightKg: summary.currentWeightKg,
            sessionsCompleted: summary.sessionsCompleted,
            nutrition: nutrition
              ? {
                  hasActivePlan: nutrition.hasActivePlan,
                  averageCalories: nutrition.averageCalories,
                  targetCaloriesPerDay: nutrition.targetCaloriesPerDay,
                }
              : null,
          },
          { url: beforePhoto.imageUrl ?? "", date: beforePhoto.date, weightKg: beforePhoto.weightKg },
          { url: afterPhoto.imageUrl ?? "", date: afterPhoto.date, weightKg: afterPhoto.weightKg },
          { coachComment: coachComment.trim() || null, nextObjective: nextObjective.trim() || null },
        )
      : null;

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

      <Section title="Photos de progression">
        {!gallery.loading && (
          <p className="mb-4 text-xs text-muted-foreground">
            {activePhotos.length} photo{activePhotos.length > 1 ? "s" : ""}
            {latestPhoto ? ` · dernière photo le ${new Date(latestPhoto.date).toLocaleDateString("fr-FR")}` : ""}
          </p>
        )}
        <ProgressPhotosSection gallery={gallery} defaultWeightKg={detail.student.currentWeightKg ?? null} />
      </Section>

      <Section title="Comparaison avant / après — export PDF">
        {beforePhoto && afterPhoto ? (
          <div className="flex flex-col gap-5">
            <BeforeAfterComparison before={beforePhoto} after={afterPhoto} coachComment={coachComment.trim() || null} />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="coach-comment" className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Commentaire du coach (optionnel, inclus dans le PDF)
                </label>
                <textarea
                  id="coach-comment"
                  value={coachComment}
                  onChange={(event) => setCoachComment(event.target.value)}
                  rows={3}
                  className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                  placeholder="Ex : très belle progression, continue comme ça sur les prochaines semaines."
                />
              </div>
              <div>
                <label htmlFor="next-objective" className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Prochain objectif (optionnel, inclus dans le PDF)
                </label>
                <textarea
                  id="next-objective"
                  value={nextObjective}
                  onChange={(event) => setNextObjective(event.target.value)}
                  rows={3}
                  className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
                  placeholder="Ex : viser -2 kg d'ici la prochaine évaluation."
                />
              </div>
            </div>
            <GenerateTransformationPdfButton input={pdfInput} fileName={`transformation-${fullName(detail.student)}.pdf`} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Sélectionne une photo « avant » et une photo « après » dans la galerie ci-dessus pour générer la comparaison et le PDF de
            transformation.
          </p>
        )}
      </Section>
    </div>
  );
}
