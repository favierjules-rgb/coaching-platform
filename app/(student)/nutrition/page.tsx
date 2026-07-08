"use client";

import Link from "next/link";
import { Droplet, Lightbulb, Pill } from "lucide-react";

import { StatusBadge } from "@/components/student/StatusBadge";
import { NutritionPlansListClient } from "@/components/student/NutritionPlansListClient";
import { NutritionWeekStatusClient } from "@/components/student/NutritionWeekStatusClient";
import { WeeklyNutritionTracker } from "@/components/student/WeeklyNutritionTracker";
import {
  activeNutritionPlan,
  hydrationAndSupplements,
  nutritionPlans,
  student,
} from "@/data/student";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";

/**
 * Priorité Supabase dès qu'un compte élève réel est identifié (même
 * principe que /entrainement) : les plans alimentaires réellement assignés
 * (nutrition_plans.student_id, voir lib/supabase/nutrition.ts) remplacent
 * alors entièrement data/student.ts, y compris pour afficher "Aucun plan
 * alimentaire attribué" plutôt qu'un plan mock qui ferait croire à un vrai
 * suivi. Le suivi jour par jour (validation, ajustement calorique) reste
 * hors périmètre pour un plan réel — lecture seule.
 */
export default function NutritionPage() {
  const supabaseNutrition = useSupabaseNutritionForStudent();

  if (!supabaseNutrition.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseNutrition.active) {
    const { plans, activePlan, studentId } = supabaseNutrition;

    if (!activePlan) {
      return (
        <div>
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              Nutrition
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Aucun plan alimentaire attribué pour le moment. Contacte ton coach.
          </p>
        </div>
      );
    }

    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Nutrition
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan actif : {activePlan.name} · {activePlan.caloriesPerDay} kcal/jour ·{" "}
            {activePlan.weeklyTargetCalories.toLocaleString("fr-FR")} kcal/semaine
          </p>
        </div>

        {studentId && (
          <WeeklyNutritionTracker
            studentId={studentId}
            planId={activePlan.id}
            target={{
              calories: activePlan.caloriesPerDay,
              protein: activePlan.protein,
              carbs: activePlan.carbs,
              fat: activePlan.fat,
              weeklyTargetCalories: activePlan.weeklyTargetCalories,
            }}
          />
        )}

        {(activePlan.hydrationTip || activePlan.supplements.length > 0) && (
          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {activePlan.hydrationTip && (
              <div className="flex flex-col gap-2 border border-border bg-card p-6">
                <Droplet size={20} className="mb-2 text-primary" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Conseil hydratation</span>
                <p className="text-sm leading-relaxed text-foreground">{activePlan.hydrationTip}</p>
              </div>
            )}
            {activePlan.supplements.length > 0 && (
              <div className="flex flex-col gap-2 border border-border bg-card p-6">
                <Pill size={20} className="mb-2 text-primary" />
                <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Compléments</span>
                <ul className="flex flex-col gap-1 text-sm text-foreground">
                  {activePlan.supplements.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activePlan.coachNotes && (
          <div className="mb-8 flex flex-col gap-2 border border-border bg-card p-6">
            <Lightbulb size={20} className="mb-2 text-primary" />
            <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Consignes du coach</span>
            <p className="text-sm leading-relaxed text-foreground">{activePlan.coachNotes}</p>
          </div>
        )}

        <div>
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Mes plans alimentaires
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.id} className="flex flex-col gap-4 border border-border bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-heading text-lg font-bold uppercase text-foreground">{plan.name}</h3>
                  <StatusBadge status={plan.status} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-sm text-foreground">
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Kcal</span>
                    {plan.caloriesPerDay}
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Prot</span>
                    {plan.protein}g
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Gluc</span>
                    {plan.carbs}g
                  </div>
                  <div>
                    <span className="block text-xs uppercase tracking-wide text-muted-foreground">Lip</span>
                    {plan.fat}g
                  </div>
                </div>
                <Link
                  href={`/nutrition/${plan.id}`}
                  className="mt-2 block border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  Voir le plan
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Nutrition
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan actif : {activeNutritionPlan.name} ·{" "}
          {activeNutritionPlan.dailyTarget.calories} kcal/jour ·{" "}
          {activeNutritionPlan.weeklyTargetCalories.toLocaleString("fr-FR")}{" "}
          kcal/semaine
        </p>
      </div>

      <NutritionWeekStatusClient
        studentId={student.id}
        activePlan={activeNutritionPlan}
      />

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Droplet size={20} className="mb-2 text-primary" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Hydratation
          </span>
          <span className="font-heading text-lg font-bold text-foreground">
            {hydrationAndSupplements.waterTarget}
          </span>
        </div>
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Pill size={20} className="mb-2 text-primary" />
          <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Compléments
          </span>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {hydrationAndSupplements.supplements.map((supplement) => (
              <li key={supplement}>{supplement}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Lightbulb size={20} className="mb-2 text-primary" />
          <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Conseil du jour
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            {hydrationAndSupplements.tipOfTheDay}
          </p>
        </div>
      </div>

      <NutritionPlansListClient plans={nutritionPlans} />
    </div>
  );
}
