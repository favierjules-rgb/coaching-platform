"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowLeft, Copy, Pencil, RotateCcw, SlidersHorizontal } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import {
  ConfirmActionModal,
  DangerZone,
  DeleteConfirmationModal,
  DeleteTriggerButton,
  LifecycleActionBar,
  type LifecycleActionSpec,
} from "@/components/admin/LifecycleActions";
import { NutritionPlanV2Builder } from "@/components/admin/NutritionPlanV2Builder";
import { NutritionPlanV2ConversionDialog } from "@/components/admin/NutritionPlanV2ConversionDialog";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { StatCard } from "@/components/shared/StatCard";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useGuardedNutritionAssignment } from "@/hooks/useGuardedNutritionAssignment";
import { useNutritionLifecycle } from "@/hooks/useNutritionLifecycle";
import { useNutritionPlanV2 } from "@/hooks/useNutritionPlanV2";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, fullName } from "@/lib/admin";
import {
  describeHidingFromStudent,
  describePlanDeletionBlock,
  duplicateName,
  hidesPlanFromAssignedStudent,
  planLifecycleActions,
  planStatusAfter,
  PLAN_ACTION_LABELS_FR,
  type PlanLifecycleAction,
} from "@/lib/nutrition/lifecycle";
import { prefillFromLegacyDailyTarget } from "@/lib/nutrition/plan-v2-conversion";
import {
  createFormStateFromCanonical,
  createFormStateFromPrefill,
  toSaveInput,
  type PlanV2FormState,
} from "@/lib/nutrition/plan-v2-form";
import {
  createBlankWeek,
  createWeekFormFromPlan,
  initializeAllDays,
  mainDayTargets,
  toDuplicateWeekPayload,
  toWeekSavePayload,
  type WeekFormState,
} from "@/lib/nutrition/plan-v2-week-form";
import { MAIN_DAY_PROFILE_KEY } from "@/lib/nutrition/day-profile-keys";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { readNutritionPlanV2Week } from "@/lib/supabase/nutrition-week";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import {
  STATUS_APP_TO_DB,
  updateNutritionPlanStatus as updateNutritionPlanStatusSupabase,
} from "@/lib/supabase/nutrition";
import { deleteNutritionPlan } from "@/lib/supabase/nutrition-lifecycle";
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

  // ── Cycle de vie (PR D) ───────────────────────────────────────────────
  const router = useRouter();
  const cycleDeVie = useNutritionLifecycle();
  const [actionEnCours, setActionEnCours] = useState(false);
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  const [suppressionErreur, setSuppressionErreur] = useState<string | null>(null);
  const [messageCycle, setMessageCycle] = useState<string | null>(null);
  // Une action en attente de confirmation parce qu'elle masquerait le plan à
  // son élève. `null` = rien en attente.
  const [masquageEnAttente, setMasquageEnAttente] = useState<
    { readonly appliquer: () => void | Promise<void> } | null
  >(null);

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

  const infoCycle = cycleDeVie.planInfo(plan.id);
  // ABSENT ≠ SUPPRIMABLE. Tant que l'aperçu n'est pas chargé, on considère que
  // la suppression est impossible — et de toute façon la base retrancherait.
  const motifBlocage =
    infoCycle === null
      ? "Les dépendances de ce plan n'ont pas encore été vérifiées. Recharge la page."
      : infoCycle.deletionBlock === null
        ? null
        : describePlanDeletionBlock(infoCycle.deletionBlock, infoCycle.dependencies);

  /**
   * Une seule fonction pour activer, archiver et restaurer.
   *
   * Toutes les trois ne changent QUE le statut : `updateNutritionPlanStatus`
   * n'écrit ni `daily_target`, ni les jours, ni les repas. Archiver ne perd
   * donc rien, et restaurer ne reconstruit rien — c'est ce qui rend
   * l'archivage sans risque et réversible.
   */
  async function changerStatut(cible: AdminContentStatus) {
    setSaveError(false);
    setMessageCycle(null);
    setActionEnCours(true);
    if (isSupabasePlansActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const ok = await updateNutritionPlanStatusSupabase(supabase, plan!.id, cible);
        setActionEnCours(false);
        if (!ok) {
          setSaveError(true);
          return;
        }
        await supabaseNutritionPlans.refetch();
        await cycleDeVie.refetch();
        return;
      }
    }
    updateNutritionPlan(plan!.id, { status: cible });
    setActionEnCours(false);
  }

  /**
   * Duplique le plan, semaine comprise, en un BROUILLON indépendant.
   *
   * Réutilise le chemin d'écriture UNIQUE — `save_nutrition_plan_v2` — avec
   * `planId: null`. Aucune écriture directe, aucune copie de ligne à ligne :
   * la copie est construite comme n'importe quel enregistrement, donc elle
   * subit les mêmes validations et hérite des mêmes invariants.
   *
   * Elle naît en brouillon et sans élève : dupliquer n'assigne jamais.
   */
  async function dupliquer() {
    setSaveError(false);
    setMessageCycle(null);
    setActionEnCours(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setActionEnCours(false);
      setSaveError(true);
      return;
    }
    const semaine = await readNutritionPlanV2Week(supabase, plan!.id);
    const formulaire = semaine ? createWeekFormFromPlan(semaine) : createBlankWeek();
    const principal = mainDayTargets(formulaire);
    const résultat = await saveNutritionPlanV2(supabase, {
      planId: null,
      name: duplicateName(plan!.name),
      goalType: plan!.goalType,
      status: STATUS_APP_TO_DB.brouillon,
      description: plan!.description ?? "",
      coachNotes: plan!.coachNotes,
      hydrationTip: plan!.hydrationTip,
      profileKey: MAIN_DAY_PROFILE_KEY,
      dailyCalories: principal.dailyCalories,
      proteinBp: principal.proteinBp,
      carbBp: principal.carbBp,
      fatBp: principal.fatBp,
      slots: principal.slots,
      week: toDuplicateWeekPayload(formulaire),
    });
    setActionEnCours(false);
    if (!résultat.ok) {
      setV2Error(résultat.message);
      return;
    }
    await supabaseNutritionPlans.refetch();
    router.push(`/admin/nutrition/${résultat.plan.id}`);
  }

  function lancerAction(action: PlanLifecycleAction) {
    if (action === "duplicate") {
      void dupliquer();
      return;
    }
    const cible = planStatusAfter(action);
    if (!cible) return;
    // « Restaurer » ramène en brouillon. Sur un plan encore affecté, cela le
    // fait disparaître de l'espace de l'élève : on le dit avant, en le nommant.
    if (hidesPlanFromAssignedStudent(cible, plan!.assignedStudentIds.length)) {
      setMasquageEnAttente({ appliquer: () => changerStatut(cible) });
      return;
    }
    void changerStatut(cible);
  }

  /**
   * La suppression définitive. Le navigateur n'envoie QUE l'identifiant :
   * aucun drapeau d'autorisation ne transite, et la base recalcule la
   * condition dans la transaction. Un refus est donc toujours possible ici,
   * même si l'écran affichait le bouton — et c'est très bien ainsi.
   */
  async function supprimerDéfinitivement() {
    setSuppressionErreur(null);
    setActionEnCours(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setActionEnCours(false);
      setSuppressionErreur("Connexion indisponible. Rien n'a été supprimé.");
      return;
    }
    const résultat = await deleteNutritionPlan(supabase, plan!.id);
    setActionEnCours(false);
    if (!résultat.ok) {
      setSuppressionErreur(
        describePlanDeletionBlock(résultat.reason, {
          assignedStudents: résultat.dependencies.assignedStudents,
          dailyLogs: résultat.dependencies.dailyLogs,
        }),
      );
      await cycleDeVie.refetch();
      await supabaseNutritionPlans.refetch();
      return;
    }
    setSuppressionOuverte(false);
    router.push("/admin/nutrition");
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
    // REPRISE D'UN PLAN EXISTANT : chaque jour reçoit une COPIE des valeurs du
    // profil qu'il utilisait, et devient indépendant. Deux jours qui
    // partageaient un profil ne se déplacent donc plus ensemble. La
    // normalisation vers les clés internes `day_<jour>` n'a lieu qu'à la
    // prochaine sauvegarde — rien n'est réécrit à la lecture.
    setWeekState(semaine ? createWeekFormFromPlan(semaine) : createBlankWeek());
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
    // La conversion démarre sur une semaine complète : les objectifs hérités
    // du plan v1 sont recopiés dans les SEPT jours, qui deviennent aussitôt
    // indépendants. Le coach peut ensuite faire diverger chaque jour.
    setWeekState(
      initializeAllDays(createBlankWeek(), {
        dailyCalories: prefill.dailyCalories,
        proteinBp: prefill.proteinBp,
        carbBp: prefill.carbBp,
        fatBp: prefill.fatBp,
      }),
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
  /**
   * Le constructeur porte lui aussi un sélecteur « Statut ». Enregistrer un
   * plan affecté en BROUILLON depuis cette page a exactement le même effet que
   * l'action « Restaurer » : il disparaît chez l'élève. La même confirmation
   * doit donc s'appliquer aux deux chemins — sans quoi la garantie serait
   * partielle, et une garantie partielle ne se retient pas.
   */
  function handleSaveV2() {
    if (!formState) return;
    if (
      hidesPlanFromAssignedStudent(
        formState.status as AdminContentStatus,
        plan!.assignedStudentIds.length,
      )
    ) {
      setMasquageEnAttente({ appliquer: enregistrerV2 });
      return;
    }
    void enregistrerV2();
  }

  async function enregistrerV2() {
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
    // La semaine est la source de vérité : sept profils internes, sept jours.
    // Le profil de premier niveau reprend les objectifs de LUNDI, uniquement
    // pour que le `daily_target` de compatibilité reste cohérent — la RPC
    // privilégie `profiles` dès qu'il est présent.
    const semaine = weekState ? toWeekSavePayload(weekState) : undefined;
    const principal = weekState ? mainDayTargets(weekState) : null;
    const resultat = await saveNutritionPlanV2(supabase, {
      ...input,
      status: statutBase,
      ...(principal
        ? {
            profileKey: MAIN_DAY_PROFILE_KEY,
            dailyCalories: principal.dailyCalories,
            proteinBp: principal.proteinBp,
            carbBp: principal.carbBp,
            fatBp: principal.fatBp,
            slots: principal.slots,
          }
        : {}),
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

  // La semaine est OBLIGATOIRE pour ouvrir le constructeur : elle en est
  // désormais la seule source de vérité nutritionnelle. Tant qu'elle n'est pas
  // chargée (lecture en cours), on n'affiche pas un éditeur à moitié rempli.
  const enConstructeurV2 =
    (conversionMode || (isV2 && editingV2)) && formState !== null && weekState !== null;

  if (enConstructeurV2 && formState && weekState) {
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
          week={weekState}
          onWeekChange={setWeekState}
        />

        {/* La MÊME confirmation que sur la fiche. Elle doit être rendue ici
            aussi : cette branche sort avant le reste de la page, et une modale
            déclenchée sans être montée ne s'ouvrirait jamais. */}
        {masquageEnAttente && (
          <ConfirmActionModal
            title="Ce plan disparaîtra de l'espace de l'élève"
            message={describeHidingFromStudent(assignedStudents.map(fullName))}
            confirmLabel="Enregistrer en brouillon"
            busy={savingV2}
            onCancel={() => setMasquageEnAttente(null)}
            onConfirm={async () => {
              const action = masquageEnAttente.appliquer;
              setMasquageEnAttente(null);
              await action();
            }}
          />
        )}
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
              {/* LES ACTIONS DE CYCLE DE VIE, adaptées au statut courant.
                  « Supprimer définitivement » n'est PAS ici : elle vit dans la
                  zone dangereuse, en bas de page. */}
              <LifecycleActionBar
                busy={actionEnCours}
                actions={planLifecycleActions(plan.status).map(
                  (action): LifecycleActionSpec => ({
                    key: action,
                    label: PLAN_ACTION_LABELS_FR[action],
                    icon: ICÔNES_ACTION_PLAN[action],
                    onRun: () => lancerAction(action),
                  }),
                )}
              />
            </div>
          </div>

          {/* Un plan non actif ne peut pas être assigné : la base le refuse
              (`assign_nutrition_plan`, migration 20260815090000). On le dit
              AVANT le clic plutôt que de laisser découvrir l'erreur. */}
          {plan.status !== "actif" && (
            <p className="mb-6 rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-muted-foreground">
              {plan.status === "brouillon"
                ? "Ce plan est un brouillon : aucun élève ne le voit, et il ne peut pas être assigné tant qu'il n'est pas activé."
                : `Ce plan est archivé${plan.archivedAt ? ` depuis le ${formaterDate(plan.archivedAt)}` : ""} : il n'est plus proposé à de nouvelles assignations. L'élève qui l'avait garde son suivi.`}
            </p>
          )}

          {messageCycle && (
            <p className="mb-6 rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-foreground" role="status">
              {messageCycle}
            </p>
          )}

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


          <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
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

          {/* ─────────────────────── ZONE DANGEREUSE ───────────────────────
              Elle est en BAS, séparée, et ne contient qu'une action. Le coach
              qui vise « Archiver » ne peut pas la manquer et cliquer ici. */}
          <DangerZone description="La suppression définitive efface le plan, sa semaine, ses repas et ses profils. Elle est refusée tant qu'un élève y est affecté ou qu'une journée de suivi s'y rattache — l'archivage reste la bonne action dans ces cas-là.">
            <DeleteTriggerButton
              onOpen={() => {
                setSuppressionErreur(null);
                setSuppressionOuverte(true);
              }}
              disabled={actionEnCours}
            />
          </DangerZone>

          {masquageEnAttente && (
            <ConfirmActionModal
              title="Ce plan disparaîtra de l'espace de l'élève"
              message={describeHidingFromStudent(assignedStudents.map(fullName))}
              confirmLabel="Repasser en brouillon"
              busy={actionEnCours || savingV2}
              onCancel={() => setMasquageEnAttente(null)}
              onConfirm={async () => {
                const action = masquageEnAttente.appliquer;
                setMasquageEnAttente(null);
                await action();
              }}
            />
          )}

          {suppressionOuverte && (
            <DeleteConfirmationModal
              resourceName={plan.name}
              resourceKind="ce plan alimentaire"
              dependencies={[
                { label: "Élèves affectés", count: infoCycle?.dependencies.assignedStudents ?? 0 },
                { label: "Journées de suivi enregistrées", count: infoCycle?.dependencies.dailyLogs ?? 0 },
              ]}
              blockedReason={motifBlocage}
              deleting={actionEnCours}
              error={suppressionErreur}
              onCancel={() => setSuppressionOuverte(false)}
              onConfirm={supprimerDéfinitivement}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Les icônes des actions de plan — définies hors du composant, jamais recréées. */
const ICÔNES_ACTION_PLAN: Record<PlanLifecycleAction, ReactNode> = {
  activate: <SlidersHorizontal size={13} />,
  archive: <Archive size={13} />,
  restore: <RotateCcw size={13} />,
  duplicate: <Copy size={13} />,
};

/** Date d'archivage lisible. `Intl` suffit : aucune dépendance ajoutée. */
function formaterDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}
