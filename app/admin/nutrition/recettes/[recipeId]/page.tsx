"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Archive, ArrowLeft, Copy, Eye, EyeOff, RotateCcw } from "lucide-react";

import {
  DangerZone,
  DeleteConfirmationModal,
  DeleteTriggerButton,
  LifecycleActionBar,
  type LifecycleActionSpec,
} from "@/components/admin/LifecycleActions";
import { RecipeBuilder } from "@/components/admin/RecipeBuilder";
import { useCurrentCoachId } from "@/hooks/useCurrentCoachId";
import { useNutritionLifecycle } from "@/hooks/useNutritionLifecycle";
import { useNutritionRecipe } from "@/hooks/useNutritionRecipes";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { deleteNutritionRecipe } from "@/lib/supabase/nutrition-lifecycle";
import {
  saveNutritionRecipe,
  setNutritionRecipeStatus,
} from "@/lib/supabase/nutrition-recipes-write";
import {
  createRecipeFormFromRecord,
  duplicateRecipeForm,
  toRecipeSavePayload,
  type RecipeFormState,
} from "@/lib/nutrition/recipe-form";
import {
  describeRecipeDeletionBlock,
  describeRecipeDeletionSideEffects,
  duplicateName,
  recipeLifecycleActions,
  recipeStatusAfter,
  RECIPE_ACTION_LABELS_FR,
  type RecipeLifecycleAction,
} from "@/lib/nutrition/lifecycle";
import { RECIPE_STATUS_LABELS_FR } from "@/lib/nutrition/recipe-labels";
import type { RecipeStatus } from "@/lib/nutrition/recipe-rows";

/**
 * Modification d'une recette, et son CYCLE DE VIE complet.
 *
 * ATOMIQUE. Chaque enregistrement est un seul appel à `save_nutrition_recipe`.
 * La RPC synchronise les enfants — met à jour les conservés, insère les
 * nouveaux, retire ceux absents du payload — et refuse tout identifiant
 * appartenant à une AUTRE recette.
 *
 * PUBLICATION REFUSÉE : la transaction est annulée côté base, l'ancienne
 * version reste intacte, et le message canonique remonte ici. Le formulaire
 * n'est pas rechargé : le coach garde sa saisie et peut corriger.
 *
 * DEUX FAMILLES D'ACTIONS, VOLONTAIREMENT SÉPARÉES
 *
 *   - la BARRE DE CYCLE DE VIE (en haut) ne change que le statut. Sa charge
 *     utile ne contient ni ingrédients ni étiquettes : publier ou archiver ne
 *     peut donc rien abîmer, même si l'écran affichait une version périmée ;
 *   - le FORMULAIRE (en bas) enregistre la saisie, en brouillon ou publiée.
 *
 * ARCHIVER N'EST PAS SUPPRIMER. L'archivage conserve tout et se défait par
 * « Restaurer ». La suppression définitive vit dans la zone dangereuse, en bas
 * de page, derrière une modale qui exige de recopier le nom — et la base la
 * refuse tant qu'un élève peut encore ouvrir la recette depuis son plan.
 */
