"use client";

import { useId, useState } from "react";
import { Lock, LockOpen, Scale } from "lucide-react";

import { NBSP, formatDecimalFr } from "@/lib/nutrition/basis-points";
import {
  MEAL_SLOT_LABELS_FR,
  describeMacroBalance,
  formatMacroBalanceMessage,
  type MacroKey,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import {
  formatPercentInput,
  isSlotLocked,
  parsePercentInput,
  remainingGramsForMacro,
  slotBasisPointsFor,
  type PlanV2FormState,
} from "@/lib/nutrition/plan-v2-form";

/**
 * Panneau de répartition d'UNE macro sur les six créneaux.
 *
 * Le même composant sert aux protéines, aux glucides et aux lipides : les
 * trois distributions sont strictement indépendantes, et rien ici ne les
 * relie. Une part de créneau est toujours « % de CETTE macro », jamais un
 * « pourcentage global du repas ».
 *
 * Aucun calcul n'est refait ici : tout vient des fonctions pures
 * (lib/nutrition/*). Le composant n'est qu'une projection.
 */

export const MACRO_LABELS_FR: Readonly<Record<MacroKey, string>> = {
  protein: "Protéines",
  carb: "Glucides",
  fat: "Lipides",
};

interface SliderRowProps {
  readonly label: string;
  readonly bp: number;
  readonly grams: number;
  readonly disabled?: boolean;
  readonly locked?: boolean;
  readonly onToggleLock?: () => void;
  readonly onChangeBp: (bp: number) => void;
}

/**
 * Ligne slider + champ numérique, synchronisés sur la MÊME source (les
 * points de base). Le champ garde son propre texte tant que la saisie est
 * invalide : une valeur hors 0–100 % n'est jamais ramenée silencieusement
 * dans les bornes, elle est refusée avec un message.
 */
export function MacroSliderRow({
  label,
  bp,
  grams,
  disabled = false,
  locked = false,
  onToggleLock,
  onChangeBp,
}: SliderRowProps) {
  const sliderId = useId();
  const champId = useId();
  const erreurId = useId();
  const [brouillon, setBrouillon] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const pourcentage = bp / 100;
  const texteChamp = brouillon ?? formatPercentInput(bp);

  function appliquerTexte(valeur: string) {
    setBrouillon(valeur);
    const resultat = parsePercentInput(valeur);
    if (resultat.ok) {
      setErreur(null);
      setBrouillon(null);
      onChangeBp(resultat.bp);
      return;
    }
    setErreur(resultat.message);
  }

  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <label htmlFor={sliderId} className="text-xs font-bold uppercase tracking-wide text-foreground">
          {label}
        </label>
        <span className="text-xs text-muted-foreground" aria-hidden="true">
          {formatDecimalFr(grams, 1)}
          {NBSP}g
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
        <input
          id={sliderId}
          type="range"
          min={0}
          max={100}
          step={1}
          value={pourcentage}
          disabled={disabled || locked}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pourcentage}
          aria-valuetext={`${formatPercentInput(bp)}${NBSP}% — ${formatDecimalFr(grams, 1)}${NBSP}g`}
          onChange={(event) => onChangeBp(Math.round(Number(event.target.value) * 100))}
          className="h-11 w-full min-w-0 flex-1 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-40"
        />

        <div className="flex shrink-0 items-center gap-2">
          <label htmlFor={champId} className="sr-only">
            {label} — pourcentage
          </label>
          <input
            id={champId}
            type="text"
            inputMode="decimal"
            value={texteChamp}
            disabled={disabled || locked}
            aria-invalid={erreur !== null}
            aria-describedby={erreur ? erreurId : undefined}
            onChange={(event) => appliquerTexte(event.target.value)}
            onBlur={() => {
              setBrouillon(null);
              setErreur(null);
            }}
            className="h-11 w-20 rounded-control border border-border bg-surface-soft px-2 text-right text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive"
          />
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            %
          </span>

          {onToggleLock && (
            <button
              type="button"
              onClick={onToggleLock}
              disabled={disabled}
              aria-pressed={locked}
              aria-label={
                locked
                  ? `Déverrouiller ${label} — la répartition automatique pourra le modifier`
                  : `Verrouiller ${label} — la répartition automatique le préservera`
              }
              className="pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 aria-pressed:border-primary aria-pressed:text-primary"
            >
              {locked ? <Lock size={15} /> : <LockOpen size={15} />}
            </button>
          )}
        </div>
      </div>

      {erreur && (
        <p id={erreurId} role="alert" className="text-xs text-destructive">
          {erreur}
        </p>
      )}
    </div>
  );
}

interface PanelProps {
  readonly state: PlanV2FormState;
  readonly macro: MacroKey;
  readonly dailyGrams: number;
  readonly onChangeSlotBp: (slot: MealSlotKey, bp: number) => void;
  readonly onToggleLock: (slot: MealSlotKey) => void;
  readonly onDistributeRest: () => void;
  readonly distributeError: string | null;
}

export function NutritionMacroDistributionPanel({
  state,
  macro,
  dailyGrams,
  onChangeSlotBp,
  onToggleLock,
  onDistributeRest,
  distributeError,
}: PanelProps) {
  const balance = describeMacroBalance(state.slots, macro);
  const message = formatMacroBalanceMessage(state.slots, macro);
  const grammesRestants = remainingGramsForMacro(state, macro);
  const actifs = state.slots.filter((s) => s.enabled);
  const titreId = useId();

  return (
    <section
      aria-labelledby={titreId}
      className="rounded-card border border-border bg-card p-4 shadow-soft sm:p-6"
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titreId} className="font-heading text-lg font-bold uppercase text-foreground">
            {MACRO_LABELS_FR[macro]} — {formatDecimalFr(dailyGrams, 1)}
            {NBSP}g/jour
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Réparti : {formatPercentInput(balance.totalBp)}
            {NBSP}% · Restant : {formatPercentInput(balance.remainingBp)}
            {NBSP}% · {formatDecimalFr(grammesRestants, 1)}
            {NBSP}g
          </p>
        </div>
        <button
          type="button"
          onClick={onDistributeRest}
          disabled={actifs.length === 0}
          className="pressable flex min-h-[44px] items-center gap-2 rounded-control border border-primary px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Scale size={13} />
          Répartir le reste équitablement
        </button>
      </div>

      {actifs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Active au moins un repas pour répartir les {MACRO_LABELS_FR[macro].toLowerCase()}.
        </p>
      ) : (
        <div className="flex flex-col">
          {state.slots
            .filter((s) => s.enabled)
            .map((allocation) => {
              const bp = slotBasisPointsFor(state, allocation.slot, macro);
              return (
                <MacroSliderRow
                  key={allocation.slot}
                  label={MEAL_SLOT_LABELS_FR[allocation.slot]}
                  bp={bp}
                  grams={(dailyGrams * bp) / 10000}
                  locked={isSlotLocked(state, macro, allocation.slot)}
                  onToggleLock={() => onToggleLock(allocation.slot)}
                  onChangeBp={(valeur) => onChangeSlotBp(allocation.slot, valeur)}
                />
              );
            })}
        </div>
      )}

      {distributeError && (
        <p role="alert" className="mt-3 rounded-panel border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {distributeError}
        </p>
      )}

      {message && (
        <p
          role={balance.status === "overflow" ? "alert" : undefined}
          className={`mt-3 text-xs ${balance.status === "overflow" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message}
        </p>
      )}
    </section>
  );
}
