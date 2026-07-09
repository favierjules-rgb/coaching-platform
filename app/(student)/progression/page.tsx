"use client";

import { TrendingUp } from "lucide-react";

import { ProgressAppointmentsSection } from "@/components/shared/ProgressAppointmentsSection";
import { ProgressNutritionSection } from "@/components/shared/ProgressNutritionSection";
import { ProgressSummaryCards } from "@/components/shared/ProgressSummaryCards";
import { ProgressWeightSection } from "@/components/shared/ProgressWeightSection";
import { ProgressWorkoutSection } from "@/components/shared/ProgressWorkoutSection";
import { useSupabaseMyProgress } from "@/hooks/useSupabaseMyProgress";
import { formatDate } from "@/lib/admin";

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

  const { summary, weight, workout, nutrition, appointments, photos } = progress;

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

      {photos.filter((p) => p.imageUrl).length > 0 && (
        <Section title="Mes photos">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {photos
              .filter((p) => p.imageUrl)
              .map((photo) => (
                <figure key={photo.id} className="border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.imageUrl ?? undefined} alt={`Photo de progression du ${formatDate(photo.date)}`} className="aspect-square w-full object-cover" />
                  <figcaption className="p-2 text-[11px] text-muted-foreground">{formatDate(photo.date)}</figcaption>
                </figure>
              ))}
          </div>
        </Section>
      )}
    </div>
  );
}
