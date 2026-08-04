"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, SlidersHorizontal, UtensilsCrossed } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { NutritionPlanBuilder, type NutritionPlanBuilderData } from "@/components/admin/NutritionPlanBuilder";
import { NutritionPlanV2Builder } from "@/components/admin/NutritionPlanV2Builder";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useGuardedNutritionAssignment } from "@/hooks/useGuardedNutritionAssignment";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { createBlankFormState, toSaveInput, type PlanV2FormState } from "@/lib/nutrition/plan-v2-form";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { STATUS_APP_TO_DB, createNutritionPlan as createNutritionPlanSupabase } from "@/lib/supabase/nutrition";
import { saveNutritionPlanV2 } from "@/lib/supabase/nutrition-v2";
import type { AdminContentStatus } from "@/types";

/**
 * Création d'un plan alimentaire — DEUX MODES EXPLICITES.
 *
 *   « Plan classique »            → constructeur v1, strictement inchangé.
 *   « Plan avec répartition avancée » → constructeur v2, sans plan
 *                                   intermédiaire d'aucune sorte.
 *
 * Le mode classique n'est jamais remplacé silencieusement : le coach choisit.
 *
 * MODE AVANCÉ — invariant central : tant que le coach n'a pas cliqué sur
 * Enregistrer, AUCUNE ligne n'existe en base. Le formulaire vit avec
 * `planId: null` ; la première écriture est un appel UNIQUE à
 * `save_nutrition_plan_v2`, qui crée le plan, le profil `default` et les six
 * créneaux dans la même transaction. Ni `createNutritionPlan` ni
 * `updateNutritionPlan` ne sont appelées sur ce chemin.
 */

type Mode = "choix" | "classique" | "avance";

export default function NewNutritionPlanPage() {
  const router = useRouter();
  const { state, createNutritionPlan, setAssignment } = useAdminData();
  const [mode, setMode] = useState<Mode>("choix");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  const [formState, setFormState] = useState<PlanV2FormState | null>(null);
  const [savingV2, setSavingV2] = useState(false);
  const [v2Error, setV2Error] = useState<string | null>(null);

  const supabaseActive = isSupabaseConfigured();
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const baseSetAssignment = useContentAssignment(
    { nutrition: supabaseActive },
    setAssignment,
    supabaseNutritionPlans.refetch,
  );
  const plans = supabaseActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const versionsById = useMemo(
    () => Object.fromEntries(plans.map((p) => [p.id, p.nutritionModelVersion])),
    [plans],
  );
  const guarded = useGuardedNutritionAssignment(baseSetAssignment, versionsById);

  /** Chemin v1, INCHANGÉ. */
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

  /**
   * Première et unique écriture du mode avancé. `planId` vaut `null` : c'est
   * la RPC qui crée le plan. En cas d'échec, toutes les valeurs locales sont
   * conservées et aucune ligne partielle n'est laissée (la transaction de la
   * RPC est annulée en bloc).
   */
  async function handleCreateV2() {
    if (!formState) return;
    setSavingV2(true);
    setV2Error(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setV2Error("Supabase n'est pas configuré : impossible de créer ce plan.");
      setSavingV2(false);
      return;
    }
    const input = toSaveInput(formState);
    const statutBase =
      STATUS_APP_TO_DB[input.status as AdminContentStatus] ?? STATUS_APP_TO_DB.brouillon;
    const resultat = await saveNutritionPlanV2(supabase, { ...input, planId: null, status: statutBase });
    if (!resultat.ok) {
      setV2Error(resultat.message);
      setSavingV2(false);
      return;
    }
    await supabaseNutritionPlans.refetch();
    setSavingV2(false);
    // Succès : on rejoint l'URL canonique du plan réellement créé.
    router.push(`/admin/nutrition/${resultat.plan.id}`);
  }

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
          {mode === "avance"
            ? "Répartition avancée : calories, macronutriments et parts par repas."
            : "Construis la semaine type, repas par repas."}
        </p>
      </div>

      {saveError && (
        <p className="mb-6 flex items-center gap-2 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          Échec de l&apos;enregistrement du plan. Réessaie.
        </p>
      )}

      {guarded.refusal && (
        <p className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {guarded.refusal}
        </p>
      )}

      {/* ── Choix du format, jamais implicite ─────────────────────────── */}
      {mode === "choix" && !createdPlan && (
        <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setMode("classique")}
            className="pressable flex min-h-[44px] flex-col items-start gap-2 rounded-card border border-border bg-card p-6 text-left shadow-soft transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <UtensilsCrossed size={20} className="text-muted-foreground" />
            <span className="font-heading text-lg font-bold uppercase text-foreground">Plan classique</span>
            <span className="text-sm text-muted-foreground">
              Construis la semaine type, jour par jour et repas par repas. Format historique, inchangé.
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setFormState(
                createBlankFormState({
                  name: "",
                  description: "",
                  goalType: "maintien",
                  status: "brouillon",
                  coachNotes: "",
                  hydrationTip: "",
                }),
              );
              setMode("avance");
            }}
            className="pressable flex min-h-[44px] flex-col items-start gap-2 rounded-card border border-primary bg-card p-6 text-left shadow-soft transition-colors hover:border-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <SlidersHorizontal size={20} className="text-primary" />
            <span className="font-heading text-lg font-bold uppercase text-foreground">
              Plan avec répartition avancée
            </span>
            <span className="text-sm text-muted-foreground">
              Définis les calories, les macronutriments et leur répartition entre les repas. Ce format
              sera compatible avec les recettes personnalisées.
            </span>
          </button>
        </div>
      )}

      {mode === "avance" && formState && !createdPlan && (
        <NutritionPlanV2Builder
          state={formState}
          onChange={setFormState}
          onSave={handleCreateV2}
          saving={savingV2}
          serverError={v2Error}
        />
      )}

      {createdPlan ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
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
              onSetAssignment={guarded.setAssignment}
              triggerLabel="Assigner à des élèves"
              triggerVariant="primary"
            />
            <button
              type="button"
              onClick={() => router.push(`/admin/nutrition/${createdPlan.id}`)}
              className="pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              Voir le plan
            </button>
          </div>
        </div>
      ) : mode === "classique" ? (
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
      ) : null}
    </div>
  );
}
