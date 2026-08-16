"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Archive, ChefHat, ListChecks, Plus, RotateCcw, SlidersHorizontal, UtensilsCrossed } from "lucide-react";

import { AssignStudentsModal } from "@/components/admin/AssignStudentsModal";
import {
  ConfirmActionModal,
  LifecycleActionBar,
  type LifecycleActionSpec,
} from "@/components/admin/LifecycleActions";
import { FilterButtons, SearchInput } from "@/components/admin/SearchAndFilters";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useGuardedNutritionAssignment } from "@/hooks/useGuardedNutritionAssignment";
import { useNutritionLifecycle } from "@/hooks/useNutritionLifecycle";
import { useSupabaseNutritionPlans } from "@/hooks/useSupabaseNutritionPlans";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { contentStatusLabels, matchesTextSearch } from "@/lib/admin";
import {
  describeHidingFromStudent,
  hidesPlanFromAssignedStudent,
  planLifecycleActions,
  planStatusAfter,
  PLAN_ACTION_LABELS_FR,
  type PlanLifecycleAction,
} from "@/lib/nutrition/lifecycle";
import { NUTRITION_MODEL_VERSION_STRUCTURED } from "@/lib/nutrition/plan-v2-guards";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { updateNutritionPlanStatus } from "@/lib/supabase/nutrition";
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

/** Date d'archivage lisible. `Intl` suffit : aucune dépendance ajoutée. */
function formaterDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Les icônes des actions de plan — définies hors du composant. */
const ICÔNES_ACTION_PLAN: Record<PlanLifecycleAction, React.ReactNode> = {
  activate: <SlidersHorizontal size={13} />,
  archive: <Archive size={13} />,
  restore: <RotateCcw size={13} />,
  duplicate: null,
};

