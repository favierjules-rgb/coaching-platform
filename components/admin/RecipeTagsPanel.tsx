"use client";

import { CheckboxField } from "@/components/admin/AdminFormFields";
import { RECIPE_TAG_KINDS, type RecipeTagKind } from "@/lib/nutrition/recipe-rows";
import { RECIPE_TAG_KIND_LABELS_FR, tagOptionsFor } from "@/lib/nutrition/recipe-labels";
import { hasTag, type RecipeFormState } from "@/lib/nutrition/recipe-form";

/**
 * Étiquettes d'une recette — VOCABULAIRE CONTRÔLÉ, aucun champ libre.
 *
 * Il n'existe volontairement aucune saisie de texte ici : les seules valeurs
 * possibles sont celles de `RECIPE_TAG_VOCABULARY`, rendues avec leur libellé
 * français. Les CLÉS TECHNIQUES sont ce qui part en base ; le français ne sert
 * qu'à l'écran.
 *
 * Comparer du texte libre de profil à un nom d'ingrédient produirait des faux
 * négatifs — sur des ALLERGIES. C'est pour cela que ce panneau n'offre aucun
 * moyen d'inventer une valeur.
 */
const AIDE: Readonly<Record<RecipeTagKind, string>> = {
  allergen: "Ce que la recette CONTIENT. Sert à écarter la recette d'un élève allergique.",
  intolerance: "Ce que la recette CONTIENT, au sens des intolérances digestives.",
  diet: "Régimes avec lesquels la recette est COMPATIBLE — sémantique inverse des trois autres.",
  excludes: "Catégories d'aliment présentes, pour les exclusions personnelles.",
};

export function RecipeTagsPanel({
  state,
  onToggle,
}: {
  state: RecipeFormState;
  onToggle: (kind: RecipeTagKind, value: string, checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      {RECIPE_TAG_KINDS.map((kind) => {
        const options = tagOptionsFor(kind);
        const nb = state.tags.filter((t) => t.kind === kind).length;
        return (
          <fieldset key={kind} className="rounded-panel border border-border bg-surface-soft/40 p-4">
            <legend className="px-2 text-xs font-bold uppercase tracking-widest text-foreground">
              {RECIPE_TAG_KIND_LABELS_FR[kind]}
              {nb > 0 && <span className="ml-2 font-normal text-muted-foreground">({nb})</span>}
            </legend>
            <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{AIDE[kind]}</p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
              {options.map((option) => (
                <CheckboxField
                  key={`${kind}-${option.value}`}
                  label={option.label}
                  checked={hasTag(state, kind, option.value)}
                  onChange={(checked) => onToggle(kind, option.value, checked)}
                />
              ))}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}
