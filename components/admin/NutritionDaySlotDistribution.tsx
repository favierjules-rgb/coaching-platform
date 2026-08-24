"use client";

import { useId, useRef, useState } from "react";
import { CloudSun, Moon, Sun, Sunrise } from "lucide-react";

import {
  MACRO_LABELS_FR,
  NutritionMacroDistributionPanel,
} from "@/components/admin/NutritionMacroDistributionPanel";
import { NBSP, formatDecimalFr } from "@/lib/nutrition/basis-points";
import { computeDailyMacroTargets } from "@/lib/nutrition/macro-targets";
import { MACRO_KEYS, MEAL_SLOT_LABELS_FR, type MacroKey, type MealSlotKey } from "@/lib/nutrition/meal-distribution";
import { HORAIRES_ENTRAINEMENT, HORAIRE_LABELS_FR, type HoraireEntrainement } from "@/lib/nutrition/macro-presets";

/** Une icône par horaire, prises dans la bibliothèque déjà utilisée partout. */
const ICONE_HORAIRE = { matin: Sunrise, midi: Sun, apres_midi: CloudSun, soir: Moon } as const;
import { dayTargetsAsFormState, type DayTargetsForm } from "@/lib/nutrition/plan-v2-week-form";

/**
 * ZONE 2 — LA RÉPARTITION PAR CRÉNEAU, EN UN SEUL PANNEAU.
 *
 * AVANT : trois sections successives, pleine largeur, l'une sous l'autre —
 * protéines, puis glucides, puis lipides. Sur un jour à six créneaux, cela
 * faisait dix-huit lignes de curseurs empilées, et le coach devait faire
 * défiler la page pour comparer deux macros.
 *
 * MAINTENANT : un panneau, trois onglets internes, UNE SEULE liste rendue à
 * la fois. Changer d'onglet remplace le contenu ; il n'est jamais empilé.
 *
 * CURSEURS SOLIDAIRES. Comme en zone 1, déplacer un créneau redistribue le
 * reste sur les créneaux actifs non verrouillés : la somme de la macro vaut
 * toujours 10 000 points de base. « Réparti / Restant », « Grammes restants »
 * et « Répartir le reste équitablement » ont donc disparu — ils décrivaient
 * un reste qui n'existe plus. Restent le pourcentage de chaque créneau, ses
 * grammes, les verrous, le total, et la possibilité de désactiver un créneau.
 *
 * ACCESSIBILITÉ : motif « tabs » du WAI-ARIA, flèches ← → et Origine / Fin,
 * un seul onglet dans l'ordre de tabulation.
 */

