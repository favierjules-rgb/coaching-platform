"use client";

import { useCallback, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Archive, Pencil, SlidersHorizontal } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import { NutritionPlanV2Builder } from "@/components/admin/NutritionPlanV2Builder";
import { NutritionPlanV2ConversionDialog } from "@/components/admin/NutritionPlanV2ConversionDialog";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useGuardedNutritionAssignment } from "@/hooks/useGuardedNutritionAssignment";
import { useNutritionPlanV2 } from "@/hooks/useNutritionPlanV2";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, fullName } from "@/lib/admin";
import { prefillFromLegacyDailyTarget } from "@/lib/nutrition/plan-v2-conversion";
import {
  createFormStateFromCanonical,
  createFormStateFromPrefill,
  toSaveInput,
  type PlanV2FormState,
} from "@/lib/nutrition/plan-v2-form";
import {
  createWeekFormFromPlan,
  toWeekSavePayload,
  type WeekFormState,
} from "@/lib/nutrition/plan-v2-week-form";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readNutritionPlanV2Week } from "@/lib/supabase/nutrition-week";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  STATUS_APP_TO_DB,
  updateNutritionPlanStatus as updateNutritionPlanStatusSupabase,
} from "@/lib/supabase/nutrition";
import { saveNutritionPlanV2 } from "@/lib/supabase/nutrition-v2";
import type { AdminContentStatus } from "@/types";

const goalLabels: Record<string, string> = {
  "perte-de-poids": "Perte de poids",
  maintien: "Maintien",
  "prise-de-masse": "Prise de masse",
  performance: "Performance",
};

const CONVERSION_NOTICE_FR =
  "Conversion en cours : les objectifs quotidiens ont été repris du plan existant. La répartition entre les repas reste à compléter — rien n'est enregistré tant que tu n'as pas cliqué sur Enregistrer.";

