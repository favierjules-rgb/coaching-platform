"use client";

import { useState } from "react";
import { ArrowRight, Copy, Plus, Trash2 } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { MEAL_SLOT_KEYS, MEAL_SLOT_LABELS_FR, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import type { PrescribedMeal } from "@/lib/nutrition/plan-v2-week";
import {
  PROFILE_KEY_PATTERN,
  addMeal,
  addProfile,
  duplicateDay,
  itemsToText,
  removeMeal,
  removeProfile,
  setDayProfile,
  setProfileCalories,
  textToItems,
  updateMeal,
  weeklyCaloriesFromForm,
  type WeekFormState,
} from "@/lib/nutrition/plan-v2-week-form";
import { WEEKDAY_KEYS, WEEKDAY_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * SECTION C du constructeur v2 — la semaine alimentaire.
 *
 * Reprend EXACTEMENT la carte de repas du constructeur v1 : moment, nom,
 * aliments un par ligne, kcal, P, G, L, notes coach. Deux différences, toutes
 * deux volontaires :
 *   - le « moment » utilise le vocabulaire v2 (`MEAL_SLOT_KEYS`), le seul du
 *     projet depuis la migration 20260811090000 ;
 *   - chaque jour porte un SÉLECTEUR DE PROFIL, au-dessus de ses repas, sans
 *     rien changer à la structure des cartes de repas.
 *
 * Cet outil est ENTIÈREMENT MANUEL : aucun appel à `solveRecipe`, aucune
 * lecture de la bibliothèque de recettes. Ce que le coach écrit est ce que
 * l'élève lira.
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
  // convertit qu'à la perte de focus — même choix que le constructeur v1.
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

export function NutritionPlanV2WeekPanel({
  state,
  onChange,
  dailyTargetsFor,
}: {
  state: WeekFormState;
  onChange: (next: WeekFormState) => void;
  /** Objectifs calculés d'un profil — fournis par le constructeur, jamais recalculés ici. */
  dailyTargetsFor: (profileKey: string) => { calories: number; protein: number; carbs: number; fat: number } | null;
}) {
  const [nouvelleClé, setNouvelleClé] = useState("");
  const [nouvellesCalories, setNouvellesCalories] = useState("2000");

  const cléValide = PROFILE_KEY_PATTERN.test(nouvelleClé) &&
    !state.profiles.some((p) => p.profileKey === nouvelleClé);

  return (
    <div className="flex flex-col gap-6">
      {/* ── Les profils disponibles ─────────────────────────────────────── */}
      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h3 className="mb-1 font-heading text-base font-bold uppercase text-foreground">
          Profils de la semaine
        </h3>
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          Chaque jour utilise un profil. Les profils additionnels reprennent la répartition P/G/L et
          les créneaux du profil principal — seules leurs calories quotidiennes changent.
        </p>

        <ul className="mb-4 flex flex-col gap-3">
          {state.profiles.map((profil) => (
            <li
              key={profil.profileKey}
              className="flex flex-wrap items-end gap-3 rounded-panel border border-border bg-surface-soft/40 p-3"
            >
              <span className="min-w-[8rem] text-sm font-bold text-foreground">
                {profil.profileKey}
                {profil.profileKey === state.mainProfileKey && (
                  <span className="ml-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                    principal
                  </span>
                )}
              </span>
              <div className="w-40">
                <Field
                  label="Calories / jour"
                  type="number"
                  value={String(profil.dailyCalories)}
                  onChange={(v) => onChange(setProfileCalories(state, profil.profileKey, Number(v) || 0))}
                />
              </div>
              {profil.profileKey !== state.mainProfileKey && (
                <button
                  type="button"
                  onClick={() => onChange(removeProfile(state, profil.profileKey))}
                  aria-label={`Retirer le profil ${profil.profileKey}`}
                  className="pressable flex h-11 w-11 items-center justify-center rounded-control text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap items-end gap-3">
          <div className="w-48">
            <Field
              label="Clé du nouveau profil"
              value={nouvelleClé}
              onChange={(v) => setNouvelleClé(v.toLowerCase())}
              placeholder="training_high"
            />
          </div>
          <div className="w-40">
            <Field
              label="Calories / jour"
              type="number"
              value={nouvellesCalories}
              onChange={setNouvellesCalories}
            />
          </div>
          <button
            type="button"
            disabled={!cléValide}
            onClick={() => {
              onChange(addProfile(state, nouvelleClé, Number(nouvellesCalories) || 0));
              setNouvelleClé("");
            }}
            className="pressable flex min-h-11 items-center gap-2 rounded-control border border-primary px-4 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Plus size={14} />
            Ajouter un profil
          </button>
        </div>
        {nouvelleClé !== "" && !cléValide && (
          <p className="mt-2 text-xs text-destructive" role="alert">
            Clé invalide ou déjà utilisée : minuscules, chiffres et souligné, 32 caractères au plus.
          </p>
        )}

        <p className="mt-4 rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-foreground">
          Total de la semaine :{" "}
          <strong>{formatIntegerFr(weeklyCaloriesFromForm(state))}{NBSP}kcal</strong>
          <span className="ml-2 text-xs text-muted-foreground">
            (somme des sept jours, jamais calories × 7)
          </span>
        </p>
      </section>

      {/* ── Les sept jours ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {WEEKDAY_KEYS.map((jourClé, index) => {
          const jour = state.days.find((d) => d.day === jourClé);
          if (!jour) return null;
          const cibles = dailyTargetsFor(jour.profileKey);
          const suivant: WeekdayKey | null = WEEKDAY_KEYS[index + 1] ?? null;

          return (
            <div key={jourClé} className="overflow-hidden rounded-panel border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-soft px-4 py-3">
                <span className="text-xs font-bold uppercase tracking-widest text-foreground">
                  {WEEKDAY_LABELS_FR[jourClé]}
                </span>
                {suivant && (
                  <button
                    type="button"
                    onClick={() => onChange(duplicateDay(state, jourClé, suivant))}
                    title="Dupliquer sur le jour suivant"
                    className="pressable flex min-h-11 items-center gap-1 rounded-control px-2 text-[11px] uppercase tracking-widest text-muted-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Copy size={12} />
                    Dupliquer <ArrowRight size={10} />
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-3 p-4">
                {/* Le sélecteur de profil, AU-DESSUS des repas — la structure
                    des cartes de repas est inchangée. */}
                <SelectField
                  label="Profil du jour"
                  value={jour.profileKey}
                  onChange={(v) => onChange(setDayProfile(state, jourClé, v))}
                  options={state.profiles.map((p) => ({
                    value: p.profileKey,
                    label: `${p.profileKey} — ${formatIntegerFr(p.dailyCalories)} kcal`,
                  }))}
                />

                {cibles && (
                  <p className="rounded-control border border-border bg-surface-soft/50 px-3 py-2 text-xs text-muted-foreground">
                    Objectifs calculés : {formatIntegerFr(cibles.calories)}
                    {NBSP}kcal · P{NBSP}
                    {formatIntegerFr(cibles.protein)}
                    {NBSP}g · G{NBSP}
                    {formatIntegerFr(cibles.carbs)}
                    {NBSP}g · L{NBSP}
                    {formatIntegerFr(cibles.fat)}
                    {NBSP}g
                  </p>
                )}

                {jour.meals.map((repas) => (
                  <MealEditor
                    key={repas.id}
                    meal={repas}
                    onChange={(patch) => onChange(updateMeal(state, jourClé, repas.id, patch))}
                    onRemove={() => onChange(removeMeal(state, jourClé, repas.id))}
                  />
                ))}

                <button
                  type="button"
                  onClick={() => onChange(addMeal(state, jourClé))}
                  className="pressable flex min-h-11 items-center justify-center gap-2 rounded-control border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Plus size={14} />
                  Ajouter un repas
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