export function NutritionDaySlotDistribution({
  targets,
  onToggleSlot,
  onChangeSlotBp,
  onToggleLock,
  presets,
}: {
  readonly targets: DayTargetsForm;
  readonly onToggleSlot: (slot: MealSlotKey, enabled: boolean) => void;
  readonly onChangeSlotBp: (slot: MealSlotKey, macro: MacroKey, bp: number) => void;
  readonly onToggleLock: (macro: MacroKey, slot: MealSlotKey) => void;
  /**
   * Applique un préset d'horaire d'entraînement. OPTIONNELLE : sans elle,
   * les boutons ne sont pas rendus et le panneau se comporte exactement
   * comme avant — les harnais de rendu existants n'ont rien à changer.
   *
   * `etat` dit, pour chaque horaire, si le préset est applicable et sinon
   * pourquoi. Le composant ne recalcule rien : il affiche.
   */
  readonly presets?: {
    readonly etat: Readonly<Record<HoraireEntrainement, { readonly ok: boolean; readonly message?: string }>>;
    readonly onAppliquer: (horaire: HoraireEntrainement) => void;
    readonly actif: HoraireEntrainement | null;
  };
}) {
  const [macroActive, setMacroActive] = useState<MacroKey>("protein");
  const titreId = useId();
  const panneauId = useId();
  const refs = useRef<Partial<Record<MacroKey, HTMLButtonElement | null>>>({});

  const etat = dayTargetsAsFormState(targets);
  const cibles = computeDailyMacroTargets({
    dailyCalories: targets.dailyCalories,
    proteinBp: targets.proteinBp,
    carbBp: targets.carbBp,
    fatBp: targets.fatBp,
  });
  const grammesJour: Record<MacroKey, number> = {
    protein: cibles.grams.proteinGrams,
    carb: cibles.grams.carbGrams,
    fat: cibles.grams.fatGrams,
  };

  function déplacer(index: number) {
    const cible = MACRO_KEYS[(index + MACRO_KEYS.length) % MACRO_KEYS.length];
    setMacroActive(cible);
    refs.current[cible]?.focus();
  }

  function auClavier(event: React.KeyboardEvent, index: number) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      déplacer(index + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      déplacer(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      déplacer(0);
    } else if (event.key === "End") {
      event.preventDefault();
      déplacer(MACRO_KEYS.length - 1);
    }
  }

  return (
    <section aria-labelledby={titreId} className="rounded-panel border border-border p-4 sm:p-5">
      {/*
        L'EN-TÊTE ET LES RACCOURCIS, SUR LA MÊME LIGNE.

        Les quatre horaires ne sont pas des actions principales : ce sont des
        raccourcis de réglage. Ils occupaient auparavant quatre pavés pleine
        largeur, qui pesaient visuellement plus lourd que les curseurs qu'ils
        servent à placer. Ils sont donc revenus à leur juste rang — une ligne
        discrète à hauteur du titre, en typographie réduite, avec une icône
        pour se repérer d'un coup d'œil.
      */}
      <div className="mb-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 id={titreId} className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
          Répartition par créneau
        </h3>

        {presets ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              Entraînement
            </span>
            {HORAIRES_ENTRAINEMENT.map((horaire) => {
              const etat = presets.etat[horaire];
              const choisi = presets.actif === horaire;
              const Icone = ICONE_HORAIRE[horaire];
              return (
                <button
                  key={horaire}
                  type="button"
                  data-raccourci-horaire={horaire}
                  disabled={!etat.ok}
                  aria-pressed={choisi}
                  title={etat.ok ? `Placer les curseurs pour un entraînement du ${HORAIRE_LABELS_FR[horaire].toLowerCase()}` : etat.message}
                  onClick={() => presets.onAppliquer(horaire)}
                  className={`inline-flex h-7 items-center gap-1 rounded-control border px-2 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-35 ${
                    choisi
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border/70 text-muted-foreground hover:border-primary/60 hover:text-primary"
                  }`}
                >
                  <Icone size={12} aria-hidden="true" className="flex-shrink-0" />
                  {HORAIRE_LABELS_FR[horaire]}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <p className="mb-4 text-xs text-muted-foreground">
        Désactiver un repas remet ses trois parts à zéro. Rien n&apos;est enregistré avant Enregistrer.
      </p>
      {presets && messagePresets(presets.etat) ? (
        <p className="-mt-2 mb-4 text-xs text-muted-foreground/80">{messagePresets(presets.etat)}</p>
      ) : null}

      {/* Les six créneaux — communs aux trois macros, donc au-dessus des onglets. */}
      <div className="mb-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {targets.slots.map((allocation) => (
          <label
            key={allocation.slot}
            className="pressable flex min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border px-3 py-2 hover:border-primary focus-within:ring-2 focus-within:ring-primary/40"
          >
            <input
              type="checkbox"
              checked={allocation.enabled}
              onChange={(event) => onToggleSlot(allocation.slot, event.target.checked)}
              className="h-5 w-5 shrink-0 accent-primary"
            />
            <span className="text-sm text-foreground">{MEAL_SLOT_LABELS_FR[allocation.slot]}</span>
          </label>
        ))}
      </div>

      {/* Les trois onglets internes. */}
      <div
        role="tablist"
        aria-label="Macronutriment à répartir"
        className="mb-4 flex gap-2"
      >
        {MACRO_KEYS.map((macro, index) => {
          const actif = macro === macroActive;
          return (
            <button
              key={macro}
              ref={(el) => {
                refs.current[macro] = el;
              }}
              type="button"
              role="tab"
              aria-selected={actif}
              aria-controls={panneauId}
              tabIndex={actif ? 0 : -1}
              onClick={() => setMacroActive(macro)}
              onKeyDown={(event) => auClavier(event, index)}
              className={`pressable flex min-h-[44px] flex-1 flex-col items-center justify-center rounded-control border px-2 py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                actif
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border text-muted-foreground hover:border-primary hover:text-primary"
              }`}
            >
              <span className="text-[11px] font-bold uppercase tracking-widest">
                {MACRO_LABELS_FR[macro]}
              </span>
              <span className={`text-[10px] ${actif ? "opacity-80" : "opacity-70"}`}>
                {formatDecimalFr(grammesJour[macro], 1)}
                {NBSP}g
              </span>
            </button>
          );
        })}
      </div>

      {/* UNE SEULE liste rendue : l'onglet sélectionné remplace le précédent. */}
      <div id={panneauId} role="tabpanel" aria-label={MACRO_LABELS_FR[macroActive]}>
        <NutritionMacroDistributionPanel
          state={etat}
          macro={macroActive}
          dailyGrams={grammesJour[macroActive]}
          onChangeSlotBp={(slot, bp) => onChangeSlotBp(slot, macroActive, bp)}
          onToggleLock={(slot) => onToggleLock(macroActive, slot)}
        />
      </div>
    </section>
  );
}

/**
 * Une seule ligne d'explication quand AUCUN horaire n'est applicable —
 * inutile de répéter la même raison quatre fois sous quatre boutons gris.
 * Dès qu'un horaire au moins fonctionne, on se tait : l'info-bulle des
 * boutons désactivés suffit.
 */
function messagePresets(
  etat: Readonly<Record<HoraireEntrainement, { readonly ok: boolean; readonly message?: string }>>,
): string | null {
  const horaires = HORAIRES_ENTRAINEMENT;
  if (horaires.some((h) => etat[h].ok)) return null;
  const messages = new Set(horaires.map((h) => etat[h].message).filter((m): m is string => Boolean(m)));
  // Toutes identiques (cas « nombre de repas non couvert ») : on la donne.
  if (messages.size === 1) return [...messages][0];
  return "Les répartitions de référence couvrent 3 à 5 repas, et attendent des créneaux précis.";
}
