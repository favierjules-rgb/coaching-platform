"use client";

import Link from "next/link";
import { Droplet, Lightbulb, Pill } from "lucide-react";

import { SectionIndisponible } from "@/components/pwa/SectionIndisponible";
import { StatusBadge } from "@/components/student/StatusBadge";
import { NutritionPlansListClient } from "@/components/student/NutritionPlansListClient";
import { ListeDeCoursesHighlightLink } from "@/components/student/ListeDeCoursesHighlightLink";
import { RecipesHighlightLink } from "@/components/student/RecipesHighlightLink";
import { NutritionWeekStatusClient } from "@/components/student/NutritionWeekStatusClient";
import {
  activeNutritionPlan,
  hydrationAndSupplements,
  nutritionPlans,
  student,
} from "@/data/student";
import { useEtatOfflineEleve } from "@/hooks/useEtatOfflineEleve";
import { useStudentNutritionPlanV2 } from "@/hooks/useStudentNutritionPlanV2";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";
import { dailyTargetsByWeekday, weeklyCaloriesFromDays } from "@/lib/nutrition/plan-v2-week";

/**
 * Priorité Supabase dès qu'un compte élève réel est identifié (même
 * principe que /entrainement) : les plans alimentaires réellement assignés
 * (nutrition_plans.student_id, voir lib/supabase/nutrition.ts) remplacent
 * alors entièrement data/student.ts, y compris pour afficher "Aucun plan
 * alimentaire attribué" plutôt qu'un plan mock qui ferait croire à un vrai
 * suivi. Le suivi jour par jour (validation, ajustement calorique) reste
 * hors périmètre pour un plan réel — lecture seule.
 */
/**
 * « 3 000 kcal/jour » quand les sept jours sont identiques, « 2 000 – 3 000
 * kcal/jour » dès qu'ils diffèrent. Le nombre unique était trompeur : il
 * venait du `daily_target` hérité, qui ne reflète qu'un seul jour.
 */
function décrireObjectifQuotidien(
  parJour: readonly ({ calories: number } | null)[] | undefined,
  repli: number,
): string {
  const valeurs = (parJour ?? []).filter((j): j is { calories: number } => j !== null).map((j) => j.calories);
  if (valeurs.length === 0) {
    return `${repli.toLocaleString("fr-FR")} kcal/jour`;
  }
  const min = Math.round(Math.min(...valeurs));
  const max = Math.round(Math.max(...valeurs));
  return min === max
    ? `${min.toLocaleString("fr-FR")} kcal/jour`
    : `${min.toLocaleString("fr-FR")} – ${max.toLocaleString("fr-FR")} kcal/jour`;
}