export default function NutritionPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const { state, updateNutritionPlan, setAssignment } = useAdminData();
  const [saveError, setSaveError] = useState(false);

  // ── État propre au modèle v2 ──────────────────────────────────────────
  const [weekState, setWeekState] = useState<WeekFormState | null>(null);
  const [conversionDialogOpen, setConversionDialogOpen] = useState(false);
  const [conversionMode, setConversionMode] = useState(false);
  const [editingV2, setEditingV2] = useState(false);
  const [formState, setFormState] = useState<PlanV2FormState | null>(null);
  const [savingV2, setSavingV2] = useState(false);
  const [v2Error, setV2Error] = useState<string | null>(null);

  const isSupabasePlansActive = isSupabaseConfigured();
  const supabaseNutritionPlans = useSupabaseNutritionPlans();
  const plans = isSupabasePlansActive ? supabaseNutritionPlans.plans : state.nutritionPlans;
  const supabaseStudents = useSupabaseStudents();
  const students = isSupabasePlansActive ? supabaseStudents.students : state.students;
  const baseSetAssignment = useContentAssignment(
    { nutrition: isSupabasePlansActive },
    setAssignment,
    supabaseNutritionPlans.refetch,
  );

  const plan = plans.find((p) => p.id === params.planId);
  // PR C — le modèle v1 n'existe plus : la migration 20260811090000 a converti
  // tous les plans et la contrainte de base interdit désormais toute autre
  // valeur. Il n'y a donc plus rien à router : tout plan lisible est un v2.
  const isV2 = plan !== null;

  // Lecture CANONIQUE : uniquement pour un plan déjà v2. Un plan v1 n'est
  // jamais chargé par ce loader — donc jamais converti au chargement.
  const canonique = useNutritionPlanV2(
    params.planId,
    Boolean(isV2 && isSupabasePlansActive),
  );

  const versionsById = useMemo(
    () => Object.fromEntries(plans.map((p) => [p.id, p.nutritionModelVersion])),
    [plans],
  );
  const guarded = useGuardedNutritionAssignment(baseSetAssignment, versionsById);

  const metaFor = useCallback(
    (nom: string, objectif: string, statut: string, notes: string, hydratation: string) => ({
      planId: params.planId,
      name: nom,
      goalType: objectif,
      status: statut,
      coachNotes: notes,
      hydrationTip: hydratation,
    }),
    [params.planId],
  );

  if (isSupabasePlansActive && supabaseNutritionPlans.loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

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

  /** Chemin v1 INCHANGÉ : un plan v2 n'entre jamais ici (bouton non rendu). */

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

  /**
   * Ouvre le constructeur sur un plan DÉJÀ v2, à partir du modèle canonique
   * relu. Construction À LA DEMANDE, sur action explicite du coach : aucun
   * effet ne dérive d'état au chargement, donc aucune conversion implicite.
   */
  function ouvrirEditionV2() {
    if (!canonique.plan || !plan) return;
    setFormState(
      createFormStateFromCanonical(
        canonique.plan,
        metaFor(plan.name, plan.goalType, plan.status, plan.coachNotes, plan.hydrationTip),
      ),
    );
    setEditingV2(true);
    setV2Error(null);
    // La semaine est chargée À LA DEMANDE, au moment d'ouvrir l'éditeur :
    // aucun effet ne la charge au montage, donc aucune requête inutile sur la
    // fiche en lecture.
    void chargerSemaine();
  }

  /** Lecture de la semaine (sept jours + repas prescrits) pour l'éditeur. */
  async function chargerSemaine() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !params.planId) return;
    const semaine = await readNutritionPlanV2Week(supabase, params.planId);
    if (semaine) {
      setWeekState(createWeekFormFromPlan(semaine, canonique.plan?.profiles[0]?.profileKey ?? "default"));
    }
  }

  /** Ouvre le constructeur v2 en mode conversion. AUCUNE écriture ici. */
  function ouvrirConversion() {
    const prefill = prefillFromLegacyDailyTarget({
      calories: plan!.caloriesPerDay,
      protein: plan!.protein,
      carbs: plan!.carbs,
      fat: plan!.fat,
    });
    setFormState(
      createFormStateFromPrefill(
        prefill,
        metaFor(plan!.name, plan!.goalType, plan!.status, plan!.coachNotes, plan!.hydrationTip),
      ),
    );
    setConversionDialogOpen(false);
    setConversionMode(true);
    setV2Error(null);
  }

  /**
   * SEUL chemin d'écriture d'un plan v2 : la RPC. Aucune écriture directe
   * dans `nutrition_plan_profiles` ni `nutrition_meal_slot_targets`, et
   * `updateNutritionPlan` n'est jamais appelée ici.
   */
  async function handleSaveV2() {
    if (!formState) return;
    setSavingV2(true);
    setV2Error(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setV2Error("Supabase n'est pas configuré : impossible d'enregistrer ce plan.");
      setSavingV2(false);
      return;
    }
    const input = toSaveInput(formState);
    const statutBase =
      STATUS_APP_TO_DB[input.status as AdminContentStatus] ?? STATUS_APP_TO_DB.brouillon;
    const semaine = weekState
      ? toWeekSavePayload(weekState, {
          proteinBp: input.proteinBp,
          carbBp: input.carbBp,
          fatBp: input.fatBp,
          slots: input.slots,
        })
      : undefined;
    const resultat = await saveNutritionPlanV2(supabase, {
      ...input,
      status: statutBase,
      week: semaine,
    });
    if (!resultat.ok) {
      // Échec : l'éditeur reste ouvert et les valeurs locales sont conservées.
      setV2Error(resultat.message);
      setSavingV2(false);
      return;
    }
    // Succès : l'état local est remplacé par le RETOUR CANONIQUE de la RPC.
    setFormState(
      createFormStateFromCanonical(
        resultat.plan,
        metaFor(formState.name, formState.goalType, formState.status, formState.coachNotes, formState.hydrationTip),
      ),
    );
    setConversionMode(false);
    setEditingV2(false);
    setSavingV2(false);
    await supabaseNutritionPlans.refetch();
    await canonique.refetch();
  }

  const enConstructeurV2 = (conversionMode || (isV2 && editingV2)) && formState !== null;

  if (enConstructeurV2 && formState) {
    return (
      <div>
        <Link href="/admin/nutrition" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} />
          Nutrition
        </Link>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Répartition avancée — {plan.name}
          </h1>
        </div>
        <NutritionPlanV2Builder
          state={formState}
          onChange={setFormState}
          onSave={handleSaveV2}
          saving={savingV2}
          serverError={v2Error}
          conversionNotice={conversionMode ? CONVERSION_NOTICE_FR : null}
          week={weekState ?? undefined}
          onWeekChange={setWeekState}
        />
      </div>
    );
  }

  if (isV2 && canonique.loading) {
    return <p className="text-sm text-muted-foreground">Chargement de la répartition…</p>;
  }

  return (
    <div>
      <Link href="/admin/nutrition" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Nutrition
      </Link>

      {saveError && (
        <p className="mb-6 flex items-center gap-2 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          Échec de l&apos;enregistrement. Réessaie.
        </p>
      )}

      {guarded.refusal && (
        <p className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {guarded.refusal}
        </p>
      )}

      {conversionDialogOpen && (
        <NutritionPlanV2ConversionDialog
          planName={plan.name}
          onCancel={() => setConversionDialogOpen(false)}
          onContinue={ouvrirConversion}
        />
      )}

      {(
        <>
          <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
                  {plan.name}
                </h1>
                <StatusBadge label={contentStatusLabels[plan.status]} tone={contentStatusTone(plan.status)} />
                {isV2 && (
                  <span className="rounded-control border border-border px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Répartition avancée
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{goalLabels[plan.goalType]}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isV2 ? (
                <button
                  type="button"
                  onClick={ouvrirEditionV2}
                  disabled={canonique.loading || canonique.plan === null}
                  className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <SlidersHorizontal size={13} />
                  Modifier la répartition
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => undefined}
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Pencil size={13} />
                    Modifier
                  </button>
                  <button
                    type="button"
                    onClick={() => setConversionDialogOpen(true)}
                    className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <SlidersHorizontal size={13} />
                    Activer la répartition avancée
                  </button>
                </>
              )}
              <AssignStudentsModal
                contentLabel={plan.name}
                contentType="nutrition"
                contentId={plan.id}
                students={students}
                assignedStudentIds={plan.assignedStudentIds}
                onSetAssignment={guarded.setAssignment}
                triggerLabel="Assigner à des élèves"
              />
              <button
                type="button"
                onClick={handleArchive}
                className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-destructive/50 px-4 py-2 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
              >
                <Archive size={13} />
                Archiver
              </button>
            </div>
          </div>

          <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="Kcal / jour" value={String(plan.caloriesPerDay)} size="lg" />
            <StatCard label="Protéines" value={`${plan.protein}g`} size="lg" />
            <StatCard label="Glucides" value={`${plan.carbs}g`} size="lg" />
            <StatCard label="Lipides" value={`${plan.fat}g`} size="lg" />
          </div>

          <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
            <h2 className="mb-2 font-heading text-lg font-bold uppercase text-foreground">
              Objectif hebdomadaire
            </h2>
            <p className="text-sm text-muted-foreground">
              {plan.weeklyTargetCalories.toLocaleString("fr-FR")} kcal/semaine — compatible avec la logique élève
              (validation journée, calories restantes, ajustement sur les jours restants).
            </p>
            {plan.coachNotes && <p className="mt-2 text-sm text-foreground">{plan.coachNotes}</p>}
          </div>


          <div className="rounded-card border border-border bg-card p-6 shadow-soft">
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
                    className="pressable flex min-h-[44px] items-center rounded-control border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
