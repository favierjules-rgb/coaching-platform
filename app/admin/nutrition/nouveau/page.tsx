"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { NutritionPlanBuilder, type NutritionPlanBuilderData } from "@/components/admin/NutritionPlanBuilder";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createNutritionPlan as createNutritionPlanSupabase } from "@/lib/supabase/nutrition";

export default function NewNutritionPlanPage() {
  const router = useRouter();
  const { state, createNutritionPlan, setAssignment } = useAdminData();
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  // Dès que Supabase est configuré, la création doit produire une vraie
  // ligne nutrition_plans — jamais de repli mock silencieux (voir
  // /admin/nutrition). Si l'insertion réelle échoue, on affiche une erreur
  // plutôt que de créer un plan mock invisible qui masquerait le problème.
  const supabaseActive = isSupabaseConfigured();
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { nutrition: supabaseActive },
    setAssignment,
    supabaseNutritionPlans.refetch,
  );

  async function handleSave(data: NutritionPlanBuilderData) {
    setSaveError(false);
    if (supabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const id = await createNutritionPlanSupabase(supabase, data);
        if (id) {
          await supabaseNutritionPlans.refetch();
          setCreatedId(id);
          return;
        }
        setSaveError(true);
        return;
      }
    }
    const id = createNutritionPlan({
      ...data,
      assignedStudentIds: [],
      days: data.days.map((d) => ({ ...d, planId: "" })),
    });
    setCreatedId(id);
  }

  const plans = supabaseActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const createdPlan = createdId ? plans.find((p) => p.id === createdId) : null;

  return (
    <div>
      <Link href="/admin/nutrition" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Nutrition
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Créer un plan alimentaire
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Construis la semaine type, repas par repas.
        </p>
      </div>

      {saveError && (
        <p className="mb-6 flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          Échec de l&apos;enregistrement du plan. Réessaie.
        </p>
      )}

      {createdPlan ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
            <CheckCircle size={18} className="flex-shrink-0" />
            Plan &quot;{createdPlan.name}&quot; enregistré.
          </div>
          <div className="flex flex-wrap gap-3">
            <AssignStudentsModal
              contentLabel={createdPlan.name}
              contentType="nutrition"
              contentId={createdPlan.id}
              students={students}
              assignedStudentIds={createdPlan.assignedStudentIds}
              onSetAssignment={handleSetAssignment}
              triggerLabel="Assigner à des élèves"
              triggerVariant="primary"
            />
            <button
              type="button"
              onClick={() => router.push(`/admin/nutrition/${createdPlan.id}`)}
              className="border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
            >
              Voir le plan
            </button>
          </div>
        </div>
      ) : (
        <NutritionPlanBuilder
          initial={{
            name: "",
            goalType: "maintien",
            caloriesPerDay: 2200,
            protein: 150,
            carbs: 220,
            fat: 70,
            weeklyTargetCalories: 15400,
            status: "brouillon",
            coachNotes: "",
            hydrationTip: "",
            supplements: [],
            shoppingList: [],
            days: [],
          }}
          onSave={handleSave}
          saveLabel="Enregistrer le plan"
        />
      )}
    </div>
  );
}
