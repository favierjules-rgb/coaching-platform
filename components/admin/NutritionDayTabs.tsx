"use client";

import { useRef } from "react";

import { NBSP, formatIntegerFr } from "@/lib/nutrition/basis-points";
import { WEEKDAY_KEYS, WEEKDAY_LABELS_FR, WEEKDAY_SHORT_LABELS_FR, type WeekdayKey } from "@/lib/nutrition/weekdays";

/**
 * SÉLECTEUR DE JOUR — un seul jour ouvert à la fois.
 *
 * UN SEUL RENDU pour les deux tailles d'écran : la même barre d'onglets
 * défile horizontalement sur mobile (`overflow-x-auto`, accrochage
 * `snap-start`) et tient sur une ligne à partir de `sm`. Dupliquer le balisage
 * en deux versions cachées ferait exister deux fois les mêmes boutons dans
 * l'arbre d'accessibilité.
 *
 * ACCESSIBILITÉ — motif « tabs » du WAI-ARIA :
 *   - `role="tablist"` / `role="tab"` / `aria-selected` ;
 *   - un SEUL onglet dans l'ordre de tabulation, les flèches ← → et les
 *     touches Origine / Fin déplacent la sélection ;
 *   - chaque onglet contrôle le panneau du jour par `aria-controls`.
 *
 * MOUVEMENT — réponse immédiate, aucune animation d'apparition. Le panneau
 * change à l'instant du clic : une transition d'entrée ferait attendre le
 * coach à chaque changement de jour, geste répété des dizaines de fois. Seuls
 * les états de survol et d'appui sont animés, par la classe `pressable`
 * commune, qui respecte déjà `prefers-reduced-motion`.
 */

export function NutritionDayTabs({
  selected,
  onSelect,
  caloriesByDay,
  panelId,
}: {
  readonly selected: WeekdayKey;
  readonly onSelect: (day: WeekdayKey) => void;
  /** Calories de chaque jour — repère visuel, jamais une source de vérité. */
  readonly caloriesByDay: Readonly<Record<WeekdayKey, number>>;
  readonly panelId: string;
}) {
  const refs = useRef<Partial<Record<WeekdayKey, HTMLButtonElement | null>>>({});

  function déplacer(index: number) {
    const cible = WEEKDAY_KEYS[(index + WEEKDAY_KEYS.length) % WEEKDAY_KEYS.length];
    onSelect(cible);
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
      déplacer(WEEKDAY_KEYS.length - 1);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Jour de la semaine"
      aria-orientation="horizontal"
      className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-2 sm:mx-0 sm:snap-none sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      {WEEKDAY_KEYS.map((jour, index) => {
        const actif = jour === selected;
        const kcal = caloriesByDay[jour] ?? 0;
        return (
          <button
            key={jour}
            ref={(el) => {
              refs.current[jour] = el;
            }}
            type="button"
            role="tab"
            id={`${panelId}-onglet-${jour}`}
            aria-selected={actif}
            aria-controls={panelId}
            tabIndex={actif ? 0 : -1}
            onClick={() => onSelect(jour)}
            onKeyDown={(event) => auClavier(event, index)}
            className={`pressable flex min-h-[44px] shrink-0 snap-start flex-col items-center justify-center rounded-control border px-3 py-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:flex-1 ${
              actif
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary hover:text-primary"
            }`}
          >
            <span className="text-[11px] font-bold uppercase tracking-widest">
              <span className="sm:hidden">{WEEKDAY_SHORT_LABELS_FR[jour]}</span>
              <span className="hidden sm:inline">{WEEKDAY_LABELS_FR[jour]}</span>
            </span>
            <span className={`text-[10px] ${actif ? "opacity-80" : "opacity-70"}`}>
              {kcal > 0 ? `${formatIntegerFr(kcal)}${NBSP}kcal` : "—"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