export default function AdminNutritionRecipeDetailPage() {
  const params = useParams<{ recipeId: string }>();
  const router = useRouter();
  const { recipe, invalid, loading, refetch } = useNutritionRecipe(params.recipeId ?? null);
  const { coachId } = useCurrentCoachId();
  const cycleDeVie = useNutritionLifecycle();

  const [state, setState] = useState<RecipeFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [blockingIssue, setBlockingIssue] = useState<string | null>(null);
  const [actionEnCours, setActionEnCours] = useState(false);
  const [actionErreur, setActionErreur] = useState<string | null>(null);
  const [suppressionOuverte, setSuppressionOuverte] = useState(false);
  const [suppressionErreur, setSuppressionErreur] = useState<string | null>(null);

  // État construit à la demande depuis la recette lue — jamais dans un effet.
  // Mémoïsé pour que l'identité de l'objet reste stable entre deux rendus.
  const relu = useMemo(
    () => (recipe && coachId ? createRecipeFormFromRecord(recipe, coachId, recipe.sourceKey) : null),
    [recipe, coachId],
  );
  const formulaire = state ?? relu;

  async function écrire(status: RecipeStatus) {
    if (!formulaire) return;
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSaveError("Connexion indisponible. Ta saisie est conservée — réessaie.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    const résultat = await saveNutritionRecipe(supabase, toRecipeSavePayload(formulaire, status));
    setSaving(false);

    if (!résultat.ok) {
      // Rien n'est rechargé : la saisie du coach lui appartient.
      setSaveError(résultat.message);
      return;
    }
    setBlockingIssue(résultat.blockingIssue);
    setState((courant) => (courant ? { ...courant, status: résultat.status } : courant));
    await refetch();
    await cycleDeVie.refetch();
  }

  /**
   * Publier, dépublier, archiver, restaurer — le STATUT seul.
   *
   * Aucun champ du formulaire n'est envoyé : ces quatre actions ne peuvent
   * donc pas écraser une modification en cours, ni perdre un ingrédient.
   */
  async function changerStatut(cible: RecipeStatus) {
    if (!recipe || !coachId) return;
    setActionErreur(null);
    setActionEnCours(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setActionEnCours(false);
      setActionErreur("Connexion indisponible. Rien n'a été modifié.");
      return;
    }
    const résultat = await setNutritionRecipeStatus(supabase, recipe.recipe.id, coachId, cible);
    setActionEnCours(false);
    if (!résultat.ok) {
      setActionErreur(résultat.message);
      return;
    }
    // L'état local suit le statut réellement écrit — la base peut refuser une
    // publication et conserver le brouillon.
    setState((courant) => (courant ? { ...courant, status: résultat.status } : courant));
    setBlockingIssue(résultat.blockingIssue);
    await refetch();
    await cycleDeVie.refetch();
  }

  /**
   * Duplique la recette en un BROUILLON indépendant : identifiants
   * d'ingrédients neufs, liaisons réécrites, `source_key` effacée. Passe par
   * la même RPC que n'importe quel enregistrement.
   */
  async function dupliquer() {
    if (!formulaire) return;
    setActionErreur(null);
    setActionEnCours(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setActionEnCours(false);
      setActionErreur("Connexion indisponible. Rien n'a été créé.");
      return;
    }
    const copie = duplicateRecipeForm(formulaire, duplicateName(formulaire.name));
    const résultat = await saveNutritionRecipe(supabase, toRecipeSavePayload(copie, "draft"));
    setActionEnCours(false);
    if (!résultat.ok) {
      setActionErreur(résultat.message);
      return;
    }
    router.push(`/admin/nutrition/recettes/${résultat.recipeId}`);
  }

  function lancerAction(action: RecipeLifecycleAction) {
    if (action === "duplicate") {
      void dupliquer();
      return;
    }
    const cible = recipeStatusAfter(action);
    if (cible) void changerStatut(cible);
  }

  /** Suppression définitive : le navigateur n'envoie que l'identifiant. */
  async function supprimerDéfinitivement() {
    if (!recipe) return;
    setSuppressionErreur(null);
    setActionEnCours(true);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setActionEnCours(false);
      setSuppressionErreur("Connexion indisponible. Rien n'a été supprimé.");
      return;
    }
    const résultat = await deleteNutritionRecipe(supabase, recipe.recipe.id);
    setActionEnCours(false);
    if (!résultat.ok) {
      setSuppressionErreur(
        describeRecipeDeletionBlock(résultat.reason, {
          studentsWithAccess: résultat.dependencies.studentsWithAccess,
        }),
      );
      await cycleDeVie.refetch();
      return;
    }
    setSuppressionOuverte(false);
    router.push("/admin/nutrition/recettes");
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

  const infoCycle = cycleDeVie.recipeInfo(recipe.recipe.id);
  // ABSENT ≠ SUPPRIMABLE : tant que l'aperçu n'a rien dit, on refuse.
  const motifBlocage =
    infoCycle === null
      ? "Les dépendances de cette recette n'ont pas encore été vérifiées. Recharge la page."
      : infoCycle.deletionBlock === null
        ? null
        : describeRecipeDeletionBlock(infoCycle.deletionBlock, infoCycle.dependencies);

  return (
    <div>
      {retour}

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
            {recipe.recipe.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {RECIPE_STATUS_LABELS_FR[recipe.status]}
            {infoCycle?.archivedAt ? ` le ${formaterDate(infoCycle.archivedAt)}` : ""}
            {" · "}
            {recipe.recipe.ingredients.length} ingrédient
            {recipe.recipe.ingredients.length > 1 ? "s" : ""}
            {recipe.status === "active" && (
              <>
                {" · "}
                {infoCycle?.dependencies.studentsWithAccess ?? 0} élève
                {(infoCycle?.dependencies.studentsWithAccess ?? 0) > 1 ? "s" : ""} y ont accès
              </>
            )}
          </p>
        </div>
        <LifecycleActionBar
          busy={actionEnCours || saving}
          actions={recipeLifecycleActions(recipe.status).map(
            (action): LifecycleActionSpec => ({
              key: action,
              label: RECIPE_ACTION_LABELS_FR[action],
              icon: ICÔNES_ACTION_RECETTE[action],
              onRun: () => lancerAction(action),
            }),
          )}
        />
      </div>

      {actionErreur && (
        <p className="mb-6 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {actionErreur}
        </p>
      )}

      {recipe.status !== "active" && (
        <p className="mb-6 rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-muted-foreground">
          {recipe.status === "draft"
            ? "Cette recette est un brouillon : elle n'apparaît dans le catalogue d'aucun élève."
            : "Cette recette est archivée : elle n'est plus proposée aux élèves. « Restaurer » la ramène en brouillon."}
        </p>
      )}

      <RecipeBuilder
        state={formulaire}
        onChange={setState}
        onSave={(status) => écrire(status)}
        saving={saving}
        saveError={saveError}
        blockingIssue={blockingIssue}
      />

      <div className="mt-8">
        <DangerZone description="La suppression définitive efface la recette, ses ingrédients et ses étiquettes. Elle est refusée tant qu'un élève peut encore l'ouvrir depuis son plan alimentaire — dépublie-la ou archive-la d'abord, ce qui suffit dans la plupart des cas.">
          <DeleteTriggerButton
            onOpen={() => {
              setSuppressionErreur(null);
              setSuppressionOuverte(true);
            }}
            disabled={actionEnCours || saving}
          />
        </DangerZone>
      </div>

      {suppressionOuverte && (
        <DeleteConfirmationModal
          resourceName={recipe.recipe.name}
          resourceKind="cette recette"
          dependencies={[
            { label: "Ingrédients", count: recipe.recipe.ingredients.length },
            { label: "Étiquettes", count: recipe.tags.length },
            {
              label: "Élèves pouvant y accéder",
              count: infoCycle?.dependencies.studentsWithAccess ?? 0,
            },
          ]}
          blockedReason={motifBlocage}
          sideEffect={describeRecipeDeletionSideEffects(
            recipe.recipe.ingredients.length,
            recipe.tags.length,
          )}
          deleting={actionEnCours}
          error={suppressionErreur}
          onCancel={() => setSuppressionOuverte(false)}
          onConfirm={supprimerDéfinitivement}
        />
      )}
    </div>
  );
}

/** Les icônes des actions de recette — définies hors du composant. */
const ICÔNES_ACTION_RECETTE: Record<RecipeLifecycleAction, ReactNode> = {
  publish: <Eye size={14} />,
  unpublish: <EyeOff size={14} />,
  archive: <Archive size={14} />,
  restore: <RotateCcw size={14} />,
  duplicate: <Copy size={14} />,
};

/** Date d'archivage lisible. `Intl` suffit : aucune dépendance ajoutée. */
function formaterDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" });
}
