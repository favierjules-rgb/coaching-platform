"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Save } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, OutlineButton, PrimaryButton } from "@/components/admin/Modal";
import { RecipeAdaptivePreview } from "@/components/admin/RecipeAdaptivePreview";
import { RecipeIngredientsPanel } from "@/components/admin/RecipeIngredientsPanel";
import { RecipeTagsPanel } from "@/components/admin/RecipeTagsPanel";
import { RecipeValidationSummary } from "@/components/admin/RecipeValidationSummary";
import {
  addIngredient,
  dependentsOf,
  duplicateIngredient,
  moveIngredient,
  removeIngredient,
  toRecipeSavePayload,
  toggleTag,
  updateIngredient,
  validateRecipeForm,
  type RecipeFormIngredient,
  type RecipeFormState,
} from "@/lib/nutrition/recipe-form";
import { RECIPE_SLOT_LABELS_FR, RECIPE_STATUS_LABELS_FR } from "@/lib/nutrition/recipe-labels";
import {
  RECIPE_SLOT_KEYS,
  type RecipeSlotKey,
  type RecipeStatus,
  type RecipeTagKind,
} from "@/lib/nutrition/recipe-rows";

/**
 * Formulaire complet d'une recette.
 *
 * TOUTE LA LOGIQUE EST PURE et vit dans `lib/nutrition/recipe-form.ts` : ce
 * composant ne fait qu'appeler ces fonctions et rendre l'état. C'est ce qui
 * rend le comportement testable sans rendu.
 *
 * SAUVEGARDE : un seul appel, une seule transaction — `save_nutrition_recipe`.
 * Jamais d'enchaînement `insert()/update()/delete()` depuis le navigateur.
 *
 * ÉCHEC DE SAUVEGARDE : le formulaire est CONSERVÉ tel quel. Rien n'est vidé,
 * rien n'est rechargé de force — la saisie du coach lui appartient.
 */

const SLOT_OPTIONS = [
  { value: "", label: "Toutes les occasions (recette générique)" },
  ...RECIPE_SLOT_KEYS.map((slot) => ({ value: slot, label: RECIPE_SLOT_LABELS_FR[slot] })),
];

