"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";

import { RecipeCatalog } from "@/components/admin/RecipeCatalog";
import { RecipeFixtureImportDialog } from "@/components/admin/RecipeFixtureImportDialog";
import { useCurrentCoachId } from "@/hooks/useCurrentCoachId";
import { useNutritionRecipes } from "@/hooks/useNutritionRecipes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { importNutritionRecipeFixtures } from "@/lib/supabase/nutrition-recipes-write";
import { validateRecipeForm, createRecipeFormFromRecord } from "@/lib/nutrition/recipe-form";
import type { FixtureImportReport } from "@/lib/nutrition/recipe-fixtures-import";

/**
 * Catalogue des recettes — administration.
 *
 * L'IMPORT N'EST JAMAIS AUTOMATIQUE : il part uniquement du bouton, après
 * confirmation dans la modale. Aucun `useEffect` de cette page ne l'appelle.
 *
 * La colonne « exploitable / à compléter » est un verdict LOCAL, miroir des
 * règles de `nutrition_recipe_blocking_issue` — pas sa réponse. L'arbitre de
 * l'ACTIVATION reste la base, appelée dans la transaction de sauvegarde.
 * Toute règle ajoutée à `nutrition_recipe_blocking_issue` doit donc avoir son
 * équivalent dans `validateRecipeForm`, sinon l'écran annoncerait une recette
 * exploitable que la base refuserait d'activer.
 */
export default function AdminNutritionRecipesPage() {
  const { recipes, invalid, loading, error, refetch } = useNutritionRecipes();
  const { coachId } = useCurrentCoachId();
  const [importError, setImportError] = useState<string | null>(null);

  // `coachId` n'intervient pas dans la validation, mais lui passer
  // l'identifiant de la RECETTE fabriquait un état de formulaire faux : le
  // jour où une règle s'appuiera sur le coach, le verdict serait erroné.
  const blockingByRecipe = useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const r of recipes) {
      const issues = validateRecipeForm(createRecipeFormFromRecord(r, coachId ?? "", r.sourceKey));
      map[r.recipe.id] = issues.length > 0 ? issues[0].code : null;
    }
    return map;
  }, [recipes, coachId]);

  async function importer(updateExisting: boolean): Promise<FixtureImportReport> {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !coachId) {
      setImportError("Impossible d'identifier le coach : recharge la page puis réessaie.");
      return { imported: 0, updated: 0, skipped: 0, failed: 0, entries: [] };
    }
    setImportError(null);
    const rapport = await importNutritionRecipeFixtures(supabase, coachId, { updateExisting });
    await refetch();
    return rapport;
  }

  return (
    <div>
      <Link
        href="/admin/nutrition"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Nutrition
      </Link>

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            Recettes
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {recipes.length} recette{recipes.length > 1 ? "s" : ""} au catalogue.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RecipeFixtureImportDialog onImport={importer} disabled={!coachId} />
          <Link
            href="/admin/nutrition/recettes/nouvelle"
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Plus size={14} />
            Créer une recette
          </Link>
        </div>
      </div>

      {importError && (
        <p className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {importError}
        </p>
      )}

      <RecipeCatalog
        recipes={recipes}
        invalid={invalid}
        loading={loading}
        error={error}
        blockingByRecipe={blockingByRecipe}
      />
    </div>
  );
}
