"use client";

import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from "lucide-react";

import { CheckboxField, Field, SelectField } from "@/components/admin/AdminFormFields";
import {
  dependentsOf,
  type RecipeFormIngredient,
  type RecipeFormIssue,
  type RecipeFormState,
} from "@/lib/nutrition/recipe-form";
import { RECIPE_ROLE_HINTS_FR, RECIPE_ROLE_LABELS_FR } from "@/lib/nutrition/recipe-labels";
import type { RecipeIngredientRole } from "@/lib/nutrition/recipe-types";

/**
 * Édition des ingrédients d'une recette.
 *
 * L'ORDRE DU TABLEAU EST L'ORDRE AFFICHÉ, et les positions sont renumérotées
 * en continu (1..N) au moment de la sauvegarde par `toRecipeSavePayload` —
 * jamais de doublon, jamais de trou, quelles qu'aient été les manipulations.
 *
 * RETRAIT D'UN INGRÉDIENT RÉFÉRENCÉ : l'interface AVERTIT avant, en nommant
 * les ingrédients qui en dépendent. Le retrait rompt alors leurs liaisons
 * explicitement — jamais de parent pendant.
 *
 * Les rôles viennent de `recipe-types.ts` (PR A) : aucune liste réécrite ici.
 */

const ROLE_OPTIONS: { value: RecipeIngredientRole; label: string }[] = (
  ["protein", "carbohydrate", "fat", "fixed", "free"] as const
).map((role) => ({ value: role, label: RECIPE_ROLE_LABELS_FR[role] }));

function ErreurChamp({ issues, field }: { issues: readonly RecipeFormIssue[]; field: string }) {
  const erreur = issues.find((i) => i.field === field);
  if (!erreur) return null;
  return (
    <p className="mt-1 text-xs text-destructive" role="alert">
      {erreur.message}
    </p>
  );
}

