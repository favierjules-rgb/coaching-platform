"use client";

import { useMemo, useState } from "react";
import { Archive, Save } from "lucide-react";

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
  onArchive,
  saving,
  saveError,
  blockingIssue,
}: {
  state: RecipeFormState;
  onChange: (next: RecipeFormState) => void;
  onSave: (status: RecipeStatus) => void | Promise<void>;
  onArchive?: () => void | Promise<void>;
  saving: boolean;
  saveError: string | null;
  blockingIssue: string | null;
}) {
  const [retraitDemandé, setRetraitDemandé] = useState<string | null>(null);
  const [archivageDemandé, setArchivageDemandé] = useState(false);

  const issues = useMemo(() => validateRecipeForm(state), [state]);
  const bloquant = issues.length > 0;
  const dépendants = retraitDemandé ? dependentsOf(state, retraitDemandé) : [];

  function retirer(id: string) {
    if (dependentsOf(state, id).length > 0) {
      setRetraitDemandé(id);
      return;
    }
    onChange(removeIngredient(state, id));
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
              onChange={(v) => onChange({ ...state, name: v })}
              placeholder="Bol riz poulet curry"
              required
            />
            {issues.some((i) => i.code === "name_empty") && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                Donne un nom à la recette.
              </p>
            )}
          </div>
          <TextareaField
            label="Description"
            value={state.description}
            onChange={(v) => onChange({ ...state, description: v })}
            rows={2}
            placeholder="Notes de préparation, remarques pour l'élève…"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Créneau conseillé"
              value={state.slotKey ?? ""}
              onChange={(v) => onChange({ ...state, slotKey: v === "" ? null : (v as RecipeSlotKey) })}
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

      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h2 className="mb-4 font-heading text-base font-bold uppercase text-foreground">Ingrédients</h2>
        <RecipeIngredientsPanel
          state={state}
          issues={issues}
          onAdd={() => onChange(addIngredient(state))}
          onDuplicate={(id) => onChange(duplicateIngredient(state, id))}
          onRemove={retirer}
          onMove={(id, direction) => onChange(moveIngredient(state, id, direction))}
          onChange={(id, patch: Partial<RecipeFormIngredient>) =>
            onChange(updateIngredient(state, id, patch))
          }
        />
      </section>

      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h2 className="mb-4 font-heading text-base font-bold uppercase text-foreground">Étiquettes</h2>
        <RecipeTagsPanel
          state={state}
          onToggle={(kind: RecipeTagKind, value: string, checked: boolean) =>
            onChange(toggleTag(state, kind, value, checked))
          }
        />
      </section>

      <RecipeAdaptivePreview state={state} />

      <RecipeValidationSummary issues={issues} blockingIssue={blockingIssue} saveError={saveError} />

      {/* Boutons natifs plutôt que PrimaryButton/OutlineButton : ces derniers
          sont pleine largeur et sans état désactivé — ils conviennent aux
          modales, pas à une barre d'actions. On ne les modifie pas : ils sont
          partagés par d'autres écrans. */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave("draft")}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Save size={14} />
          {saving ? "Enregistrement…" : "Enregistrer le brouillon"}
        </button>
        <button
          type="button"
          disabled={saving || bloquant}
          onClick={() => onSave("active")}
          title={bloquant ? "Complète la recette avant de l'activer." : undefined}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Activer la recette
        </button>
        {onArchive && state.recipeId && state.status !== "archived" && (
          <button
            type="button"
            disabled={saving}
            onClick={() => setArchivageDemandé(true)}
            className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-border px-4 py-2 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-destructive hover:text-destructive disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <Archive size={14} />
            Archiver
          </button>
        )}
      </div>
      {bloquant && (
        <p className="text-xs text-muted-foreground">
          L&apos;activation reste possible une fois les points ci-dessus complétés. Le brouillon,
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
                onChange(removeIngredient(state, retraitDemandé));
                setRetraitDemandé(null);
              }}
            >
              Retirer et rompre {dépendants.length === 1 ? "la liaison" : "les liaisons"}
            </PrimaryButton>
            <OutlineButton onClick={() => setRetraitDemandé(null)}>Annuler</OutlineButton>
          </div>
        </Modal>
      )}

      {archivageDemandé && onArchive && (
        <Modal title="Archiver cette recette ?" onClose={() => setArchivageDemandé(false)}>
          <p className="text-sm text-muted-foreground">
            La recette est conservée en base et reste consultable. Elle ne sera plus proposée.
            Aucune suppression définitive n&apos;est possible depuis cette page.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <PrimaryButton
              onClick={() => {
                setArchivageDemandé(false);
                void onArchive();
              }}
            >
              Archiver
            </PrimaryButton>
            <OutlineButton onClick={() => setArchivageDemandé(false)}>Annuler</OutlineButton>
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Charge utile de sauvegarde — réexportée pour que les pages n'aient pas à la reconstruire. */
export { toRecipeSavePayload };
