"use client";

import { useId, useMemo, useState } from "react";
import { Save, ShieldCheck, Sparkles } from "lucide-react";

import { Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { MACRO_LABELS_FR, MacroSliderRow } from "@/components/admin/NutritionMacroDistributionPanel";
import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { NutritionPlanV2WeekPanel } from "@/components/admin/NutritionPlanV2WeekPanel";
import { computeDailyMacroTargets } from "@/lib/nutrition/macro-targets";
import { rebalanceDailyMacros } from "@/lib/nutrition/macro-rebalance";
import { MACRO_KEYS, type MacroKey } from "@/lib/nutrition/meal-distribution";
import {
  initializeAllDays,
  toValidationPlan,
  toValidationPlanForDay,
  weeklyCaloriesFromForm,
  type WeekFormState,
} from "@/lib/nutrition/plan-v2-week-form";
import type { PlanV2FormState } from "@/lib/nutrition/plan-v2-form";
import {
  validatePlanV2Assignable,
  validatePlanV2Draft,
} from "@/lib/nutrition/plan-v2-validation";
import { WEEKDAY_KEYS, WEEKDAY_LABELS_FR } from "@/lib/nutrition/weekdays";
import type { AdminContentStatus, NutritionGoalType } from "@/types";

/**
 * CONSTRUCTEUR DU PLAN NUTRITION — la semaine d'abord.
 *
 * CE QUI A DISPARU DE CET ÉCRAN, et pourquoi :
 *
 *   « Objectif quotidien » global .......... un plan n'a plus d'objectif
 *       unique : chaque jour porte le sien. Le panneau est remplacé par une
 *       action FACULTATIVE d'initialisation, qui écrit une fois dans les sept
 *       jours puis n'existe plus. Elle n'est jamais relue : la source de
 *       vérité, ce sont les sept jours.
 *   « Repas proposés » ..................... les créneaux se choisissent
 *       maintenant jour par jour, dans la zone 2 du jour ouvert.
 *   Trois panneaux P/G/L pleine page ....... remplacés par un panneau unique
 *       à trois onglets internes, dans le jour ouvert.
 *   « Récapitulatif » global ............... il agrégeait un objectif unique
 *       qui n'existe plus ; les grammes et les totaux sont affichés dans le
 *       jour, au plus près des curseurs qui les produisent.
 *   « Profils de la semaine » .............. supprimé entièrement, avec tout
 *       son vocabulaire.
 *
 * ARCHITECTURE INCHANGÉE : tout le métier vit dans les bibliothèques pures ;
 * ce composant projette un état et remonte des intentions. Aucune formule,
 * aucun seuil, aucune comparaison de pourcentage n'est réécrit ici.
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
  /** Métadonnées du plan : nom, description, objectif, statut, notes. */
  readonly state: PlanV2FormState;
  readonly onChange: (state: PlanV2FormState) => void;
  readonly onSave: (makeAssignable: boolean) => void;
  readonly saving: boolean;
  readonly serverError: string | null;
  /** Bandeau affiché en mode conversion d'un plan v1. */
  readonly conversionNotice?: string | null;
  /** LA SEMAINE — désormais la seule source de vérité nutritionnelle. */
  readonly week: WeekFormState;
  readonly onWeekChange: (next: WeekFormState) => void;
}

/**
 * Action facultative d'initialisation : les mêmes objectifs dans les sept
 * jours, en une fois. Repliée par défaut — elle ne doit pas ressembler à un
 * réglage global permanent.
 */