export default function NutritionPage() {
  const supabaseNutrition = useSupabaseNutritionForStudent();
  // POURQUOI le chargement n'a rien donné. Même diagnostic que partout
  // ailleurs, aucune requête tant que le verdict en ligne n'est pas tombé.
  const local = useEtatOfflineEleve(supabaseNutrition.ready && !supabaseNutrition.active);

  // Appelé à CHAQUE rendu, avant toute sortie anticipée : un hook ne peut pas
  // être conditionnel. La semaine du plan actif est nécessaire ici parce que
  // le suivi hebdomadaire doit connaître les SEPT objectifs prescrits, et non
  // une moyenne — voir NutritionDailyTarget.perDay.
  const v2 = useStudentNutritionPlanV2(supabaseNutrition.activePlan?.id ?? null);
  const objectifsParJour = v2.week
    ? dailyTargetsByWeekday(v2.week).map((cible) =>
        cible
          ? {
              calories: cible.calories.totalCalories,
              protein: cible.grams.proteinGrams,
              carbs: cible.grams.carbGrams,
              fat: cible.grams.fatGrams,
            }
          : null,
      )
    : undefined;

  if (!supabaseNutrition.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (supabaseNutrition.active) {
    const { plans, activePlan } = supabaseNutrition;

    if (!activePlan) {
      return (
        <div>
          <div className="mb-8">
            <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
              Nutrition
            </h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Aucun plan alimentaire attribué pour le moment. Contacte ton coach.
          </p>
        </div>
      );
    }

    return (
      <div>
        <div className="mb-8">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Nutrition
          </h1>
          {/* « X kcal/jour » n'a plus de sens dès que deux jours diffèrent :
              on affiche alors la FOURCHETTE réellement prescrite, et le total
              hebdomadaire recalculé depuis les sept jours. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Plan actif : {activePlan.name} · {décrireObjectifQuotidien(objectifsParJour, activePlan.caloriesPerDay)} ·{" "}
            {(v2.week ? weeklyCaloriesFromDays(v2.week) : activePlan.weeklyTargetCalories).toLocaleString("fr-FR")}{" "}
            kcal/semaine
          </p>
        </div>

        {/* LES DEUX OUTILS DU HAUT DE L'ÉCRAN.
            Placés avant la liste des plans, donc visibles sans défiler : ce
            sont ceux qu'on ouvre le plus souvent, et chacun mène à son propre
            écran.

            COURSES C1 — « GÉNÉRER MA LISTE DE COURSE » est le JUMEAU de
            « Recettes », immédiatement en dessous : même carte, même filet
            lumineux, même flèche, seule la teinte change. L'ancienne entrée
            sobre « Mes courses », qui menait à /courses, a disparu avec le
            parcours qu'elle ouvrait : la liste se génère désormais sous
            /nutrition/courses, parce qu'elle appartient à l'ÉLÈVE et à des
            dates réelles, pas à un plan. */}
        <div className="mb-8 flex flex-col gap-3 sm:max-w-sm">
          <RecipesHighlightLink planId={activePlan.id} className="w-full" />
          <ListeDeCoursesHighlightLink className="w-full" />
        </div>

        {(activePlan.hydrationTip || activePlan.supplements.length > 0) && (
          <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-2">
            {activePlan.hydrationTip && (
              <div className="flex flex-col gap-2 border border-border bg-card p-6">
                <Droplet size={20} className="mb-2 text-primary" />
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Conseil hydratation</span>
                <p className="text-sm leading-relaxed text-foreground">{activePlan.hydrationTip}</p>
              </div>
            )}
            {activePlan.supplements.length > 0 && (
              <div className="flex flex-col gap-2 border border-border bg-card p-6">
                <Pill size={20} className="mb-2 text-primary" />
                <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Compléments</span>
                <ul className="flex flex-col gap-1 text-sm text-foreground">
                  {activePlan.supplements.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activePlan.coachNotes && (
          <div className="mb-8 flex flex-col gap-2 border border-border bg-card p-6">
            <Lightbulb size={20} className="mb-2 text-primary" />
            <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Consignes du coach</span>
            <p className="text-sm leading-relaxed text-foreground">{activePlan.coachNotes}</p>
          </div>
        )}

        <div>
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Mes plans alimentaires
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((plan) => (
              <div key={plan.id} className="flex flex-col gap-4 border border-border bg-card p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-heading text-lg font-bold uppercase text-foreground">{plan.name}</h3>
                  <StatusBadge status={plan.status} />
                </div>
                <div className="grid grid-cols-4 gap-2 text-sm text-foreground">
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
                <Link
                  href={`/nutrition/${plan.id}`}
                  className="mt-2 block border border-primary py-3 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  Voir le plan
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════
   * LE SERVEUR N'A PAS RÉPONDU
   * ══════════════════════════════════════════════════════════════════
   * La nutrition n'est PAS disponible hors ligne, et ce n'est pas l'objet de
   * ce correctif. Ce qui l'est : ne plus présenter le plan de démonstration
   * — « 3 000 kcal », des compléments, un conseil du jour — à un élève réel
   * qui a simplement perdu le réseau. */
  if (local.etat === "chargement") {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (local.etat !== "mock") {
    return (
      <SectionIndisponible
        zone="/nutrition"
        titre="Nutrition"
        etat={local.etat}
        lignes={{ auth: local.identite ? "oui" : "non", businessDate: local.businessDate }}
      />
    );
  }

  /* ── DÉMONSTRATION ──────────────────────────────────────────────────
   * Seul `local.etat === "mock"` arrive ici : Supabase non configuré. */
  return (
    <div>
      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Nutrition
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Plan actif : {activeNutritionPlan.name} ·{" "}
          {activeNutritionPlan.dailyTarget.calories} kcal/jour ·{" "}
          {activeNutritionPlan.weeklyTargetCalories.toLocaleString("fr-FR")}{" "}
          kcal/semaine
        </p>
      </div>

      <NutritionWeekStatusClient
        studentId={student.id}
        activePlan={activeNutritionPlan}
      />

      <div className="mb-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Droplet size={20} className="mb-2 text-primary" />
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            Hydratation
          </span>
          <span className="font-heading text-lg font-bold text-foreground">
            {hydrationAndSupplements.waterTarget}
          </span>
        </div>
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Pill size={20} className="mb-2 text-primary" />
          <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Compléments
          </span>
          <ul className="flex flex-col gap-1 text-sm text-foreground">
            {hydrationAndSupplements.supplements.map((supplement) => (
              <li key={supplement}>{supplement}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-2 border border-border bg-card p-6">
          <Lightbulb size={20} className="mb-2 text-primary" />
          <span className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
            Conseil du jour
          </span>
          <p className="text-sm leading-relaxed text-foreground">
            {hydrationAndSupplements.tipOfTheDay}
          </p>
        </div>
      </div>

      <NutritionPlansListClient plans={nutritionPlans} />
    </div>
  );
}
