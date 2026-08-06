"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { NutritionPlanV2Builder } from "@/components/admin/NutritionPlanV2Builder";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useGuardedNutritionAssignment } from "@/hooks/useGuardedNutritionAssignment";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { createBlankFormState, toSaveInput, type PlanV2FormState } from "@/lib/nutrition/plan-v2-form";
import {
  createBlankWeek,
  toWeekSavePayload,
  type WeekFormState,
} from "@/lib/nutrition/plan-v2-week-form";
import { DEFAULT_PROFILE_KEY } from "@/lib/nutrition/plan-v2-validation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { STATUS_APP_TO_DB } from "@/lib/supabase/nutrition";
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

export default function NewNutritionPlanPage() {
  const router = useRouter();
  const { state, setAssignment } = useAdminData();
  // PR C — le modèle v1 n'existe plus : il n'y a qu'un seul parcours de
  // création, et donc plus aucun choix à faire.
  const [weekState, setWeekState] = useState<WeekFormState>(() =>
    createBlankWeek(DEFAULT_PROFILE_KEY, 2200),
  );
  const [createdId] = useState<string | null>(null);
  const [saveError] = useState<string | null>(null);

  // Le formulaire est prêt dès l'ouverture : il n'y a plus d'étape de choix
  // qui l'initialisait au clic.
  const [formState, setFormState] = useState<PlanV2FormState | null>(() =>
    createBlankFormState({
      name: "",
      description: "",
      goalType: "maintien",
      status: "brouillon",
      coachNotes: "",
      hydrationTip: "",
    }),
  );
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
    // La semaine part dans la MÊME transaction que le plan et les profils :
    // sept jours, leur profil, et les repas prescrits.
    const semaine = toWeekSavePayload(weekState, {
      proteinBp: input.proteinBp,
      carbBp: input.carbBp,
      fatBp: input.fatBp,
      slots: input.slots,
    });
    const resultat = await saveNutritionPlanV2(supabase, {
      ...input,
      planId: null,
      status: statutBase,
      week: semaine,
    });
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
          {true
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
      {formState && !createdPlan && (
        <NutritionPlanV2Builder
          state={formState}
          onChange={setFormState}
          onSave={handleCreateV2}
          saving={savingV2}
          serverError={v2Error}
          week={weekState}
          onWeekChange={setWeekState}
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
      ) : null}
    </div>
  );
}