function InitialiserLaSemaine({
  onApply,
}: {
  readonly onApply: (objectifs: {
    dailyCalories: number;
    proteinBp: number;
    carbBp: number;
    fatBp: number;
  }) => void;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [calories, setCalories] = useState("2200");
  const [split, setSplit] = useState({ proteinBp: 3000, carbBp: 4500, fatBp: 2500 });
  const titreId = useId();

  const cibles = computeDailyMacroTargets({
    dailyCalories: Number(calories) || 0,
    proteinBp: split.proteinBp,
    carbBp: split.carbBp,
    fatBp: split.fatBp,
  });
  const grammes: Record<MacroKey, number> = {
    protein: cibles.grams.proteinGrams,
    carb: cibles.grams.carbGrams,
    fat: cibles.grams.fatGrams,
  };
  const bp: Record<MacroKey, number> = {
    protein: split.proteinBp,
    carb: split.carbBp,
    fat: split.fatBp,
  };

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        className="pressable flex min-h-[44px] w-full items-center justify-center gap-2 rounded-control border border-dashed border-border px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <Sparkles size={14} />
        Initialiser les sept jours avec les mêmes objectifs
      </button>
    );
  }

  return (
    <section aria-labelledby={titreId} className="rounded-panel border border-border p-4 sm:p-5">
      <h3 id={titreId} className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
        Initialiser les sept jours
      </h3>
      <p className="mb-4 text-xs text-muted-foreground">
        Point de départ, pas un réglage permanent : après application, chaque jour reste modifiable
        indépendamment.
      </p>

      <div className="mb-4 max-w-xs">
        <Field label="Calories par jour (kcal)" type="number" value={calories} onChange={setCalories} />
      </div>

      <div className="mb-4 flex flex-col">
        {MACRO_KEYS.map((macro) => (
          <MacroSliderRow
            key={macro}
            label={MACRO_LABELS_FR[macro]}
            bp={bp[macro]}
            grams={grammes[macro]}
            onChangeBp={(valeur) => setSplit((actuel) => rebalanceDailyMacros(actuel, macro, valeur))}
          />
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={() => {
            onApply({
              dailyCalories: Number(calories) || 0,
              proteinBp: split.proteinBp,
              carbBp: split.carbBp,
              fatBp: split.fatBp,
            });
            setOuvert(false);
          }}
          className="pressable flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-control border border-primary bg-primary px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Sparkles size={13} />
          Appliquer aux sept jours
        </button>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          className="pressable flex min-h-[44px] items-center justify-center rounded-control border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          Annuler
        </button>
      </div>
    </section>
  );
}

export function NutritionPlanV2Builder({
  state,
  onChange,
  onSave,
  saving,
  serverError,
  conversionNotice = null,
  week,
  onWeekChange,
}: NutritionPlanV2BuilderProps) {
  const [showAssignErrors, setShowAssignErrors] = useState(false);
  const semaineTitreId = useId();

  // Brouillon : contrôles de domaine sur les SEPT jours d'un coup.
  const brouillon = useMemo(
    () => validatePlanV2Draft(toValidationPlan(week, state.planId, state.name)),
    [week, state.planId, state.name],
  );

  // Assignabilité : `validatePlanV2Assignable` ne juge qu'un profil à la fois.
  // On l'appelle donc SEPT fois, une par jour, ce qui donne à la fois le bon
  // verdict et un message situé — sans réécrire la moindre règle.
  const parJour = useMemo(
    () =>
      WEEKDAY_KEYS.map((jour) => {
        const plan = toValidationPlanForDay(week, jour, state.planId, state.name);
        return { jour, résultat: plan ? validatePlanV2Assignable(plan) : null };
      }),
    [week, state.planId, state.name],
  );
  const joursIncomplets = parJour.filter((p) => p.résultat && !p.résultat.ok);
  const assignable = joursIncomplets.length === 0;

  function demanderAssignable() {
    setShowAssignErrors(true);
    if (!assignable) return;
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

      {/* ── 2. LA SEMAINE ALIMENTAIRE — section unique ───────────────── */}
      <section
        aria-labelledby={semaineTitreId}
        className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6"
      >
        <h2 id={semaineTitreId} className="mb-1 font-heading text-lg font-bold uppercase text-foreground">
          Semaine alimentaire
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Chaque jour porte ses propres calories, sa propre répartition et ses propres repas. Le total
          hebdomadaire est la somme des sept jours.
        </p>

        <div className="mb-4">
          <InitialiserLaSemaine onApply={(objectifs) => onWeekChange(initializeAllDays(week, objectifs))} />
        </div>

        <NutritionPlanV2WeekPanel state={week} onChange={onWeekChange} />
      </section>

      {/* ── 3. Actions ───────────────────────────────────────────────── */}
      <section className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6">
        <dl className="mb-4 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Total de la semaine</dt>
            <dd className="text-foreground">
              {formatIntegerFr(weeklyCaloriesFromForm(week))}
              {NBSP}kcal
            </dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Moyenne par jour</dt>
            <dd className="text-foreground">
              {formatDecimalFr(weeklyCaloriesFromForm(week) / WEEKDAY_KEYS.length, 0)}
              {NBSP}kcal
            </dd>
          </div>
          <div className="flex justify-between gap-2 sm:col-span-2">
            <dt className="text-muted-foreground">Statut du plan</dt>
            <dd className={assignable ? "text-success" : "text-foreground"}>
              {assignable ? "Assignable" : "Brouillon — non assignable"}
            </dd>
          </div>
        </dl>

        {showAssignErrors && !assignable && (
          <div
            role="alert"
            className="mb-4 rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            <p className="font-bold">
              {joursIncomplets.length === 1
                ? "Un jour est incomplet : ce plan ne peut pas encore être assigné."
                : `${joursIncomplets.length} jours sont incomplets : ce plan ne peut pas encore être assigné.`}
            </p>
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs">
              {joursIncomplets.map(({ jour, résultat }) => (
                <li key={jour}>
                  <strong>{WEEKDAY_LABELS_FR[jour]}</strong> — {résultat?.issues[0]?.message}
                </li>
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
