"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { RecipeBuilder } from "@/components/admin/RecipeBuilder";
import {
  RecipeImageField,
  type PendingRecipeImage,
} from "@/components/admin/RecipeImageField";
import { useCurrentCoachId } from "@/hooks/useCurrentCoachId";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { saveNutritionRecipe } from "@/lib/supabase/nutrition-recipes-write";
import { attachRecipeImage } from "@/lib/supabase/storage-recipe-images";
import {
  createBlankRecipeForm,
  toRecipeSavePayload,
  type RecipeFormState,
} from "@/lib/nutrition/recipe-form";
import type { RecipeStatus } from "@/lib/nutrition/recipe-rows";
import { Loader } from "@/components/ui/Loader";

/**
 * Création d'une recette.
 *
 * UNE SEULE ÉCRITURE, UNE SEULE TRANSACTION : `save_nutrition_recipe`. La
 * ligne principale, les ingrédients et les étiquettes partent ensemble ; il
 * n'existe aucun chemin où une recette serait à moitié créée.
 *
 * ÉCHEC : le formulaire est conservé intégralement. On n'efface rien, on ne
 * recharge rien — le coach retrouve exactement sa saisie et le message
 * canonique de la base.
 *
 * LA PHOTO ARRIVE APRÈS, ET C'EST VOULU. Le chemin Storage d'une image
 * contient l'identifiant de la recette, et la policy d'écriture exige que
 * cette recette existe : rien ne peut donc être envoyé avant la création.
 * L'image choisie est optimisée puis GARDÉE EN MÉMOIRE, et n'est envoyée
 * qu'une fois l'identifiant obtenu. Si l'enregistrement échoue, aucun fichier
 * n'a été déposé — il n'y a pas d'orphelin à nettoyer, par construction.
 *
 * Si l'envoi de la photo échoue APRÈS la création, la recette existe sans
 * photo : on le dit, et on n'annule pas une création réussie pour une image
 * facultative.
 */
export default function AdminNutritionRecipeNewPage() {
  const router = useRouter();
  const { coachId, loading: coachLoading } = useCurrentCoachId();
  const [state, setState] = useState<RecipeFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [blockingIssue, setBlockingIssue] = useState<string | null>(null);
  // L'image optimisée, en attente de la naissance de la recette.
  const [photo, setPhoto] = useState<PendingRecipeImage | null>(null);

  // État construit à la DEMANDE, jamais dans un effet : pas de re-rendu
  // inutile, et aucune écriture au chargement.
  //
  // MÉMOÏSÉ : `createBlankRecipeForm` appelle `crypto.randomUUID()` pour son
  // ingrédient vide. Sans `useMemo`, chaque rendu — un clic sur « Enregistrer »
  // suffit — fabriquait un NOUVEL identifiant, la clé React de la ligne
  // changeait et le bloc était remonté pendant que la charge utile déjà
  // partie portait l'ancien.
  const vierge = useMemo(() => (coachId ? createBlankRecipeForm(coachId) : null), [coachId]);
  const formulaire = state ?? vierge;

  async function enregistrer(status: RecipeStatus) {
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
      // Le formulaire reste EXACTEMENT tel quel : rien n'est vidé.
      setSaveError(résultat.message);
      return;
    }
    setBlockingIssue(résultat.blockingIssue);

    // La recette existe : son identifiant permet enfin de composer le chemin
    // Storage. Un échec ici ne remet pas la création en cause — la fiche
    // s'ouvre, sans photo, et le coach la repose en un clic.
    if (photo !== null && coachId !== null) {
      const envoi = await attachRecipeImage(supabase, {
        recipeId: résultat.recipeId,
        coachId,
        blob: photo.blob,
        mime: photo.mime,
        fileId: crypto.randomUUID(),
      });
      URL.revokeObjectURL(photo.previewUrl);
      setPhoto(null);
      if (!envoi.ok) {
        setSaveError(`Recette créée, mais la photo n'a pas pu être envoyée : ${envoi.message}`);
      }
    }
    router.push(`/admin/nutrition/recettes/${résultat.recipeId}`);
  }

  if (coachLoading) {
    return <Loader libelle="Chargement…" variante="ligne" />;
  }

  if (!formulaire) {
    return (
      <div>
        <Link
          href="/admin/nutrition/recettes"
          className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Recettes
        </Link>
        <p className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning" role="status">
          Aucun coach n&apos;est identifié : impossible de créer une recette. Vérifie ta connexion
          puis recharge la page.
        </p>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/nutrition/recettes"
        className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft size={14} />
        Recettes
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Nouvelle recette
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Enregistre un brouillon à tout moment. L&apos;activation n&apos;est possible qu&apos;une
          fois la recette exploitable.
        </p>
      </div>

      <RecipeBuilder
        state={formulaire}
        onChange={setState}
        onSave={enregistrer}
        saving={saving}
        saveError={saveError}
        blockingIssue={blockingIssue}
        imageSlot={
          <RecipeImageField
            recipeId={null}
            coachId={coachId}
            imagePath={null}
            recipeName={formulaire.name}
            onPending={setPhoto}
            disabled={saving}
          />
        }
      />
    </div>
  );
}