export function RecipeIngredientsPanel({
  state,
  issues,
  onAdd,
  onDuplicate,
  onRemove,
  onMove,
  onChange,
}: {
  state: RecipeFormState;
  issues: readonly RecipeFormIssue[];
  onAdd: () => void;
  onDuplicate: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onChange: (id: string, patch: Partial<RecipeFormIngredient>) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {state.ingredients.length === 0 && (
        <p className="rounded-panel border border-border bg-surface-soft/50 px-4 py-6 text-center text-sm text-muted-foreground">
          Aucun ingrédient. Ajoute-en un pour commencer.
        </p>
      )}

      {state.ingredients.map((ing, index) => {
        const erreurs = issues.filter((i) => i.ingredientId === ing.id);
        const dépendants = dependentsOf(state, ing.id);
        const liables = state.ingredients.filter((autre) => autre.id !== ing.id);

        return (
          <div
            key={ing.id}
            className="flex flex-col gap-4 rounded-panel border border-border bg-surface-soft/40 p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Ingrédient {index + 1}
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => onMove(ing.id, -1)}
                  disabled={index === 0}
                  aria-label={`Monter ${ing.name || `l'ingrédient ${index + 1}`}`}
                  className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onMove(ing.id, 1)}
                  disabled={index === state.ingredients.length - 1}
                  aria-label={`Descendre ${ing.name || `l'ingrédient ${index + 1}`}`}
                  className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onDuplicate(ing.id)}
                  aria-label={`Dupliquer ${ing.name || `l'ingrédient ${index + 1}`}`}
                  className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Copy size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(ing.id)}
                  aria-label={`Retirer ${ing.name || `l'ingrédient ${index + 1}`}`}
                  className="pressable flex h-11 w-11 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-destructive hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {dépendants.length > 0 && (
              <p className="rounded-panel border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                {dépendants.length === 1 ? "Un ingrédient dépend" : `${dépendants.length} ingrédients dépendent`}
                {" "}de celui-ci ({dépendants.map((d) => d.name || "sans nom").join(", ")}). Le retirer
                romprait {dépendants.length === 1 ? "sa liaison" : "leurs liaisons"}.
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Field
                  label="Nom"
                  value={ing.name}
                  onChange={(v) => onChange(ing.id, { name: v })}
                  placeholder="Blanc de poulet"
                />
                <ErreurChamp issues={erreurs} field="name" />
              </div>
              <div>
                <SelectField
                  label="Rôle"
                  value={ing.role}
                  onChange={(v) => onChange(ing.id, { role: v as RecipeIngredientRole })}
                  options={ROLE_OPTIONS}
                />
                <p className="mt-1 text-xs text-muted-foreground">{RECIPE_ROLE_HINTS_FR[ing.role]}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Valeurs pour 100 g cru
              </p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Field
                    label="Protéines (g)"
                    value={ing.proteinPer100g}
                    onChange={(v) => onChange(ing.id, { proteinPer100g: v })}
                    type="number"
                    step="0.1"
                  />
                  <ErreurChamp issues={erreurs} field="proteinPer100g" />
                </div>
                <div>
                  <Field
                    label="Glucides (g)"
                    value={ing.carbPer100g}
                    onChange={(v) => onChange(ing.id, { carbPer100g: v })}
                    type="number"
                    step="0.1"
                  />
                  <ErreurChamp issues={erreurs} field="carbPer100g" />
                </div>
                <div>
                  <Field
                    label="Lipides (g)"
                    value={ing.fatPer100g}
                    onChange={(v) => onChange(ing.id, { fatPer100g: v })}
                    type="number"
                    step="0.1"
                  />
                  <ErreurChamp issues={erreurs} field="fatPer100g" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Field
                  label="Quantité de référence (g)"
                  value={ing.referenceGrams}
                  onChange={(v) => onChange(ing.id, { referenceGrams: v })}
                  type="number"
                  step="1"
                />
                <ErreurChamp issues={erreurs} field="referenceGrams" />
              </div>
              <div>
                <Field
                  label="Minimum (g)"
                  value={ing.minGrams}
                  onChange={(v) => onChange(ing.id, { minGrams: v })}
                  type="number"
                  step="1"
                  placeholder="aucun"
                />
                <ErreurChamp issues={erreurs} field="minGrams" />
              </div>
              <Field
                label="Maximum (g)"
                value={ing.maxGrams}
                onChange={(v) => onChange(ing.id, { maxGrams: v })}
                type="number"
                step="1"
                placeholder="aucun"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <CheckboxField
                  label="Compté en unités entières (pain, wrap…)"
                  checked={ing.unitScalable}
                  onChange={(checked) => onChange(ing.id, { unitScalable: checked })}
                />
                {ing.unitScalable && (
                  <>
                    <Field
                      label="Nom de l'unité"
                      value={ing.unitName}
                      onChange={(v) => onChange(ing.id, { unitName: v })}
                      placeholder="wrap"
                    />
                    <ErreurChamp issues={erreurs} field="unitName" />
                    <Field
                      label="Nombre maximal d'unités"
                      value={ing.maxUnits}
                      onChange={(v) => onChange(ing.id, { maxUnits: v })}
                      type="number"
                      step="1"
                      placeholder="2"
                    />
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <CheckboxField
                  label="Affiché en nombre d'œufs"
                  checked={ing.egg}
                  onChange={(checked) => onChange(ing.id, { egg: checked })}
                />
                {ing.egg && (
                  <Field
                    label="Poids d'un œuf (g)"
                    value={ing.eggGrams}
                    onChange={(v) => onChange(ing.id, { eggGrams: v })}
                    type="number"
                    step="1"
                    placeholder="50"
                  />
                )}
                <Field
                  label="Libellé fixe (facultatif)"
                  value={ing.fixedLabel}
                  onChange={(v) => onChange(ing.id, { fixedLabel: v })}
                  placeholder="1 tranche (fixe)"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <SelectField
                  label="Lié à un autre ingrédient"
                  value={ing.linkedToIngredientId ?? ""}
                  onChange={(v) =>
                    onChange(ing.id, { linkedToIngredientId: v === "" ? null : v })
                  }
                  options={[
                    { value: "", label: "Aucune liaison" },
                    ...liables.map((autre) => ({
                      value: autre.id,
                      label: autre.name || "Ingrédient sans nom",
                    })),
                  ]}
                />
                <ErreurChamp issues={erreurs} field="linkedToIngredientId" />
              </div>
              {ing.linkedToIngredientId !== null && (
                <div>
                  <Field
                    label="Part du parent (points de base, 1 500 = 15 %)"
                    value={ing.linkRatioBp}
                    onChange={(v) => onChange(ing.id, { linkRatioBp: v })}
                    type="number"
                    step="1"
                  />
                  <ErreurChamp issues={erreurs} field="linkRatioBp" />
                </div>
              )}
            </div>
          </div>
        );
      })}

      <button
        type="button"
        onClick={onAdd}
        className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-dashed border-border px-4 py-3 text-xs font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Plus size={14} />
        Ajouter un ingrédient
      </button>
    </div>
  );
}
