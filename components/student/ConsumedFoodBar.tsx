"use client";

import { ChevronRight, PencilLine } from "lucide-react";

import { NBSP, formatDecimalFr, formatIntegerFr } from "@/lib/nutrition/basis-points";
import {
  CONSUMED_UNIT_LABELS_FR,
  type ConsumedEntry,
  entryKcal,
  formatHeureFr,
} from "@/lib/nutrition/consumed";

/**
 * UNE LIGNE PAR ALIMENT CONSOMMÉ — la barre compacte du §2 de l'énoncé.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ Banane, crue                     107 kcal   │
 *   │ 13:24 · 120 g                               │
 *   └─────────────────────────────────────────────┘
 *
 * DEUX LIGNES, jamais une carte. Une journée en compte facilement quinze : à
 * une carte par aliment, l'écran devient une liste de blocs qu'on fait défiler
 * sans rien lire. Le détail — correction, suppression, P/G/L — vit derrière un
 * appui, pas à côté.
 *
 * Les kcal sont DÉRIVÉES du 4/4/9 (`entryKcal`), jamais lues dans une colonne :
 * `meal_entries` n'en a pas, précisément pour qu'aucune valeur stockée ne
 * puisse diverger des macros.
 *
 * Cible tactile : 56 px de haut minimum, largement au-dessus des 44 px
 * recommandés — c'est un élément qu'on vise d'un pouce, en marchant.
 */
export function ConsumedFoodBar({
  entrée,
  onOuvrir,
  désactivé = false,
}: {
  entrée: ConsumedEntry;
  onOuvrir: () => void;
  désactivé?: boolean;
}) {
  const heure = formatHeureFr(entrée.createdAt);
  const quantité = `${formatDecimalFr(entrée.quantity, entrée.quantity % 1 === 0 ? 0 : 1)}${NBSP}${CONSUMED_UNIT_LABELS_FR[entrée.unit]}`;
  const manuel = entrée.sourceType === "free";

  return (
    <button
      type="button"
      onClick={onOuvrir}
      disabled={désactivé}
      aria-label={`${entrée.label}, ${quantité}, modifier`}
      className="pressable flex min-h-[56px] w-full items-center gap-3 rounded-control border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          {/* `truncate` + `min-w-0` : un libellé long se coupe proprement au
              lieu de pousser les kcal hors de l'écran sur iPhone. */}
          <span className="truncate text-sm font-semibold text-foreground">{entrée.label}</span>
          <span className="flex-shrink-0 text-sm font-bold tabular-nums text-foreground">
            {formatIntegerFr(entryKcal(entrée))}
            {NBSP}kcal
          </span>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          {heure && <span className="tabular-nums">{heure}</span>}
          {heure && <span aria-hidden="true">·</span>}
          <span className="tabular-nums">{quantité}</span>
          {manuel && (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1">
                <PencilLine size={11} aria-hidden="true" />
                Saisi à la main
              </span>
            </>
          )}
        </span>
      </span>
      <ChevronRight size={16} className="flex-shrink-0 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