export function RecipeBuilder({
  state,
  onChange,
  onSave,
  saving,
  saveError,
  blockingIssue,
  imageSlot,
}: {
  state: RecipeFormState;
  onChange: (next: RecipeFormState) => void;
  onSave: (status: RecipeStatus) => void | Promise<void>;
  saving: boolean;
  saveError: string | null;
  blockingIssue: string | null;
  /**
   * La zone « Photo de la recette », injectée par la page.
   *
   * POURQUOI UN EMPLACEMENT ET NON UN CHAMP. La photo ne fait pas partie de
   * `RecipeFormState` : elle ne part jamais dans `save_nutrition_recipe`, et
   * son écriture (Storage + RPC dédiée) demande un client Supabase. Ce
   * composant, lui, est resté purement présentationnel depuis la PR B — il
   * n'importe rien de `lib/supabase`, ce qui le rend testable sans base. Un
   * emplacement préserve cette propriété.
   */
  imageSlot?: ReactNode;
}) {
  const [retraitDemandé, setRetraitDemandé] = useState<string | null>(null);

  // Une recette VIERGE affichait sept messages d'erreur avant la première
  // frappe : accueil hostile, et sept `role="alert"` annoncés en rafale par un
  // lecteur d'écran. On attend donc une interaction — ou une tentative
  // d'enregistrement. Sur une recette EXISTANTE, au contraire, les points à
  // compléter sont une information utile dès l'ouverture.
  const [interagi, setInteragi] = useState(false);

  const issues = useMemo(() => validateRecipeForm(state), [state]);
  const bloquant = issues.length > 0;
  const afficherValidation = interagi || state.recipeId !== null;
  const issuesAffichées = afficherValidation ? issues : [];
  const dépendants = retraitDemandé ? dependentsOf(state, retraitDemandé) : [];

  // Toute modification vient d'ici : l'état « le coach a commencé » est donc
  // exact, sans dépendre du focus ni d'un `onBlur` par champ.
  function modifier(next: RecipeFormState) {
    setInteragi(true);
    onChange(next);
  }

  function enregistrer(status: RecipeStatus) {
    setInteragi(true);
    void onSave(status);
  }

  function retirer(id: string) {
    if (dependentsOf(state, id).length > 0) {
      setRetraitDemandé(id);
      return;
    }
    modifier(removeIngredient(state, id));
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h2 className="mb-4 font-heading text-base font-bold uppercase text-foreground">Informations</h2>
        <div className="flex flex-col gap-4">
          <div>
            <Field
              label="Nom de la recette"
              value={state.name}
              onChange={(v) => modifier({ ...state, name: v })}
              placeholder="Bol riz poulet curry"
              required
            />
            {issuesAffichées.some((i) => i.code === "name_empty") && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                Donne un nom à la recette.
              </p>
            )}
          </div>
          <TextareaField
            label="Description"
            value={state.description}
            onChange={(v) => modifier({ ...state, description: v })}
            rows={2}
            placeholder="Notes de préparation, remarques pour l'élève…"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Créneau conseillé"
              value={state.slotKey ?? ""}
              onChange={(v) => modifier({ ...state, slotKey: v === "" ? null : (v as RecipeSlotKey) })}
              options={SLOT_OPTIONS}
            />
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Statut actuel</p>
              <p className="rounded-control border border-border bg-surface-soft px-4 py-3 text-sm text-foreground">
                {RECIPE_STATUS_LABELS_FR[state.status]}
                {state.sourceKey && (
                  <span className="ml-2 text-xs text-muted-foreground">· importée ({state.sourceKey})</span>
                )}
              </p>
            </div>
          </div>
        </div>
      </section>

      {imageSlot}

      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h2 className="mb-4 font-heading text-base font-bold uppercase text-foreground">Ingrédients</h2>
        <RecipeIngredientsPanel
          state={state}
          issues={issuesAffichées}
          onAdd={() => modifier(addIngredient(state))}
          onDuplicate={(id) => modifier(duplicateIngredient(state, id))}
          onRemove={retirer}
          onMove={(id, direction) => modifier(moveIngredient(state, id, direction))}
          onChange={(id, patch: Partial<RecipeFormIngredient>) =>
            modifier(updateIngredient(state, id, patch))
          }
        />
      </section>

      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h2 className="mb-4 font-heading text-base font-bold uppercase text-foreground">Étiquettes</h2>
        <RecipeTagsPanel
          state={state}
          onToggle={(kind: RecipeTagKind, value: string, checked: boolean) =>
            modifier(toggleTag(state, kind, value, checked))
          }
        />
      </section>

      <RecipeAdaptivePreview state={state} />

      {/* Sur un formulaire VIERGE, on ne dit ni « exploitable » (ce serait
          faux) ni « 7 points à compléter » (ce serait hostile avant la
          première frappe). On indique quoi faire. */}
      {afficherValidation ? (
        <RecipeValidationSummary
          issues={issuesAffichées}
          blockingIssue={blockingIssue}
          saveError={saveError}
        />
      ) : (
        <p className="rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-muted-foreground">
          Renseigne le nom de la recette, puis ses ingrédients et leurs valeurs pour 100 g. Les
          points à compléter s&apos;afficheront au fil de la saisie.
        </p>
      )}

      {/* Boutons natifs plutôt que PrimaryButton/OutlineButton : ces derniers
          sont pleine largeur et sans état désactivé — ils conviennent aux
          modales, pas à une barre d'actions. On ne les modifie pas : ils sont
          partagés par d'autres écrans. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => enregistrer("draft")}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Save size={14} />
          {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
        </button>
        {/* « Enregistrer et publier » plutôt que « Activer la recette » : ce
            bouton fait DEUX choses — il enregistre la saisie en cours, puis
            publie. Les transitions de statut SEULES (publier, dépublier,
            archiver, restaurer) vivent dans la barre de cycle de vie, en haut
            de la page, et n'écrivent aucun champ du formulaire. */}
        <button
          type="button"
          disabled={saving || bloquant}
          onClick={() => enregistrer("active")}
          title={bloquant ? "Complète la recette avant de la publier." : undefined}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Enregistrer et publier
        </button>
      </div>
      {bloquant && (
        <p className="text-xs text-muted-foreground">
          La publication reste possible une fois les points ci-dessus complétés. Le brouillon,
          lui, s&apos;enregistre à tout moment.
        </p>
      )}

      {retraitDemandé && (
        <Modal title="Retirer cet ingrédient ?" onClose={() => setRetraitDemandé(null)}>
          <p className="text-sm text-muted-foreground">
            {dépendants.length === 1 ? "Un ingrédient dépend" : `${dépendants.length} ingrédients dépendent`}
            {" "}de celui-ci : {dépendants.map((d) => d.name || "sans nom").join(", ")}.
            {" "}
            {dépendants.length === 1 ? "Sa liaison sera retirée" : "Leurs liaisons seront retirées"}.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <PrimaryButton
              onClick={() => {
                modifier(removeIngredient(state, retraitDemandé));
                setRetraitDemandé(null);
              }}
            >
              Retirer et rompre {dépendants.length === 1 ? "la liaison" : "les liaisons"}
            </PrimaryButton>
            <OutlineButton onClick={() => setRetraitDemandé(null)}>Annuler</OutlineButton>
          </div>
        </Modal>
      )}

    </div>
  );
}

/** Charge utile de sauvegarde — réexportée pour que les pages n'aient pas à la reconstruire. */
export { toRecipeSavePayload };
