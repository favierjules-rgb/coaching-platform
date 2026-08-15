"use client";

import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { MealChoiceListsPanel } from "@/components/admin/MealChoiceListsPanel";
import type { SnapshotDeListe } from "@/lib/supabase/food-lists";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { MEAL_SLOT_KEYS, MEAL_SLOT_LABELS_FR, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type { PrescribedMeal } from "@/lib/nutrition/plan-v2-week";
import { itemsToText, textToItems } from "@/lib/nutrition/plan-v2-week-form";

/**
 * ZONE 3 — LES REPAS PRESCRITS DU JOUR OUVERT.
 *
 * Outil ENTIÈREMENT MANUEL : moment, nom du repas, aliments un par ligne,
 * notes coach, suppression. Ce que le coach écrit est ce que l'élève lira.
 *
 * PAS DE KCAL NI DE MACROS PAR REPAS. Elles étaient saisies quatre fois par
 * repas alors que le jour ouvert les définit déjà, deux zones plus haut :
 * les calories et la répartition P/G/L en zone 1, la part de chaque créneau
 * en zone 2. Redemander les mêmes chiffres au niveau du repas, c'était offrir
 * au coach l'occasion de se contredire lui-même — et l'obliger à ressaisir à
 * la main ce que le système calcule déjà.
 *
 * Les champs `calories`, `protein`, `carbs` et `fat` restent dans le modèle et
 * dans la charge utile : un repas enregistré avant ce changement conserve ses
 * valeurs, et rien n'a besoin d'être migré. Un repas créé maintenant les porte
 * simplement à zéro, et l'écran élève n'affiche alors aucune ligne de macros.
 *
 * `solveRecipe` n'est PAS appelé ici, et la bibliothèque de recettes n'est pas
 * lue : ce sont deux autres outils. Les repas appartiennent directement au
 * jour ouvert, sans sélecteur de profil au-dessus d'eux.
 */

const SLOT_OPTIONS = MEAL_SLOT_KEYS.map((slot) => ({
  value: slot,
  label: MEAL_SLOT_LABELS_FR[slot],
}));

function MealEditor({
  meal,
  onChange,
  onRemove,
  occurrences,
}: {
  meal: PrescribedMeal;
  onChange: (patch: Partial<Omit<PrescribedMeal, "id">>) => void;
  onRemove: () => void;
  occurrences: GestesOccurrences;
}) {
  // Le texte brut des aliments est tenu en état local, distinct de
  // `meal.items` : reparser puis reformater à chaque frappe casserait la
  // saisie (retours à la ligne, lignes vides en cours de frappe). On ne
  // convertit qu'à la perte de focus.
  const [texteAliments, setTexteAliments] = useState(() => itemsToText(meal.items));

  return (
    <div className="min-w-0 rounded-panel border border-border bg-surface-soft/40 p-4">
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
      <div className="flex min-w-0 flex-col gap-3">
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
        <TextareaField
          label="Notes coach"
          value={meal.coachNotes}
          onChange={(v) => onChange({ coachNotes: v })}
          rows={2}
        />
        {/* N1.3 — les listes viennent APRÈS les réglages du repas, et elles
            sont facultatives : un repas à zéro occurrence reste le cas
            normal, et rien ici n'en impose une. */}
        <MealChoiceListsPanel
          occurrences={meal.choiceSlots}
          onAjouter={(snapshot) => occurrences.onAjouter(meal.id, snapshot)}
          onRemplacer={(slotId, snapshot) => occurrences.onRemplacer(meal.id, slotId, snapshot)}
          onRetirer={(slotId) => occurrences.onRetirer(meal.id, slotId)}
          onDeplacer={(slotId, direction) => occurrences.onDeplacer(meal.id, slotId, direction)}
        />
      </div>
    </div>
  );
}

/**
 * N1.3 — les quatre gestes sur les occurrences, remontés au panneau semaine
 * qui détient l'état. Ce composant n'écrit rien lui-même : il transmet.
 */
export interface GestesOccurrences {
  readonly onAjouter: (mealId: string, snapshot: SnapshotDeListe) => void;
  readonly onRemplacer: (mealId: string, slotId: string, snapshot: SnapshotDeListe) => void;
  readonly onRetirer: (mealId: string, slotId: string) => void;
  readonly onDeplacer: (mealId: string, slotId: string, direction: -1 | 1) => void;
}

export function NutritionDayManualMeals({
  meals,
  onAdd,
  onUpdate,
  onRemove,
  occurrences,
}: {
  readonly meals: readonly PrescribedMeal[];
  readonly onAdd: () => void;
  readonly onUpdate: (mealId: string, patch: Partial<Omit<PrescribedMeal, "id">>) => void;
  readonly onRemove: (mealId: string) => void;
  readonly occurrences: GestesOccurrences;
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
            occurrences={occurrences}
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
