"use client";

import { useState } from "react";
import { ArrowRight, Copy, Plus, Trash2 } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { PrimaryButton } from "@/components/admin/Modal";
import { generateId, mealSlots, weekDays } from "@/lib/admin";
import type { AdminContentStatus, AdminMeal, AdminMealFoodItem, AdminNutritionDay, NutritionGoalType } from "@/types";

const goalOptions: { value: NutritionGoalType; label: string }[] = [
  { value: "perte-de-poids", label: "Perte de poids" },
  { value: "maintien", label: "Maintien" },
  { value: "prise-de-masse", label: "Prise de masse" },
  { value: "performance", label: "Performance" },
];

const statusOptions: { value: AdminContentStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "actif", label: "Actif" },
  { value: "archivé", label: "Archivé" },
];

export interface NutritionPlanBuilderData {
  name: string;
  goalType: NutritionGoalType;
  caloriesPerDay: number;
  protein: number;
  carbs: number;
  fat: number;
  weeklyTargetCalories: number;
  status: AdminContentStatus;
  coachNotes: string;
  hydrationTip: string;
  supplements: string[];
  shoppingList: string[];
  days: AdminNutritionDay[];
}

function itemsToText(items: AdminMealFoodItem[]): string {
  return items.map((i) => `${i.name} - ${i.quantity}`).join("\n");
}

function textToItems(text: string): AdminMealFoodItem[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, quantity = ""] = line.split(" - ");
      return { name: name.trim(), quantity: quantity.trim() };
    });
}

function blankMeal(): AdminMeal {
  return {
    id: generateId("meal"),
    slot: "Petit déjeuner",
    name: "",
    items: [],
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    coachNotes: "",
  };
}

function MealEditor({
  meal,
  onChange,
  onRemove,
}: {
  meal: AdminMeal;
  onChange: (partial: Partial<AdminMeal>) => void;
  onRemove: () => void;
}) {
  // Le texte brut des aliments est tenu en état local, distinct de
  // meal.items : reparser puis reformater (itemsToText(textToItems(v))) à
  // chaque frappe casse la saisie (retours à la ligne, espaces, lignes
  // vides en cours de frappe supprimés par le round-trip). On ne convertit
  // vers AdminMealFoodItem[] qu'à la perte de focus.
  const [itemsText, setItemsText] = useState(() => itemsToText(meal.items));

  return (
    <div className="border border-border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">Repas</span>
        <button type="button" onClick={onRemove} className="text-red-400 hover:text-red-300">
          <Trash2 size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <SelectField
            label="Moment"
            value={meal.slot}
            onChange={(v) => onChange({ slot: v as AdminMeal["slot"] })}
            options={mealSlots.map((s) => ({ value: s, label: s }))}
          />
          <Field label="Nom du repas" value={meal.name} onChange={(v) => onChange({ name: v })} />
        </div>
        <TextareaField
          label="Aliments (un par ligne — Nom - quantité)"
          value={itemsText}
          onChange={setItemsText}
          onBlur={() => onChange({ items: textToItems(itemsText) })}
          rows={3}
          placeholder={"Blanc de poulet - 150 g\nRiz basmati - 200 g"}
        />
        <div className="grid grid-cols-4 gap-3">
          <Field label="Kcal" type="number" value={String(meal.calories)} onChange={(v) => onChange({ calories: Number(v) || 0 })} />
          <Field label="Prot (g)" type="number" value={String(meal.protein)} onChange={(v) => onChange({ protein: Number(v) || 0 })} />
          <Field label="Gluc (g)" type="number" value={String(meal.carbs)} onChange={(v) => onChange({ carbs: Number(v) || 0 })} />
          <Field label="Lip (g)" type="number" value={String(meal.fat)} onChange={(v) => onChange({ fat: Number(v) || 0 })} />
        </div>
        <Field label="Notes coach" value={meal.coachNotes} onChange={(v) => onChange({ coachNotes: v })} />
      </div>
    </div>
  );
}

