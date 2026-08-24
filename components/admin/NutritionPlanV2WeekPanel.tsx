"use client";

import { useId, useState } from "react";
import { CopyCheck, RotateCcw } from "lucide-react";

import { NutritionDayManualMeals } from "@/components/admin/NutritionDayManualMeals";
import { NutritionDaySlotDistribution } from "@/components/admin/NutritionDaySlotDistribution";
import { NutritionDayTabs } from "@/components/admin/NutritionDayTabs";
import { NutritionDayTargets } from "@/components/admin/NutritionDayTargets";
import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import type { MealSlotKey } from "@/lib/nutrition/meal-distribution";
import { HORAIRES_ENTRAINEMENT, type HoraireEntrainement } from "@/lib/nutrition/macro-presets";
import {
  addMeal,
  applyDayMacroPreset,
  applyDayToWholeWeek,
  addChoiceSlot,
  duplicateDay,
  findDay,
  moveChoiceSlot,
  presetApplicable,
  removeChoiceSlot,
  removeMeal,
  replaceChoiceSlot,
  resetDay,
  setDayCalories,
  setDayMacroBp,
  setDaySlotEnabled,
  setDaySlotMacroBp,
  toggleDaySlotLock,
  updateMeal,
  weeklyCaloriesFromForm,
  type WeekFormState,
} from "@/lib/nutrition/plan-v2-week-form";
import { WEEKDAY_KEYS, WEEKDAY_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * LA SEMAINE ALIMENTAIRE — section unique du constructeur.
 *
 * PARCOURS : un sélecteur de sept jours, un seul jour ouvert, et pour ce jour
 * un seul panneau contenant quatre zones :
 *
 *   1. les objectifs du jour (calories, P/G/L solidaires, grammes, total) ;
 *   2. la répartition par créneau (un panneau, trois onglets internes) ;
 *   3. les repas prescrits du jour ;
 *   4. les actions du jour (dupliquer, appliquer à la semaine, réinitialiser).
 *
 * UN SEUL COMPOSANT DE JOUR, rendu avec le jour sélectionné — pas sept
 * copies. Les six autres jours ne sont pas montés, donc rien à synchroniser.
 *
 * AUCUN VOCABULAIRE DE PROFIL. Le coach configure un jour ; la clé technique
 * `day_<jour>` est ajoutée au dernier moment, par `toWeekSavePayload`.
 */

export function NutritionPlanV2WeekPanel({
  state,
  onChange,
}: {
  readonly state: WeekFormState;
  readonly onChange: (next: WeekFormState) => void;
}) {
  const [jourOuvert, setJourOuvert] = useState<WeekdayKey>("monday");
  const [cibles, setCibles] = useState<readonly WeekdayKey[]>([]);
  /**
   * Horaire d'entraînement appliqué, PAR JOUR. Purement visuel : il éclaire
   * le bouton correspondant. Il n'est ni envoyé, ni enregistré, ni relu au
   * chargement — rouvrir le plan n'affiche donc aucun horaire actif, ce qui
   * est honnête : la base ne stocke que des pourcentages, jamais l'intention
   * qui les a produits.
   */
  const [horaireParJour, setHoraireParJour] = useState<Partial<Record<WeekdayKey, HoraireEntrainement>>>({});
  const panneauId = useId();

  const jour = findDay(state, jourOuvert);
  if (!jour) return null;

  const caloriesParJour = Object.fromEntries(
    state.days.map((d) => [d.day, d.dailyCalories]),
  ) as Record<WeekdayKey, number>;

  function basculerCible(cible: WeekdayKey) {
    setCibles((actuelles) =>
      actuelles.includes(cible) ? actuelles.filter((c) => c !== cible) : [...actuelles, cible],
    );
  }

  function dupliquer() {
    if (cibles.length === 0) return;
    onChange(duplicateDay(state, jourOuvert, cibles));
    setCibles([]);
  }

  const autresJours = WEEKDAY_KEYS.filter((j) => j !== jourOuvert);

  return (
    <div className="flex flex-col gap-4">
      <NutritionDayTabs
        selected={jourOuvert}
        onSelect={setJourOuvert}
        caloriesByDay={caloriesParJour}
        panelId={panneauId}
      />

      <div
        id={panneauId}
        role="tabpanel"
        aria-labelledby={`${panneauId}-onglet-${jourOuvert}`}
        tabIndex={-1}
        className="flex flex-col gap-4"
      >
        {/* ── ZONE 1 ────────────────────────────────────────────────── */}
        <NutritionDayTargets
          day={jourOuvert}
          targets={jour}
          onChangeCalories={(calories) => onChange(setDayCalories(state, jourOuvert, calories))}
          onChangeMacroBp={(macro, bp) => onChange(setDayMacroBp(state, jourOuvert, macro, bp))}
        />

        {/* ── ZONE 2 ────────────────────────────────────────────────── */}
        <NutritionDaySlotDistribution
          targets={jour}
          onToggleSlot={(slot: MealSlotKey, enabled: boolean) =>
            onChange(setDaySlotEnabled(state, jourOuvert, slot, enabled))
          }
          onChangeSlotBp={(slot, macro, bp) =>
            onChange(setDaySlotMacroBp(state, jourOuvert, slot, macro, bp))
          }
          onToggleLock={(macro, slot) => onChange(toggleDaySlotLock(state, jourOuvert, macro, slot))}
          /* PRÉSETS — ils ne font que déplacer les curseurs dans l'état
             local, par le même `onChange` que n'importe quel geste manuel.
             Aucune écriture : « Enregistrer » reste l'unique persistance. */
          presets={{
            etat: Object.fromEntries(
              HORAIRES_ENTRAINEMENT.map((horaire) => {
                const verdict = presetApplicable(jour, horaire);
                return [horaire, verdict.ok ? { ok: true } : { ok: false, message: verdict.message }];
              }),
            ) as Record<HoraireEntrainement, { ok: boolean; message?: string }>,
            actif: horaireParJour[jourOuvert] ?? null,
            onAppliquer: (horaire) => {
              const résultat = applyDayMacroPreset(state, jourOuvert, horaire);
              if (!résultat.ok) return;
              onChange(résultat.state);
              setHoraireParJour((actuels) => ({ ...actuels, [jourOuvert]: horaire }));
            },
          }}
        />

        {/* ── ZONE 3 ────────────────────────────────────────────────── */}
        <NutritionDayManualMeals
          meals={jour.meals}
          onAdd={() => onChange(addMeal(state, jourOuvert))}
          onUpdate={(mealId, patch) => onChange(updateMeal(state, jourOuvert, mealId, patch))}
          onRemove={(mealId) => onChange(removeMeal(state, jourOuvert, mealId))}
          /* N1.3 — les quatre gestes sur les occurrences. Tout reste PUR :
             l'état de la semaine est transformé, la base n'est touchée qu'au
             « Enregistrer », dans la même transaction que les repas. */
          occurrences={{
            onAjouter: (mealId, snapshot) =>
              onChange(addChoiceSlot(state, jourOuvert, mealId, {
                label: snapshot.label,
                sourceListId: snapshot.sourceListId,
                colorKey: snapshot.colorKey,
                options: snapshot.options,
              })),
            onRemplacer: (mealId, slotId, snapshot) =>
              onChange(replaceChoiceSlot(state, jourOuvert, mealId, slotId, {
                label: snapshot.label,
                sourceListId: snapshot.sourceListId,
                colorKey: snapshot.colorKey,
                options: snapshot.options,
              })),
            onRetirer: (mealId, slotId) =>
              onChange(removeChoiceSlot(state, jourOuvert, mealId, slotId)),
            onDeplacer: (mealId, slotId, direction) =>
              onChange(moveChoiceSlot(state, jourOuvert, mealId, slotId, direction)),
          }}
        />

        {/* ── ZONE 4 ────────────────────────────────────────────────── */}
        <section className="rounded-panel border border-border p-4 sm:p-5">
          <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Actions — {WEEKDAY_LABELS_FR[jourOuvert]}
          </h3>
          <p className="mb-4 text-xs text-muted-foreground">
            La copie emporte les calories, la répartition, les parts par créneau, les verrous, les repas
            et les notes. Les repas copiés reçoivent de nouveaux identifiants.
          </p>

          <fieldset className="mb-4">
            <legend className="mb-2 text-xs text-muted-foreground">Dupliquer ce jour vers…</legend>
            <div className="flex flex-wrap gap-2">
              {autresJours.map((cible) => (
                <label
                  key={cible}
                  className="pressable flex min-h-[44px] cursor-pointer items-center gap-2 rounded-control border border-border px-3 py-2 hover:border-primary focus-within:ring-2 focus-within:ring-primary/40"
                >
                  <input
                    type="checkbox"
                    checked={cibles.includes(cible)}
                    onChange={() => basculerCible(cible)}
                    className="h-4 w-4 shrink-0 accent-primary"
                  />
                  <span className="text-xs text-foreground">{WEEKDAY_LABELS_FR[cible]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <button
              type="button"
              onClick={dupliquer}
              disabled={cibles.length === 0}
              className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-primary px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CopyCheck size={13} />
              Dupliquer vers {cibles.length > 0 ? `${cibles.length} jour${cibles.length > 1 ? "s" : ""}` : "…"}
            </button>
            <button
              type="button"
              onClick={() => onChange(applyDayToWholeWeek(state, jourOuvert))}
              className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <CopyCheck size={13} />
              Appliquer à toute la semaine
            </button>
            <button
              type="button"
              onClick={() => onChange(resetDay(state, jourOuvert))}
              className="pressable flex min-h-[44px] items-center justify-center gap-2 rounded-control border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-destructive transition-colors hover:border-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
            >
              <RotateCcw size={13} />
              Réinitialiser ce jour
            </button>
          </div>
        </section>
      </div>

      <p className="rounded-panel border border-border bg-surface-soft/50 px-4 py-3 text-sm text-foreground">
        Total de la semaine :{" "}
        <strong>
          {formatIntegerFr(weeklyCaloriesFromForm(state))}
          {NBSP}kcal
        </strong>
        <span className="ml-2 text-xs text-muted-foreground">
          (somme des sept jours, jamais des calories multipliées par sept)
        </span>
      </p>
    </div>
  );
}
