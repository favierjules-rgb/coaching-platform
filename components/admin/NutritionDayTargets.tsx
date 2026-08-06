"use client";

import { useId } from "react";

import { Field } from "@/components/admin/AdminFormFields";
import { MACRO_LABELS_FR, MacroSliderRow } from "@/components/admin/NutritionMacroDistributionPanel";
import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { computeDailyMacroTargets } from "@/lib/nutrition/macro-targets";
import { MACRO_KEYS, type MacroKey } from "@/lib/nutrition/meal-distribution";
import { isDaySplitComplete, type DayTargetsForm } from "@/lib/nutrition/plan-v2-week-form";
import { WEEKDAY_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * ZONE 1 — LES OBJECTIFS DU JOUR OUVERT.
 *
 * Calories, trois parts de macronutriments, grammes calculés, total.
 *
 * CURSEURS SOLIDAIRES. Déplacer une part redistribue immédiatement le reste
 * sur les deux autres : le total affiche toujours 100 %, et le coach n'a plus
 * à faire l'appoint à la main. Toute la règle vit dans
 * `rebalanceDailyMacros` (lib/nutrition/macro-rebalance.ts) ; ce composant ne
 * fait que remonter l'intention.
 *
 * AUCUN CALCUL ICI. Les grammes viennent de `computeDailyMacroTargets`, qui
 * détient KCAL_PER_GRAM. Le mot « profil » n'apparaît nulle part.
 */

export function NutritionDayTargets({
  day,
  targets,
  onChangeCalories,
  onChangeMacroBp,
}: {
  readonly day: WeekdayKey;
  readonly targets: DayTargetsForm;
  readonly onChangeCalories: (calories: number) => void;
  readonly onChangeMacroBp: (macro: MacroKey, bp: number) => void;
}) {
  const titreId = useId();

  const cibles = computeDailyMacroTargets({
    dailyCalories: targets.dailyCalories,
    proteinBp: targets.proteinBp,
    carbBp: targets.carbBp,
    fatBp: targets.fatBp,
  });
  const grammes: Record<MacroKey, number> = {
    protein: cibles.grams.proteinGrams,
    carb: cibles.grams.carbGrams,
    fat: cibles.grams.fatGrams,
  };
  const bp: Record<MacroKey, number> = {
    protein: targets.proteinBp,
    carb: targets.carbBp,
    fat: targets.fatBp,
  };
  const totalBp = targets.proteinBp + targets.carbBp + targets.fatBp;
  const complet = isDaySplitComplete(targets);

  return (
    <section aria-labelledby={titreId} className="rounded-panel border border-border p-4 sm:p-5">
      <h3 id={titreId} className="mb-4 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Objectifs — {WEEKDAY_LABELS_FR[day]}
      </h3>

      <div className="mb-5 max-w-xs">
        <Field
          label="Calories du jour (kcal)"
          type="number"
          value={String(targets.dailyCalories)}
          onChange={(v) => onChangeCalories(Number(v))}
        />
      </div>

      <div className="flex flex-col">
        {MACRO_KEYS.map((macro) => (
          <MacroSliderRow
            key={macro}
            label={MACRO_LABELS_FR[macro]}
            bp={bp[macro]}
            grams={grammes[macro]}
            onChangeBp={(valeur) => onChangeMacroBp(macro, valeur)}
          />
        ))}
      </div>

      <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">Total</span>
        <strong className={complet ? "text-success" : "text-destructive"}>
          {formatDecimalFr(totalBp / 100, 2)}
          {NBSP}%
        </strong>
        <span className="text-muted-foreground">
          {formatIntegerFr(cibles.calories.totalCalories)}
          {NBSP}kcal reconstitués depuis les grammes
        </span>
      </p>
      {!complet && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Les trois macronutriments doivent totaliser exactement 100&nbsp;%.
        </p>
      )}
    </section>
  );
}
