"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { StudentAdaptiveRecipes } from "@/components/student/StudentAdaptiveRecipes";
import { useStudentNutritionPlanV2 } from "@/hooks/useStudentNutritionPlanV2";
import { useSupabaseNutritionForStudent } from "@/hooks/useSupabaseNutritionForStudent";

/**
 * LES RECETTES ADAPTATIVES — leur propre parcours.
 *
 * POURQUOI CETTE PAGE. La section vivait en bas de la fiche du plan, après le
 * suivi de la semaine et la semaine prescrite. L'outil le plus utile au
 * quotidien était donc celui qui demandait le plus de défilement. Il a
 * maintenant son écran, atteint depuis un bouton mis en avant en haut de la
 * page Nutrition.
 *
 * AUCUNE FONCTION N'A CHANGÉ. Le composant `StudentAdaptiveRecipes` est monté
 * ici EXACTEMENT tel qu'il l'était : mêmes données, même hook, même solveur,
 * même absence de persistance. Ce fichier ne fait que le déplacer et lui
 * donner son propre en-tête.
 */
export default function StudentRecipesPage() {
  const params = useParams<{ planId: string }>();
  const supabaseNutrition = useSupabaseNutritionForStudent();
  const v2 = useStudentNutritionPlanV2(supabaseNutrition.active ? (params.planId ?? null) : null);

  const retour = (
    <Link
      href={`/nutrition/${params.planId ?? ""}`}
      className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} />
      Retour au plan
    </Link>
  );

  if (!supabaseNutrition.ready) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  if (!supabaseNutrition.active) {
    return (
      <div>
        {retour}
        <p className="text-sm text-muted-foreground">
          Les recettes adaptatives sont réservées aux plans réels de ton coach.
        </p>
      </div>
    );
  }

  const plan = supabaseNutrition.plans.find((p) => p.id === params.planId) ?? null;

  return (
    <div>
      {retour}

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Recettes
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {plan ? `${plan.name} · ` : ""}Choisis un jour puis un créneau : les quantités sont
          recalculées pour tes objectifs de ce jour-là. Rien n&apos;est enregistré — c&apos;est une
          aide, pas un journal.
        </p>
      </div>

      {v2.loading ? (
        <p className="text-sm text-muted-foreground">Chargement des recettes…</p>
      ) : v2.error ? (
        <div
          className="flex flex-col items-start gap-3 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3"
          role="alert"
        >
          <p className="text-sm text-destructive">{v2.error}</p>
          <button
            type="button"
            onClick={() => void v2.refetch()}
            className="pressable flex min-h-11 items-center gap-2 rounded-control border border-destructive/50 px-4 text-xs uppercase tracking-widest text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            Réessayer
          </button>
        </div>
      ) : v2.week ? (
        <StudentAdaptiveRecipes week={v2.week} recipes={v2.recipes} />
      ) : (
        <p className="rounded-panel border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Ce plan n&apos;a pas encore de semaine : les recettes s&apos;afficheront dès que ton coach
          l&apos;aura construite.
        </p>
      )}
    </div>
  );
}
