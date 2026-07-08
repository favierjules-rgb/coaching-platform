"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, UtensilsCrossed } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, matchesTextSearch } from "@/lib/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { AdminContentStatus } from "@/types";

type StatusFilter = "tous" | AdminContentStatus;

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: "tous", label: "Tous" },
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

const goalLabels: Record<string, string> = {
  "perte-de-poids": "Perte de poids",
  maintien: "Maintien",
  "prise-de-masse": "Prise de masse",
  performance: "Performance",
};

export default function AdminNutritionPlansPage() {
  const { state, setAssignment } = useAdminData();

  // Dès que Supabase est configuré, /admin/nutrition n'affiche QUE les vrais
  // plans nutrition_plans — jamais de mélange avec les plans mock/localStorage,
  // même si nutrition_plans est vide (état vide plutôt que démo). Le repli
  // mock complet ne s'applique que si Supabase n'est pas configuré du tout
  // (environnement de démo sans backend).
  const supabaseActive = isSupabaseConfigured();
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const nutritionPlans = supabaseActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { nutrition: supabaseActive },
    setAssignment,
    supabaseNutritionPlans.refetch,
  );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");

  if (supabaseActive && supabaseNutritionPlans.loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const filtered = nutritionPlans.filter(
    (p) => matchesTextSearch([p.name, goalLabels[p.goalType]], query) && (statusFilter === "tous" || p.status === statusFilter),
  );

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Nutrition
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{nutritionPlans.length} plans alimentaires créés.</p>
        </div>
        <Link
          href="/admin/nutrition/nouveau"
          className="flex items-center gap-2 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
        >
          <Plus size={14} />
          Créer plan alimentaire
        </Link>
      </div>

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un plan..." />
        <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
      </div>

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <UtensilsCrossed size={16} />
          Aucun plan ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {filtered.map((plan) => (
            <div key={plan.id} className="flex flex-col gap-4 border border-border bg-card p-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold uppercase text-foreground">{plan.name}</h2>
                  <p className="text-sm text-muted-foreground">{goalLabels[plan.goalType]}</p>
                </div>
                <StatusBadge label={contentStatusLabels[plan.status]} tone={contentStatusTone(plan.status)} />
              </div>
              <div className="grid grid-cols-4 gap-3 text-sm text-foreground">
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
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                  Objectif hebdomadaire
                </span>
                <span className="text-sm text-foreground">{plan.weeklyTargetCalories.toLocaleString("fr-FR")} kcal/semaine</span>
              </div>
              <div>
                <span className="block text-xs uppercase tracking-wide text-muted-foreground">
                  Élèves assignés ({plan.assignedStudentIds.length})
                </span>
                <span className="text-sm text-muted-foreground">
                  {plan.assignedStudentIds.length === 0
                    ? "Aucun"
                    : students
                        .filter((s) => plan.assignedStudentIds.includes(s.id))
                        .map((s) => `${s.firstName} ${s.lastName}`)
                        .join(", ")}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/admin/nutrition/${plan.id}`}
                  className="border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  Voir
                </Link>
                <Link
                  href={`/admin/nutrition/${plan.id}`}
                  className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  Modifier
                </Link>
                <AssignStudentsModal
                  contentLabel={plan.name}
                  contentType="nutrition"
                  contentId={plan.id}
                  students={students}
                  assignedStudentIds={plan.assignedStudentIds}
                  onSetAssignment={handleSetAssignment}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
