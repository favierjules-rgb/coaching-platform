"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { RecipeBuilder } from "@/components/admin/RecipeBuilder";
import { useCurrentCoachId } from "@/hooks/useCurrentCoachId";
import { useNutritionRecipe } from "@/hooks/useNutritionRecipes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  archiveNutritionRecipe,
  saveNutritionRecipe,
} from "@/lib/supabase/nutrition-recipes-write";
import {
  createRecipeFormFromRecord,
  toRecipeSavePayload,
  type RecipeFormState,
} from "@/lib/nutrition/recipe-form";
import { RECIPE_STATUS_LABELS_FR } from "@/lib/nutrition/recipe-labels";
import type { RecipeStatus } from "@/lib/nutrition/recipe-rows";

/**
 * Modification d'une recette.
 *
 * ATOMIQUE. Chaque enregistrement est un seul appel à `save_nutrition_recipe`.
 * La RPC synchronise les enfants — met à jour les conservés, insère les
 * nouveaux, retire ceux absents du payload — et refuse tout identifiant
 * appartenant à une AUTRE recette.
 *
 * ACTIVATION REFUSÉE : la transaction est annulée côté base, l'ancienne
 * version reste intacte, et le message canonique remonte ici. Le formulaire
 * n'est pas rechargé : le coach garde sa saisie et peut corriger.
 *
 * ARCHIVAGE : un statut, jamais une suppression. Aucun chemin de suppression
 * définitive n'existe dans cette PR.
 */
export default function AdminNutritionRecipeDetailPage() {
  const params = useParams<{ recipeId: string }>();
  const { recipe, invalid, loading, refetch } = useNutritionRecipe(params.recipeId ?? null);
  const { coachId } = useCurrentCoachId();

  const [state, setState] = useState<RecipeFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [blockingIssue, setBlockingIssue] = useState<string | null>(null);

  // État construit à la demande depuis la recette lue — jamais dans un effet.
  const formulaire =
    state ??
    (recipe && coachId ? createRecipeFormFromRecord(recipe, coachId, recipe.sourceKey) : null);

  async function écrire(status: RecipeStatus, archiver = false) {
    if (!formulaire) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSaveError("Connexion indisponible. Ta saisie est conservée — réessaie.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const payload = toRecipeSavePayload(formulaire, status);
    const résultat = archiver
      ? await archiveNutritionRecipe(supabase, payload)
      : await saveNutritionRecipe(supabase, payload);
    setSaving(false);

    if (!résultat.ok) {
      // Rien n'est rechargé : la saisie du coach lui appartient.
      setSaveError(résultat.message);
      return;
    }
    setBlockingIssue(résultat.blockingIssue);
    setState((courant) => (courant ? { ...courant, status: résultat.status } : courant));
    await refetch();
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Chargement…</p>;
  }

  const retour = (
    <Link
      href="/admin/nutrition/recettes"
      className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft size={14} />
      Recettes
    </Link>
  );

  if (!recipe) {
    return (
      <div>
        {retour}
        <p className="text-sm text-muted-foreground">
          {invalid
            ? `Cette recette est illisible (${invalid.code}). Corrige-la en base avant de la rouvrir.`
            : "Recette introuvable."}
        </p>
      </div>
    );
  }

  if (!formulaire) {
    return (
      <div>
        {retour}
        <p className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning" role="status">
          Aucun coach n&apos;est identifié : impossible de modifier cette recette.
        </p>
      </div>
    );
  }

  return (
    <div>
      {retour}

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {recipe.recipe.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {RECIPE_STATUS_LABELS_FR[recipe.status]}
            {" · "}
            {recipe.recipe.ingredients.length} ingrédient
            {recipe.recipe.ingredients.length > 1 ? "s" : ""}
          </p>
        </div>
      </div>

      <RecipeBuilder
        state={formulaire}
        onChange={setState}
        onSave={(status) => écrire(status)}
        onArchive={() => écrire("archived", true)}
        saving={saving}
        saveError={saveError}
        blockingIssue={blockingIssue}
      />
    </div>
  );
}
