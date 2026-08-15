"use client";

import { useCallback, useId, useState } from "react";
import { Check, ChevronRight } from "lucide-react";

import {
  AUCUNE_SELECTION,
  choisirOption,
  optionChoisie,
  optionExploitable,
  progressionDesChoix,
  type SelectionDeChoix,
} from "@/lib/nutrition/meal-choice-selection";
import type { MealChoiceSlot } from "@/lib/nutrition/plan-v2-week";

/**
 * N1.4 — L'ÉLÈVE CHOISIT UN ALIMENT DANS CHAQUE LISTE DE SON REPAS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * FERMÉ PAR DÉFAUT, ET RÉELLEMENT FERMÉ
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LES OPTIONS NE SONT PAS RENDUES TANT QUE L'OCCURRENCE EST FERMÉE. Elles ne
 * sont pas masquées en CSS : elles n'existent pas dans le DOM. Un repas à dix
 * listes de dix aliments poserait cent lignes qu'aucun lecteur d'écran ne
 * devrait avoir à traverser, et que personne n'a demandé à voir.
 *
 * ⚠️ UNE SEULE OUVERTE À LA FOIS — mais ouvrir n'a AUCUN effet sur les choix
 * des autres occurrences. Replier n'efface rien.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE LOT NE CALCULE RIEN ET N'ÉCRIT RIEN
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE QUANTITÉ, AUCUNE MACRO, AUCUN GRAMME n'est affiché : les quantités
 * sont l'affaire de N1.5, et en montrer ici obligerait à les inventer.
 *
 * ⚠️ AUCUNE ÉCRITURE. Ce composant n'importe pas Supabase, n'appelle aucune
 * RPC, ne crée aucun repas consommé. `ouvrir_repas_prescrit` reste déclenchée
 * par le seul « Ajouter un aliment » de la section consommation, comme avant.
 * Il n'y a donc PAS de bouton « Enregistrer » : il mentirait, puisqu'il n'y a
 * encore ni quantité à enregistrer, ni consommation à créer.
 *
 * ⚠️ ET AUCUNE RECHERCHE LIBRE. Le coach a déjà réduit le choix : l'élève ne
 * voit que `meal_choice_options` de CETTE occurrence. Pas de catalogue, pas de
 * scan, pas d'Open Food Facts.
 */
export function StudentMealChoices({ occurrences }: { readonly occurrences: readonly MealChoiceSlot[] }) {
  // ⚠️ L'ÉTAT VIT ICI, ET LE COMPOSANT EST MONTÉ AVEC UNE CLÉ repas+date.
  // Changer de repas ou de jour démonte donc ce composant et son brouillon
  // avec lui : une composition ne peut pas fuir d'un repas vers un autre.
  const [selection, setSelection] = useState<SelectionDeChoix>(AUCUNE_SELECTION);
  const [ouverte, setOuverte] = useState<string | null>(null);
  const titreId = useId();

  const choisir = useCallback((slotId: string, optionId: string) => {
    setSelection((precedente) => choisirOption(precedente, slotId, optionId));
    // Le choix fait, la liste se referme : l'élève voit sa composition, pas
    // dix listes ouvertes les unes sous les autres.
    setOuverte(null);
  }, []);

  if (occurrences.length === 0) return null;

  const progression = progressionDesChoix(occurrences, selection);

  return (
    <section aria-labelledby={titreId} className="mt-3 flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h5 id={titreId} className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Choix alimentaires
        </h5>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {progression.choisis} / {progression.total}
        </span>
      </div>

      <ol className="flex min-w-0 flex-col gap-2">
        {occurrences.map((occurrence) => (
          <LigneChoix
            key={occurrence.id}
            occurrence={occurrence}
            choisie={optionChoisie(occurrence, selection)}
            ouverte={ouverte === occurrence.id}
            onBasculer={() => setOuverte(ouverte === occurrence.id ? null : occurrence.id)}
            onChoisir={(optionId) => choisir(occurrence.id, optionId)}
          />
        ))}
      </ol>
    </section>
  );
}

function LigneChoix({
  occurrence,
  choisie,
  ouverte,
  onBasculer,
  onChoisir,
}: {
  readonly occurrence: MealChoiceSlot;
  readonly choisie: ReturnType<typeof optionChoisie>;
  readonly ouverte: boolean;
  readonly onBasculer: () => void;
  readonly onChoisir: (optionId: string) => void;
}) {
  const groupeId = useId();

  return (
    <li className="min-w-0 rounded-control border border-border bg-card">
      {/* ⚠️ UN VRAI BOUTON, PAS UN DIV CLIQUABLE. `aria-expanded` dit l'état,
          et le libellé ne dépend jamais du seul chevron. */}
      <button
        type="button"
        onClick={onBasculer}
        aria-expanded={ouverte}
        aria-controls={groupeId}
        className="pressable flex min-h-[44px] w-full min-w-0 items-center justify-between gap-3 rounded-control px-3 py-2 text-left transition-colors hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold text-foreground">{occurrence.label}</span>
          <span className="truncate text-xs text-muted-foreground">
            {choisie ? (choisie.displayName ?? "Aliment indisponible") : "Aucun choix"}
          </span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {choisie ? "Modifier" : "Choisir"}
          </span>
          <ChevronRight
            size={16}
            aria-hidden="true"
            className={`text-muted-foreground transition-transform ${ouverte ? "rotate-90" : ""}`}
          />
        </span>
      </button>

      {/* ⚠️ RENDU SEULEMENT QUAND C'EST OUVERT. Voir l'en-tête du fichier. */}
      {ouverte && (
        <div
          id={groupeId}
          role="radiogroup"
          aria-label={occurrence.label}
          className="flex min-w-0 flex-col gap-1 border-t border-border p-2"
        >
          {occurrence.options.map((option) => {
            const exploitable = optionExploitable(option);
            const selectionnee = choisie?.optionId !== undefined && choisie.optionId === option.optionId;
            return (
              <button
                key={option.optionId ?? `${option.type}-${option.id}`}
                type="button"
                role="radio"
                aria-checked={selectionnee}
                disabled={!exploitable}
                onClick={() => option.optionId && onChoisir(option.optionId)}
                className="pressable flex min-h-[44px] w-full min-w-0 items-center gap-2 rounded-control px-3 py-2 text-left transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span
                  aria-hidden="true"
                  className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border ${
                    selectionnee ? "border-primary bg-primary text-primary-foreground" : "border-border"
                  }`}
                >
                  {selectionnee && <Check size={10} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {/* ⚠️ LE NOM, ET RIEN QUE LE NOM. Pas de grammes, pas de
                      macros : elles n'existent pas encore à cette étape. */}
                  {option.displayName ?? "Aliment indisponible"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