function DayEditor({
  day,
  onUpdate,
  onDuplicateToNext,
  canDuplicate,
}: {
  day: AdminNutritionDay;
  onUpdate: (updated: AdminNutritionDay) => void;
  onDuplicateToNext: () => void;
  canDuplicate: boolean;
}) {
  function updateMeal(index: number, partial: Partial<AdminMeal>) {
    onUpdate({ ...day, meals: day.meals.map((m, i) => (i === index ? { ...m, ...partial } : m)) });
  }
  function removeMeal(index: number) {
    onUpdate({ ...day, meals: day.meals.filter((_, i) => i !== index) });
  }
  function addMeal() {
    onUpdate({ ...day, meals: [...day.meals, blankMeal()] });
  }

  return (
    <div className="border border-border">
      <div className="flex items-center justify-between border-b border-border bg-background/40 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-foreground">{day.day}</span>
        {canDuplicate && (
          <button
            type="button"
            onClick={onDuplicateToNext}
            title="Dupliquer sur le jour suivant"
            className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-primary"
          >
            <Copy size={12} />
            Dupliquer <ArrowRight size={10} />
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4">
        {day.meals.map((meal, i) => (
          <MealEditor key={meal.id} meal={meal} onChange={(partial) => updateMeal(i, partial)} onRemove={() => removeMeal(i)} />
        ))}
        <button
          type="button"
          onClick={addMeal}
          className="flex items-center justify-center gap-2 border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        >
          <Plus size={14} />
          Ajouter un repas
        </button>
      </div>
    </div>
  );
}

export function NutritionPlanBuilder({
  initial,
  onSave,
  saveLabel,
}: {
  initial: NutritionPlanBuilderData;
  onSave: (data: NutritionPlanBuilderData) => void;
  saveLabel: string;
}) {
  const [name, setName] = useState(initial.name);
  const [goalType, setGoalType] = useState<NutritionGoalType>(initial.goalType);
  const [caloriesPerDay, setCaloriesPerDay] = useState(initial.caloriesPerDay);
  const [protein, setProtein] = useState(initial.protein);
  const [carbs, setCarbs] = useState(initial.carbs);
  const [fat, setFat] = useState(initial.fat);
  const [status, setStatus] = useState<AdminContentStatus>(initial.status);
  const [coachNotes, setCoachNotes] = useState(initial.coachNotes);
  const [hydrationTip, setHydrationTip] = useState(initial.hydrationTip);
  const [supplements, setSupplements] = useState(initial.supplements.join(", "));
  const [shoppingList, setShoppingList] = useState(initial.shoppingList.join(", "));
  const [days, setDays] = useState<AdminNutritionDay[]>(
    initial.days.length > 0
      ? initial.days
      : weekDays.map((day) => ({ id: generateId("day"), planId: "", day, meals: [] })),
  );

  function updateDay(dayName: string, updated: AdminNutritionDay) {
    setDays((prev) => prev.map((d) => (d.day === dayName ? updated : d)));
  }

  function duplicateToNext(dayName: string) {
    const index = weekDays.indexOf(dayName);
    if (index === -1 || index === weekDays.length - 1) return;
    const source = days.find((d) => d.day === dayName);
    if (!source) return;
    const nextDayName = weekDays[index + 1];
    setDays((prev) =>
      prev.map((d) =>
        d.day === nextDayName
          ? { ...d, meals: source.meals.map((m) => ({ ...m, id: generateId("meal") })) }
          : d,
      ),
    );
  }

  function copyMondayToWeek() {
    const monday = days.find((d) => d.day === "Lundi");
    if (!monday) return;
    setDays((prev) =>
      prev.map((d) =>
        d.day === "Lundi" ? d : { ...d, meals: monday.meals.map((m) => ({ ...m, id: generateId("meal") })) },
      ),
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="border border-border bg-card p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Informations générales
        </h2>
        <div className="flex flex-col gap-4">
          <Field label="Nom du plan" value={name} onChange={setName} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label="Objectif" value={goalType} onChange={(v) => setGoalType(v as NutritionGoalType)} options={goalOptions} />
            <SelectField label="Statut" value={status} onChange={(v) => setStatus(v as AdminContentStatus)} options={statusOptions} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Field label="Calories/jour" type="number" value={String(caloriesPerDay)} onChange={(v) => setCaloriesPerDay(Number(v) || 0)} />
            <Field label="Protéines (g)" type="number" value={String(protein)} onChange={(v) => setProtein(Number(v) || 0)} />
            <Field label="Glucides (g)" type="number" value={String(carbs)} onChange={(v) => setCarbs(Number(v) || 0)} />
            <Field label="Lipides (g)" type="number" value={String(fat)} onChange={(v) => setFat(Number(v) || 0)} />
          </div>
          <TextareaField label="Notes coach" value={coachNotes} onChange={setCoachNotes} rows={2} />
          <Field label="Conseil hydratation" value={hydrationTip} onChange={setHydrationTip} />
          <Field label="Compléments (séparés par des virgules)" value={supplements} onChange={setSupplements} />
          <TextareaField label="Liste de courses (séparée par des virgules)" value={shoppingList} onChange={setShoppingList} rows={2} />
        </div>
      </div>

      <div className="border border-border bg-card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-heading text-lg font-bold uppercase text-foreground">
            Semaine alimentaire
          </h2>
          <button
            type="button"
            onClick={copyMondayToWeek}
            className="flex items-center gap-2 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            <Copy size={14} />
            Copier lundi sur toute la semaine
          </button>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {days.map((day, i) => (
            <DayEditor
              key={day.day}
              day={day}
              onUpdate={(updated) => updateDay(day.day, updated)}
              onDuplicateToNext={() => duplicateToNext(day.day)}
              canDuplicate={i < days.length - 1}
            />
          ))}
        </div>
      </div>

      <PrimaryButton
        onClick={() =>
          onSave({
            name,
            goalType,
            caloriesPerDay,
            protein,
            carbs,
            fat,
            weeklyTargetCalories: caloriesPerDay * 7,
            status,
            coachNotes,
            hydrationTip,
            supplements: supplements.split(",").map((s) => s.trim()).filter(Boolean),
            shoppingList: shoppingList.split(",").map((s) => s.trim()).filter(Boolean),
            days,
          })
        }
      >
        {saveLabel}
      </PrimaryButton>
    </div>
  );
}
