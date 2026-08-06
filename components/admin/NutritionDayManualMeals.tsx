"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { MEAL_SLOT_KEYS, MEAL_SLOT_LABELS_FR, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type { PrescribedMeal } from "@/lib/nutrition/plan-v2-week";
import { itemsToText, textToItems } from "@/lib/nutrition/plan-v2-week-form";

/**
 * ZONE 3 — LES REPAS PRESCRITS DU JOUR OUVERT.
 *
 * Outil ENTIÈREMENT MANUEL, repris à l'identique de l'existant : moment, nom,
 * aliments un par ligne, kcal, P, G, L, notes coach, suppression. Ce que le
 * coach écrit est ce que l'élève lira.
 *
 * `solveRecipe` n'est PAS appelé ici, et la bibliothèque de recettes n'est pas
 * lue : ce sont deux autres outils. Seule différence avec la version
 * précédente : les repas appartiennent directement au jour ouvert, il n'y a
 * plus de sélecteur de profil au-dessus d'eux.
 */

const SLOT_OPTIONS = MEAL_SLOT_KEYS.map((slot) => ({
  value: slot,
  label: MEAL_SLOT_LABELS_FR[slot],
}));

function MealEditor({
  meal,
  onChange,
  onRemove,
}: {
  meal: PrescribedMeal;
  onChange: (patch: Partial<Omit<PrescribedMeal, "id">>) => void;
  onRemove: () => void;
}) {
  // Le texte brut des aliments est tenu en état local, distinct de
  // `meal.items` : reparser puis reformater à chaque frappe casserait la
  // saisie (retours à la ligne, lignes vides en cours de frappe). On ne
  // convertit qu'à la perte de focus.
  const [texteAliments, setTexteAliments] = useState(() => itemsToText(meal.items));

  return (
    <div className="rounded-panel border border-border bg-surface-soft/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Repas</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Supprimer ce repas"
          className="pressable flex h-11 w-11 items-center justify-center rounded-control text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Moment"
            value={meal.slot}
            onChange={(v) => onChange({ slot: v as MealSlotKey })}
            options={SLOT_OPTIONS}
          />
          <Field label="Nom du repas" value={meal.name} onChange={(v) => onChange({ name: v })} />
        </div>
        <TextareaField
          label="Aliments (un par ligne — Nom — quantité)"
          value={texteAliments}
          onChange={setTexteAliments}
          onBlur={() => onChange({ items: textToItems(texteAliments) })}
          rows={3}
          placeholder={"Blanc de poulet — 150 g\nRiz basmati — 100 g cru"}
        />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field
            label="Kcal"
            type="number"
            value={String(meal.calories)}
            onChange={(v) => onChange({ calories: Number(v) || 0 })}
          />
          <Field
            label="Prot (g)"
            type="number"
            value={String(meal.protein)}
            onChange={(v) => onChange({ protein: Number(v) || 0 })}
          />
          <Field
            label="Gluc (g)"
            type="number"
            value={String(meal.carbs)}
            onChange={(v) => onChange({ carbs: Number(v) || 0 })}
          />
          <Field
            label="Lip (g)"
            type="number"
            value={String(meal.fat)}
            onChange={(v) => onChange({ fat: Number(v) || 0 })}
          />
        </div>
        <TextareaField
          label="Notes coach"
          value={meal.coachNotes}
          onChange={(v) => onChange({ coachNotes: v })}
          rows={2}
        />
      </div>
    </div>
  );
}

export function NutritionDayManualMeals({
  meals,
  onAdd,
  onUpdate,
  onRemove,
}: {
  readonly meals: readonly PrescribedMeal[];
  readonly onAdd: () => void;
  readonly onUpdate: (mealId: string, patch: Partial<Omit<PrescribedMeal, "id">>) => void;
  readonly onRemove: (mealId: string) => void;
}) {
  const titreId = useId();

  return (
    <section aria-labelledby={titreId} className="rounded-panel border border-border p-4 sm:p-5">
      <h3 id={titreId} className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Repas prescrits
      </h3>

      <div className="flex flex-col gap-3">
        {meals.map((repas) => (
          <MealEditor
            key={repas.id}
            meal={repas}
            onChange={(patch) => onUpdate(repas.id, patch)}
            onRemove={() => onRemove(repas.id)}
          />
        ))}

        <button
          type="button"
          onClick={onAdd}
          className="pressable flex min-h-11 items-center justify-center gap-2 rounded-control border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Plus size={14} />
          Ajouter un repas
        </button>
      </div>
    </section>
  );
}
