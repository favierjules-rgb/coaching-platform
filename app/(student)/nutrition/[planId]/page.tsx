import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShoppingCart } from "lucide-react";

import { NutritionPlanWorkspace } from "@/components/student/NutritionPlanWorkspace";
import { StatusBadge } from "@/components/student/StatusBadge";
import { nutritionGoalLabels } from "@/lib/nutrition";
import { getNutritionPlan, nutritionPlans, student } from "@/data/student";

export function generateStaticParams() {
  return nutritionPlans.map((plan) => ({ planId: plan.id }));
}

export default async function NutritionPlanDetailPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  const plan = getNutritionPlan(planId);

  if (!plan) {
    notFound();
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
