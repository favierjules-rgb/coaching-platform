"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, ShoppingCart } from "lucide-react";

import { NutritionPlanWorkspace } from "@/components/student/NutritionPlanWorkspace";
import { StatusBadge } from "@/components/student/StatusBadge";
import { nutritionGoalLabels } from "@/lib/nutrition";
import { getNutritionPlan, student } from "@/data/student";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";

export default function NutritionPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const supabaseNutrition = useSupabaseNutritionForStudent();

  if (!supabaseNutrition.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseNutrition.active) {
    const plan = supabaseNutrition.plans.find((p) => p.id === params.planId);

    if (!plan) {
      return (
        <div>
          <Link
            href="/nutrition"
            className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={14} />
            Mes plans alimentaires
          </Link>
          <p className="text-sm text-muted-foreground">Plan introuvable.</p>
        </div>
      );
    }

    return (
      <div>
        <Link
          href="/nutrition"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes plans alimentaires
        </Link>

        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              {plan.name}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{nutritionGoalLabels[plan.goalType]}</p>
          </div>
          <StatusBadge status={plan.status} />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{plan.caloriesPerDay}</div>
            <div className="text-xs text-muted-foreground">kcal / jour</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{plan.protein}g</div>
            <div className="text-xs text-muted-foreground">Protéines</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{plan.carbs}g</div>
            <div className="text-xs text-muted-foreground">Glucides</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">{plan.fat}g</div>
            <div className="text-xs text-muted-foreground">Lipides</div>
          </div>
          <div className="border border-border bg-card p-5">
            <div className="font-heading text-xl font-bold text-foreground">
              {plan.weeklyTargetCalories.toLocaleString("fr-FR")}
            </div>
            <div className="text-xs text-muted-foreground">kcal / semaine</div>
          </div>
        </div>

        {plan.coachNotes && (
          <div className="mb-8 border border-border bg-card p-6">
            <h2 className="mb-2 font-heading text-lg font-bold uppercase text-foreground">Consignes du coach</h2>
            <p className="text-sm leading-relaxed text-foreground">{plan.coachNotes}</p>
          </div>
        )}

        <div className="mb-8">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">Semaine alimentaire</h2>
          {plan.days.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun jour planifié pour le moment.</p>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {plan.days.map((day) => (
                <div key={day.id} className="border border-border bg-card p-4">
                  <span className="mb-3 block text-xs font-bold uppercase tracking-widest text-primary">
                    {day.day}
                  </span>
                  {day.meals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun repas planifié.</p>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {day.meals.map((meal) => (
                        <li key={meal.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {meal.slot}
                              {meal.name && ` — ${meal.name}`}
                            </span>
                            <span className="text-xs text-muted-foreground">{meal.calories} kcal</span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            <span>{meal.protein}g prot.</span>
                            <span>{meal.carbs}g gluc.</span>
                            <span>{meal.fat}g lip.</span>
                          </div>
                          {meal.items.length > 0 && (
                            <ul className="mt-2 flex flex-col gap-0.5 text-xs text-muted-foreground">
                              {meal.items.map((item, i) => (
                                <li key={`${item.name}-${i}`}>
                                  {item.name}
                                  {item.quantity && ` — ${item.quantity}`}
                                </li>
                              ))}
                            </ul>
                          )}
                          {meal.coachNotes && (
                            <p className="mt-2 text-xs italic text-muted-foreground">{meal.coachNotes}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {plan.shoppingList.length > 0 && (
          <div className="border border-border bg-card p-6">
            <div className="mb-4 flex items-center gap-3">
              <ShoppingCart size={18} className="text-primary" />
              <h2 className="font-heading text-lg font-bold uppercase text-foreground">Liste de courses</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {plan.shoppingList.map((item) => (
                <span key={item} className="border border-border px-3 py-1 text-xs text-muted-foreground">
                  {item}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  const plan = getNutritionPlan(params.planId);

  if (!plan) {
    return (
      <div>
        <Link
          href="/nutrition"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Mes plans alimentaires
        </Link>
        <p className="text-sm text-muted-foreground">Plan introuvable.</p>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/nutrition"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Mes plans alimentaires
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {plan.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {nutritionGoalLabels[plan.goalType]}
          </p>
        </div>
        <StatusBadge status={plan.status} />
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {plan.dailyTarget.calories}
          </div>
          <div className="text-xs text-muted-foreground">kcal / jour</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {plan.dailyTarget.protein}g
          </div>
          <div className="text-xs text-muted-foreground">Protéines</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {plan.dailyTarget.carbs}g
          </div>
          <div className="text-xs text-muted-foreground">Glucides</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {plan.dailyTarget.fat}g
          </div>
          <div className="text-xs text-muted-foreground">Lipides</div>
        </div>
        <div className="border border-border bg-card p-5">
          <div className="font-heading text-xl font-bold text-foreground">
            {plan.weeklyTargetCalories.toLocaleString("fr-FR")}
          </div>
          <div className="text-xs text-muted-foreground">kcal / semaine</div>
        </div>
      </div>

      <div className="mb-8">
        <NutritionPlanWorkspace studentId={student.id} plan={plan} />
      </div>

      <div className="border border-border bg-card p-6">
        <div className="mb-4 flex items-center gap-3">
          <ShoppingCart size={18} className="text-primary" />
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Liste de courses
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan.shoppingList.map((item) => (
            <span
              key={item}
              className="border border-border px-3 py-1 text-xs text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