export default function AdminNutritionPlansPage() {
  const { state, setAssignment, updateNutritionPlan } = useAdminData();

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
  const baseSetAssignment = useContentAssignment(
    { nutrition: supabaseActive },
    setAssignment,
    supabaseNutritionPlans.refetch,
  );
  // MÊME garde qu'ailleurs : un plan v2 incomplet est refusé AVANT toute
  // écriture, donc sans jamais désassigner le plan précédent de l'élève.
  const versionsById = useMemo(
    () => Object.fromEntries(nutritionPlans.map((p) => [p.id, p.nutritionModelVersion])),
    [nutritionPlans],
  );
  const guarded = useGuardedNutritionAssignment(baseSetAssignment, versionsById);
  const handleSetAssignment = guarded.setAssignment;

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("tous");

  // ── Cycle de vie (PR D) ───────────────────────────────────────────────
  // Les compteurs et les dates d'archivage viennent d'UN appel, pour tous les
  // plans à la fois — jamais une requête par carte.
  const cycleDeVie = useNutritionLifecycle();
  const [actionEnCours, setActionEnCours] = useState<string | null>(null);
  const [actionErreur, setActionErreur] = useState<string | null>(null);
  // Une action en attente parce qu'elle masquerait le plan à son élève.
  const [masquageEnAttente, setMasquageEnAttente] = useState<
    { readonly planId: string; readonly cible: AdminContentStatus; readonly noms: readonly string[] } | null
  >(null);

  /**
   * Activer, archiver, restaurer depuis la liste.
   *
   * `updateNutritionPlanStatus` n'écrit QUE la colonne `status` : ni la
   * répartition, ni les jours, ni les repas ne sont touchés. C'est ce qui
   * rend ces trois actions sans risque depuis une liste, sans avoir à ouvrir
   * la fiche. Dupliquer et supprimer, eux, restent sur la fiche : le premier a
   * besoin de la semaine entière, le second ne doit jamais être à portée de
   * clic d'un bouton voisin.
   */
  async function changerStatut(planId: string, cible: AdminContentStatus) {
    setActionErreur(null);
    setActionEnCours(planId);
    if (supabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const ok = await updateNutritionPlanStatus(supabase, planId, cible);
        setActionEnCours(null);
        if (!ok) {
          setActionErreur("Le changement de statut a échoué. Réessaie.");
          return;
        }
        await supabaseNutritionPlans.refetch();
        await cycleDeVie.refetch();
        return;
      }
    }
    updateNutritionPlan(planId, { status: cible });
    setActionEnCours(null);
  }

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
        {/* Accès au catalogue de recettes. Ajout PR B : aucune page de plan
            n'est modifiée, seul ce lien apparaît.
            N1.2 ajoute « Listes » au même endroit et de la même façon : la
            bibliothèque entre dans la nutrition existante, elle ne fonde pas
            une seconde navigation. */}
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/admin/nutrition/listes"
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ListChecks size={14} />
            Listes d&apos;aliments
          </Link>
          <Link
            href="/admin/nutrition/recettes"
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ChefHat size={14} />
            Recettes
          </Link>
          <Link
            href="/admin/nutrition/nouveau"
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Plus size={14} />
            Créer plan alimentaire
          </Link>
        </div>
      </div>

      {guarded.refusal && (
        <p className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {guarded.refusal}
        </p>
      )}

      {actionErreur && (
        <p className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {actionErreur}
        </p>
      )}

      <div className="mb-6 flex flex-col gap-4">
        <SearchInput value={query} onChange={setQuery} placeholder="Rechercher un plan..." />
        <FilterButtons options={statusFilters} active={statusFilter} onChange={setStatusFilter} />
      </div>

      {masquageEnAttente && (
        <ConfirmActionModal
          title="Ce plan disparaîtra de l'espace de l'élève"
          message={describeHidingFromStudent(masquageEnAttente.noms)}
          confirmLabel="Repasser en brouillon"
          busy={actionEnCours === masquageEnAttente.planId}
          onCancel={() => setMasquageEnAttente(null)}
          onConfirm={async () => {
            const { planId, cible } = masquageEnAttente;
            setMasquageEnAttente(null);
            await changerStatut(planId, cible);
          }}
        />
      )}

      {filtered.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <UtensilsCrossed size={16} />
          Aucun plan ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {filtered.map((plan) => (
            <div key={plan.id} className="flex flex-col gap-4 rounded-card border border-border bg-card p-6 shadow-soft transition-colors hover:border-border-strong">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold uppercase text-foreground">{plan.name}</h2>
                  <p className="text-sm text-muted-foreground">{goalLabels[plan.goalType]}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <StatusBadge label={contentStatusLabels[plan.status]} tone={contentStatusTone(plan.status)} />
                  {plan.nutritionModelVersion === NUTRITION_MODEL_VERSION_STRUCTURED && (
                    <span className="rounded-control border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Répartition avancée
                    </span>
                  )}
                  {/* La date d'archivage : « Archivé » sans date ne dit pas si
                      c'était hier ou il y a un an. */}
                  {plan.status === "archivé" && (cycleDeVie.planInfo(plan.id)?.archivedAt ?? plan.archivedAt) && (
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Le {formaterDate((cycleDeVie.planInfo(plan.id)?.archivedAt ?? plan.archivedAt)!)}
                    </span>
                  )}
                </div>
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
                  className="pressable flex min-h-[44px] items-center rounded-control border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  Voir
                </Link>
                <Link
                  href={`/admin/nutrition/${plan.id}`}
                  className="pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
                {/* Les actions de statut, adaptées au statut courant. Ni
                    duplication ni suppression ici : voir la fiche du plan. */}
                <LifecycleActionBar
                  busy={actionEnCours === plan.id}
                  actions={planLifecycleActions(plan.status)
                    .filter((action) => action !== "duplicate")
                    .map((action): LifecycleActionSpec => {
                      const cible = planStatusAfter(action);
                      return {
                        key: action,
                        label: PLAN_ACTION_LABELS_FR[action],
                        icon: ICÔNES_ACTION_PLAN[action],
                        onRun: () => {
                          if (!cible) return;
                          // Même règle que sur la fiche : on nomme l'élève
                          // avant de lui retirer son plan de l'écran.
                          if (hidesPlanFromAssignedStudent(cible, plan.assignedStudentIds.length)) {
                            setMasquageEnAttente({
                              planId: plan.id,
                              cible,
                              noms: students
                                .filter((s) => plan.assignedStudentIds.includes(s.id))
                                .map((s) => `${s.firstName} ${s.lastName}`),
                            });
                            return;
                          }
                          void changerStatut(plan.id, cible);
                        },
                      };
                    })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
