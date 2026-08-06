"use client";

import { useId, useState } from "react";
import { Lock, LockOpen } from "lucide-react";

import { BASIS_POINTS_TOTAL, NBSP, applyBasisPoints, formatDecimalFr } from "@/lib/nutrition/basis-points";
import {
  MEAL_SLOT_LABELS_FR,
  describeMacroBalance,
  type MacroKey,
  type MealSlotKey,
} from "@/lib/nutrition/meal-distribution";
import {
  formatPercentInput,
  isSlotLocked,
  parsePercentInput,
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
  /**
   * L'état de macros du JOUR ouvert, présenté sous la forme attendue par les
   * fonctions pures de `plan-v2-form.ts` (voir `dayTargetsAsFormState`).
   * Le panneau ne sait pas qu'il s'agit d'un jour : il ne voit qu'une
   * répartition, ce qui le rend indifférent au modèle qui l'entoure.
   */
  readonly state: PlanV2FormState;
  readonly macro: MacroKey;
  readonly dailyGrams: number;
  readonly onChangeSlotBp: (slot: MealSlotKey, bp: number) => void;
  readonly onToggleLock: (slot: MealSlotKey) => void;
}

/**
 * Contenu de l'onglet d'UNE macro dans la répartition par créneau.
 *
 * Ce n'est PLUS une section autonome : les trois macros vivent dans un seul
 * panneau à onglets (`NutritionDaySlotDistribution`), et une seule est rendue
 * à la fois.
 *
 * CURSEURS SOLIDAIRES ICI AUSSI. Déplacer un créneau redistribue le reste sur
 * les créneaux actifs non verrouillés : la somme de la macro vaut toujours
 * 10 000 points de base. Trois affichages ont donc disparu, parce qu'ils
 * décrivaient un état devenu impossible :
 *
 *   « Réparti / Restant »  ............ le restant est toujours nul ;
 *   « Grammes restants »  ............. idem, en grammes ;
 *   « Répartir le reste équitablement » il n'y a plus de reste à répartir.
 *
 * Ne restent que ce qui informe encore : le pourcentage de chaque créneau,
 * ses grammes, les verrous, et le total.
 *
 * Le total AFFICHÉ est le total RÉEL, pas un « 100 % » écrit en dur : un plan
 * enregistré avant cette refonte peut arriver à 92 %, et le coach doit le
 * voir. Il repasse à 100 % dès qu'un curseur est touché.
 */
export function NutritionMacroDistributionPanel({
  state,
  macro,
  dailyGrams,
  onChangeSlotBp,
  onToggleLock,
}: PanelProps) {
  const balance = describeMacroBalance(state.slots, macro);
  const actifs = state.slots.filter((s) => s.enabled);
  const complet = balance.totalBp === BASIS_POINTS_TOTAL;

  return (
    <div>
      {actifs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Active au moins un repas pour répartir les {MACRO_LABELS_FR[macro].toLowerCase()}.
        </p>
      ) : (
        <>
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
                    grams={applyBasisPoints(dailyGrams, bp)}
                    locked={isSlotLocked(state, macro, allocation.slot)}
                    onToggleLock={() => onToggleLock(allocation.slot)}
                    onChangeBp={(valeur) => onChangeSlotBp(allocation.slot, valeur)}
                  />
                );
              })}
          </div>

          <p className="mt-3 flex flex-wrap items-baseline gap-x-2 text-xs">
            <span className="text-muted-foreground">Total réparti :</span>
            <strong className={complet ? "text-success" : "text-destructive"}>
              {formatPercentInput(balance.totalBp)}
              {NBSP}%
            </strong>
          </p>
        </>
      )}
    </div>
  );
}
