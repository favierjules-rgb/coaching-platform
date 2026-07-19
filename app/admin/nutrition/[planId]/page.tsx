"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Archive, Pencil } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { NutritionPlanBuilder, type NutritionPlanBuilderData } from "@/components/admin/NutritionPlanBuilder";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, fullName } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  updateNutritionPlan as updateNutritionPlanSupabase,
  updateNutritionPlanStatus as updateNutritionPlanStatusSupabase,
} from "@/lib/supabase/nutrition";

const goalLabels: Record<string, string> = {
  "perte-de-poids": "Perte de poids",
  maintien: "Maintien",
  "prise-de-masse": "Prise de masse",
  performance: "Performance",
};

export default function NutritionPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const { state, updateNutritionPlan, setAssignment } = useAdminData();
  const [editing, setEditing] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // Dès que Supabase est configuré, cette page ne lit/écrit QUE
  // nutrition_plans réel — jamais de repli mock une fois actif (voir
  // /admin/nutrition). isSupabasePlansActive garde ce nom pour la lecture
  // du diff mais reflète maintenant "Supabase configuré", pas "≥1 plan réel".
  const isSupabasePlansActive = isSupabaseConfigured();
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const plans = isSupabasePlansActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const supabaseStudents = useSupabaseStudents();
  const students = isSupabasePlansActive ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { nutrition: isSupabasePlansActive },
    setAssignment,
    supabaseNutritionPlans.refetch,
  );

  if (isSupabasePlansActive && supabaseNutritionPlans.loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const plan = plans.find((p) => p.id === params.planId);

  if (!plan) {
    return (
      <div>
        <Link href="/admin/nutrition" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          <ArrowLeft size={14} />
          Nutrition
        </Link>
        <p className="text-sm text-muted-foreground">Plan introuvable.</p>
      </div>
    );
  }

  const assignedStudents = students.filter((s) => plan.assignedStudentIds.includes(s.id));

  async function handleSave(data: NutritionPlanBuilderData) {
    setSaveError(false);
    if (isSupabasePlansActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const ok = await updateNutritionPlanSupabase(supabase, plan!.id, data);
        if (!ok) {
          setSaveError(true);
          return;
        }
        await supabaseNutritionPlans.refetch();
        setEditing(false);
        return;
      }
    }
    updateNutritionPlan(plan!.id, { ...data, days: data.days.map((d) => ({ ...d, planId: plan!.id })) });
    setEditing(false);
  }

  async function handleArchive() {
    setSaveError(false);
    if (isSupabasePlansActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const ok = await updateNutritionPlanStatusSupabase(supabase, plan!.id, "archivé");
        if (!ok) {
          setSaveError(true);
          return;
        }
        await supabaseNutritionPlans.refetch();
        return;
      }
    }
    updateNutritionPlan(plan!.id, { status: "archivé" });
  }

  return (
    <div>
      <Link href="/admin/nutrition" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Nutrition
      </Link>

      {saveError && (
        <p className="mb-6 flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Échec de l&apos;enregistrement. Réessaie.
        </p>
      )}

      {editing ? (
        <>
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              Modifier — {plan.name}
            </h1>
          </div>
          <NutritionPlanBuilder
            initial={{
              name: plan.name,
              goalType: plan.goalType,
              caloriesPerDay: plan.caloriesPerDay,
              protein: plan.protein,
              carbs: plan.carbs,
              fat: plan.fat,
              weeklyTargetCalories: plan.weeklyTargetCalories,
              status: plan.status,
              coachNotes: plan.coachNotes,
              hydrationTip: plan.hydrationTip,
              supplements: plan.supplements,
              shoppingList: plan.shoppingList,
              days: plan.days,
            }}
            onSave={handleSave}
            saveLabel="Enregistrer les modifications"
          />
        </>
      ) : (
        <>
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex items-center gap-3">
                <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
                  {plan.name}
                </h1>
                <StatusBadge label={contentStatusLabels[plan.status]} tone={contentStatusTone(plan.status)} />
              </div>
              <p className="text-sm text-muted-foreground">{goalLabels[plan.goalType]}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                <Pencil size={13} />
                Modifier
              </button>
              <AssignStudentsModal
                contentLabel={plan.name}
                contentType="nutrition"
                contentId={plan.id}
                students={students}
                assignedStudentIds={plan.assignedStudentIds}
                onSetAssignment={handleSetAssignment}
                triggerLabel="Assigner à des élèves"
              />
              <button
                type="button"
                onClick={handleArchive}
                className="flex items-center gap-1.5 border border-red-500/50 px-4 py-2 text-xs uppercase tracking-widest text-red-400 transition-colors hover:bg-red-500/10"
              >
                <Archive size={13} />
                Archiver
              </button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="border border-border bg-card p-5">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">Kcal / jour</span>
              <span className="font-heading text-2xl font-bold text-foreground">{plan.caloriesPerDay}</span>
            </div>
            <div className="border border-border bg-card p-5">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">Protéines</span>
              <span className="font-heading text-2xl font-bold text-foreground">{plan.protein}g</span>
            </div>
            <div className="border border-border bg-card p-5">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">Glucides</span>
              <span className="font-heading text-2xl font-bold text-foreground">{plan.carbs}g</span>
            </div>
            <div className="border border-border bg-card p-5">
              <span className="block text-xs uppercase tracking-wide text-muted-foreground">Lipides</span>
              <span className="font-heading text-2xl font-bold text-foreground">{plan.fat}g</span>
            </div>
          </div>

          <div className="mb-6 border border-border bg-card p-6">
            <h2 className="mb-2 font-heading text-lg font-bold uppercase text-foreground">
              Objectif hebdomadaire
            </h2>
            <p className="text-sm text-muted-foreground">
              {plan.weeklyTargetCalories.toLocaleString("fr-FR")} kcal/semaine — compatible avec la logique élève
              (validation journée, calories restantes, ajustement sur les jours restants).
            </p>
            {plan.coachNotes && <p className="mt-2 text-sm text-foreground">{plan.coachNotes}</p>}
          </div>

          <div className="mb-6 border border-border bg-card p-6">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Semaine alimentaire
            </h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {plan.days.map((day) => (
                <div key={day.id} className="border border-border p-4">
                  <span className="mb-2 block text-xs font-bold uppercase tracking-widest text-primary">
                    {day.day}
                  </span>
                  {day.meals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Aucun repas planifié.</p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {day.meals.map((meal) => (
                        <li key={meal.id} className="text-sm text-muted-foreground">
                          <span className="text-foreground">{meal.slot}</span> — {meal.name || "(sans nom)"} ·{" "}
                          {meal.calories} kcal
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="border border-border bg-card p-6">
            <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
              Élèves assignés
            </h2>
            {assignedStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Aucun élève assigné.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {assignedStudents.map((s) => (
                  <Link
                    key={s.id}
                    href={`/admin/eleves/${s.id}`}
                    className="border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary"
                  >
                    {fullName(s)}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
