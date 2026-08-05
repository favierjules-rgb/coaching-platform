"use client";

import { useId, useMemo, useState } from "react";
import { Save, ShieldCheck } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import {
  MACRO_LABELS_FR,
  MacroSliderRow,
  NutritionMacroDistributionPanel,
} from "@/components/admin/NutritionMacroDistributionPanel";
import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { formatSplitBalanceMessage } from "@/lib/nutrition/macro-targets";
import {
  MACRO_KEYS,
  MEAL_SLOT_LABELS_FR,
  describeMacroBalance,
  type MacroKey,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import {
  buildRecap,
  deriveDailyTargets,
  distributeRestForMacro,
  readDailyMacroBp,
  setDailyCalories,
  setDailyMacroBp,
  setSlotEnabled,
  setSlotMacroBp,
  toValidationPlan,
  toggleSlotLock,
  type PlanV2FormState,
} from "@/lib/nutrition/plan-v2-form";
import {
  formatPlanV2AssignabilityMessage,
  validatePlanV2Assignable,
  validatePlanV2Draft,
} from "@/lib/nutrition/plan-v2-validation";
import type { AdminContentStatus, NutritionGoalType } from "@/types";

/**
 * Constructeur du modèle nutrition v2 (répartition structurée).
 *
 * ARCHITECTURE. Tout le métier vit dans `lib/nutrition/plan-v2-form.ts` et
 * dans les bibliothèques pures de la PR 1 ; ce composant ne fait que
 * projeter l'état et remonter les intentions. Aucune règle de calcul, aucun
 * seuil, aucune comparaison de pourcentage n'est réécrit ici.
 *
 * L'interface affiche des POURCENTAGES ; l'état métier ne connaît que des
 * POINTS DE BASE ENTIERS.
 *
 * AUCUNE ÉCRITURE implicite : rien ne part vers Supabase avant un clic sur
 * l'un des deux boutons d'enregistrement.
 */

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

export interface NutritionPlanV2BuilderProps {
  readonly state: PlanV2FormState;
  readonly onChange: (state: PlanV2FormState) => void;
  readonly onSave: (makeAssignable: boolean) => void;
  readonly saving: boolean;
  readonly serverError: string | null;
  /** Bandeau affiché en mode conversion d'un plan v1. */
  readonly conversionNotice?: string | null;
}

export function NutritionPlanV2Builder({
  state,
  onChange,
  onSave,
  saving,
  serverError,
  conversionNotice = null,
}: NutritionPlanV2BuilderProps) {
  const [distributeErrors, setDistributeErrors] = useState<Partial<Record<MacroKey, string>>>({});
  const [showAssignErrors, setShowAssignErrors] = useState(false);
  const recapTitreId = useId();
  const objectifTitreId = useId();
  const creneauxTitreId = useId();

  const cibles = useMemo(() => deriveDailyTargets(state), [state]);
  const recap = useMemo(() => buildRecap(state), [state]);
  const brouillon = useMemo(() => validatePlanV2Draft(toValidationPlan(state)), [state]);
  const assignable = useMemo(() => validatePlanV2Assignable(toValidationPlan(state)), [state]);
  const messageQuotidien = formatSplitBalanceMessage({
    proteinBp: state.proteinBp,
    carbBp: state.carbBp,
    fatBp: state.fatBp,
  });

  const grammesJour: Record<MacroKey, number> = {
    protein: cibles.grams.proteinGrams,
    carb: cibles.grams.carbGrams,
    fat: cibles.grams.fatGrams,
  };

  function repartirLeReste(macro: MacroKey) {
    const resultat = distributeRestForMacro(state, macro);
    if (!resultat.ok) {
      setDistributeErrors((e) => ({ ...e, [macro]: resultat.message }));
      return;
    }
    setDistributeErrors((e) => ({ ...e, [macro]: undefined }));
    onChange(resultat.state);
  }

  function demanderAssignable() {
    setShowAssignErrors(true);
    if (!assignable.ok) {
      return;
    }
    onSave(true);
  }

  return (
    <div className="flex w-full max-w-4xl flex-col gap-6">
      {conversionNotice && (
        <p className="rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-foreground">
          {conversionNotice}
        </p>
      )}

      {serverError && (
        <p
          role="alert"
          className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {serverError}
        </p>
      )}

      {/* ── 1. Informations générales ────────────────────────────────── */}
      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Informations générales
        </h2>
        <div className="flex flex-col gap-4">
          <Field label="Nom du plan" value={state.name} onChange={(v) => onChange({ ...state, name: v })} />
          <Field
            label="Description courte"
            value={state.description}
            onChange={(v) => onChange({ ...state, description: v })}
            placeholder="Ex. : plan de prise de masse, 5 repas"
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField
              label="Objectif"
              value={state.goalType}
              onChange={(v) => onChange({ ...state, goalType: v })}
              options={goalOptions}
            />
            <SelectField
              label="Statut"
              value={state.status}
              onChange={(v) => onChange({ ...state, status: v })}
              options={statusOptions}
            />
          </div>
          <TextareaField
            label="Notes du coach"
            value={state.coachNotes}
            onChange={(v) => onChange({ ...state, coachNotes: v })}
          />
          <Field
            label="Conseil hydratation"
            value={state.hydrationTip}
            onChange={(v) => onChange({ ...state, hydrationTip: v })}
            placeholder="Ex. : 2,5 L d'eau par jour"
          />
        </div>
      </section>

      {/* ── 2. Objectif quotidien ────────────────────────────────────── */}
      <section
        aria-labelledby={objectifTitreId}
        className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 id={objectifTitreId} className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Objectif quotidien
        </h2>

        <div className="mb-5 max-w-xs">
          <Field
            label="Énergie quotidienne (kcal)"
            type="number"
            value={String(state.dailyCalories)}
            onChange={(v) => onChange(setDailyCalories(state, Number(v)))}
          />
        </div>

        <h3 className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Répartition calorique
        </h3>
        <div className="flex flex-col">
          {MACRO_KEYS.map((macro) => (
            <MacroSliderRow
              key={macro}
              label={MACRO_LABELS_FR[macro]}
              bp={readDailyMacroBp(state, macro)}
              grams={grammesJour[macro]}
              onChangeBp={(bp) => onChange(setDailyMacroBp(state, macro, bp))}
            />
          ))}
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Réparti : {formatDecimalFr((state.proteinBp + state.carbBp + state.fatBp) / 100, 2)}
          {NBSP}%
        </p>
        {messageQuotidien && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {messageQuotidien}
          </p>
        )}
      </section>

      {/* ── 3. Créneaux actifs ───────────────────────────────────────── */}
      <section
        aria-labelledby={creneauxTitreId}
        className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 id={creneauxTitreId} className="mb-1 font-heading text-lg font-bold uppercase text-foreground">
          Repas proposés
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Désactiver un repas remet ses trois parts à zéro. Rien n&apos;est enregistré avant Enregistrer.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {state.slots.map((allocation) => (
            <label
              key={allocation.slot}
              className="pressable flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2 transition-colors hover:border-primary focus-within:ring-2 focus-within:ring-primary/40"
            >
              <input
                type="checkbox"
                checked={allocation.enabled}
                onChange={(event) => onChange(setSlotEnabled(state, allocation.slot, event.target.checked))}
                className="h-5 w-5 shrink-0 accent-primary"
              />
              <span className="text-sm text-foreground">{MEAL_SLOT_LABELS_FR[allocation.slot]}</span>
            </label>
          ))}
        </div>
      </section>

      {/* ── 4-6. Une répartition INDÉPENDANTE par macro ──────────────── */}
      {MACRO_KEYS.map((macro) => (
        <NutritionMacroDistributionPanel
          key={macro}
          state={state}
          macro={macro}
          dailyGrams={grammesJour[macro]}
          onChangeSlotBp={(slot: MealSlotKey, bp: number) => onChange(setSlotMacroBp(state, slot, macro, bp))}
          onToggleLock={(slot: MealSlotKey) => onChange(toggleSlotLock(state, macro, slot))}
          onDistributeRest={() => repartirLeReste(macro)}
          distributeError={distributeErrors[macro] ?? null}
        />
      ))}

      {/* ── 7. Récapitulatif ─────────────────────────────────────────── */}
      <section
        aria-labelledby={recapTitreId}
        className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 id={recapTitreId} className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
          Récapitulatif
        </h2>

        {/* Mobile : une carte par repas — aucun défilement horizontal. */}
        <ul className="flex flex-col gap-3 md:hidden">
          {recap.rows
            .filter((r) => r.enabled)
            .map((row) => (
              <li key={row.slot} className="rounded-panel border border-border p-3">
                <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-foreground">
                  {MEAL_SLOT_LABELS_FR[row.slot]}
                </span>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>Protéines : {formatDecimalFr(row.proteinGrams, 1)}{NBSP}g</span>
                  <span>Glucides : {formatDecimalFr(row.carbGrams, 1)}{NBSP}g</span>
                  <span>Lipides : {formatDecimalFr(row.fatGrams, 1)}{NBSP}g</span>
                  <span>{formatIntegerFr(row.calories)}{NBSP}kcal</span>
                </div>
              </li>
            ))}
          <li className="rounded-panel border border-border-strong p-3">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wide text-foreground">Total</span>
            <div className="grid grid-cols-2 gap-2 text-xs text-foreground">
              <span>Protéines : {formatDecimalFr(recap.totals.proteinGrams, 1)}{NBSP}g</span>
              <span>Glucides : {formatDecimalFr(recap.totals.carbGrams, 1)}{NBSP}g</span>
              <span>Lipides : {formatDecimalFr(recap.totals.fatGrams, 1)}{NBSP}g</span>
              <span>{formatIntegerFr(recap.totals.calories)}{NBSP}kcal</span>
            </div>
          </li>
        </ul>

        {/* Desktop : tableau, défilement interne contrôlé si nécessaire. */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-medium">Repas</th>
                <th scope="col" className="py-2 pr-3 font-medium">Protéines</th>
                <th scope="col" className="py-2 pr-3 font-medium">Glucides</th>
                <th scope="col" className="py-2 pr-3 font-medium">Lipides</th>
                <th scope="col" className="py-2 font-medium">Calories</th>
              </tr>
            </thead>
            <tbody>
              {recap.rows
                .filter((r) => r.enabled)
                .map((row) => (
                  <tr key={row.slot} className="border-b border-border text-muted-foreground">
                    <th scope="row" className="py-2 pr-3 font-normal text-foreground">
                      {MEAL_SLOT_LABELS_FR[row.slot]}
                    </th>
                    <td className="py-2 pr-3">{formatDecimalFr(row.proteinGrams, 1)}{NBSP}g</td>
                    <td className="py-2 pr-3">{formatDecimalFr(row.carbGrams, 1)}{NBSP}g</td>
                    <td className="py-2 pr-3">{formatDecimalFr(row.fatGrams, 1)}{NBSP}g</td>
                    <td className="py-2">{formatIntegerFr(row.calories)}</td>
                  </tr>
                ))}
              <tr className="text-foreground">
                <th scope="row" className="py-2 pr-3 font-bold uppercase">Total</th>
                <td className="py-2 pr-3 font-bold">{formatDecimalFr(recap.totals.proteinGrams, 1)}{NBSP}g</td>
                <td className="py-2 pr-3 font-bold">{formatDecimalFr(recap.totals.carbGrams, 1)}{NBSP}g</td>
                <td className="py-2 pr-3 font-bold">{formatDecimalFr(recap.totals.fatGrams, 1)}{NBSP}g</td>
                <td className="py-2 font-bold">{formatIntegerFr(recap.totals.calories)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Calories demandées</dt>
            <dd className="text-foreground">{formatIntegerFr(recap.requestedCalories)}{NBSP}kcal</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Calories calculées</dt>
            <dd className="text-foreground">{formatIntegerFr(recap.derivedCalories)}{NBSP}kcal</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Écart d&apos;affichage</dt>
            <dd className="text-foreground">
              {formatDecimalFr(recap.displayGapCalories, 1)}{NBSP}kcal
            </dd>
          </div>
          {MACRO_KEYS.map((macro) => {
            const balance = describeMacroBalance(state.slots, macro);
            return (
              <div key={macro} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Statut {MACRO_LABELS_FR[macro].toLowerCase()}</dt>
                <dd className={balance.status === "complete" ? "text-success" : "text-foreground"}>
                  {balance.status === "complete" ? "Complet" : "À compléter"}
                </dd>
              </div>
            );
          })}
          <div className="flex justify-between gap-2 sm:col-span-2">
            <dt className="text-muted-foreground">Statut du plan</dt>
            <dd className={assignable.ok ? "text-success" : "text-foreground"}>
              {assignable.ok ? "Assignable" : "Brouillon — non assignable"}
            </dd>
          </div>
        </dl>

        <p className="mt-3 text-xs text-muted-foreground">
          Un léger écart d&apos;affichage dû à l&apos;arrondi des grammes ne bloque pas le plan : seuls
          les points de base font foi.
        </p>
      </section>

      {/* ── 8. Actions ───────────────────────────────────────────────── */}
      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        {showAssignErrors && !assignable.ok && (
          <div
            role="alert"
            className="mb-4 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p className="font-bold">{formatPlanV2AssignabilityMessage(assignable)}</p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs">
              {assignable.issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.slot ?? issue.field ?? index}`}>{issue.message}</li>
              ))}
            </ul>
          </div>
        )}

        {!brouillon.ok && (
          <p role="alert" className="mb-4 text-xs text-destructive">
            Certaines valeurs sont hors plage : corrige-les avant d&apos;enregistrer.
          </p>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => onSave(false)}
            disabled={saving || !brouillon.ok}
            className="pressable flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-control border border-border px-4 py-3 text-xs font-bold uppercase tracking-widest text-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Save size={14} />
            Enregistrer le brouillon
          </button>
          <button
            type="button"
            onClick={demanderAssignable}
            disabled={saving || !brouillon.ok}
            className="pressable flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-control border border-primary bg-primary px-4 py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ShieldCheck size={14} />
            Enregistrer et rendre assignable
          </button>
        </div>
        {saving && (
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            Enregistrement en cours…
          </p>
        )}
      </section>
    </div>
  );
}
