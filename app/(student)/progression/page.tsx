"use client";

import { TrendingUp } from "lucide-react";

import { BeforeAfterComparison } from "@/components/shared/BeforeAfterComparison";
import { GenerateTransformationPdfButton } from "@/components/shared/GenerateTransformationPdfButton";
import { ProgressAppointmentsSection } from "@/components/shared/ProgressAppointmentsSection";
import { ProgressNutritionSection } from "@/components/shared/ProgressNutritionSection";
import { ProgressPhotosSection } from "@/components/shared/ProgressPhotosSection";
import { ProgressSummaryCards } from "@/components/shared/ProgressSummaryCards";
import { ProgressWeightSection } from "@/components/shared/ProgressWeightSection";
import { ProgressWorkoutSection } from "@/components/shared/ProgressWorkoutSection";
import { useProgressPhotosGallery } from "@/hooks/useProgressPhotosGallery";
import { useSupabaseMyProgress } from "@/hooks/useSupabaseMyProgress";
import { buildTransformationRecapInput } from "@/lib/pdf/transformation-recap";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 border border-border bg-card p-6">
      <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">{title}</h2>
      {children}
    </section>
  );
}

export default function StudentProgressionPage() {
  const progress = useSupabaseMyProgress();
  const gallery = useProgressPhotosGallery(progress.studentId, "student");

  if (!progress.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!progress.active) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Progression</h1>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 border border-dashed border-border py-20 text-center">
          <TrendingUp size={28} className="text-muted-foreground" aria-hidden="true" />
          <p className="font-heading text-lg font-bold uppercase text-foreground">Progression non disponible</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Ce compte n&apos;est pas encore relié à une fiche élève. Contacte ton coach pour finaliser ton accès.
          </p>
        </div>
      </div>
    );
  }

  const { summary, weight, workout, nutrition, appointments } = progress;
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
        )
      : null;

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">Ma progression</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ton évolution basée sur tes vraies données.</p>
      </div>

      {summary && (
        <Section title="Résumé">
          <ProgressSummaryCards summary={summary} />
        </Section>
      )}

      <Section title="Évolution du poids">{weight && <ProgressWeightSection weight={weight} />}</Section>

      <Section title="Entraînement">{workout && <ProgressWorkoutSection workout={workout} showRecentFeedback={false} />}</Section>

      <Section title="Suivi nutrition (semaine)">{nutrition && <ProgressNutritionSection nutrition={nutrition} />}</Section>

      <Section title="Rendez-vous">{appointments && <ProgressAppointmentsSection appointments={appointments} />}</Section>

      <Section title="Photos de progression">
        {!gallery.loading && (
          <p className="mb-4 text-xs text-muted-foreground">
            {activePhotos.length} photo{activePhotos.length > 1 ? "s" : ""}
            {latestPhoto ? ` · dernière photo le ${new Date(latestPhoto.date).toLocaleDateString("fr-FR")}` : ""}
          </p>
        )}
        <ProgressPhotosSection gallery={gallery} defaultWeightKg={summary?.currentWeightKg ?? null} />
      </Section>

      <Section title="Comparaison avant / après">
        {beforePhoto && afterPhoto ? (
          <div className="flex flex-col gap-4">
            <BeforeAfterComparison before={beforePhoto} after={afterPhoto} />
            <GenerateTransformationPdfButton input={pdfInput} fileName={`transformation-${summary?.lastName || "eleve"}.pdf`} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Choisis une photo « avant » et une photo « après » dans ta galerie ci-dessus pour générer ta comparaison et ton PDF de
            transformation.
          </p>
        )}
      </Section>
    </div>
  );
}
