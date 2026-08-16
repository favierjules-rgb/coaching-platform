"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import { COLOR_ORDER, COLOR_STYLES, type ColorKey } from "@/lib/ui/color-keys";

/**
 * N1.6A — SÉLECTEUR DE COULEUR GÉNÉRIQUE.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * D'OÙ IL VIENT
 * ────────────────────────────────────────────────────────────────────────────
 * C'est `BlockColorPicker` (blocs d'entraînement, lot 4.2) rendu générique, pas
 * un second sélecteur. Le comportement, les classes et l'accessibilité sont
 * repris à l'identique ; seul le type de la valeur s'élargit.
 * `BlockColorPicker` l'appelle désormais — il n'existe donc toujours qu'UNE
 * implémentation, et une seule table de styles.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ACCESSIBILITÉ — CE QUI EST NON NÉGOCIABLE
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ LA COULEUR N'EST JAMAIS LA SEULE INFORMATION. Chaque entrée porte son NOM
 * ÉCRIT (« Rouge », « Vert »…), le bouton porte un `aria-label` explicite, et
 * l'état sélectionné est annoncé par `aria-checked`. Une pastille seule serait
 * invisible pour un lecteur d'écran et ambiguë pour un daltonien.
 *
 * ⚠️ CIBLE TACTILE `min-h-11`, fermeture à Échap et au clic extérieur.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CE QU'IL NE FAIT PAS
 * ────────────────────────────────────────────────────────────────────────────
 * ⚠️ AUCUNE SÉMANTIQUE. Il ne sait pas ce qu'il colore, et ne doit jamais le
 * savoir : ni bloc, ni liste, ni rôle, ni catégorie. Une couleur choisie ici ne
 * change AUCUN calcul, nulle part.
 */
export function ColorKeyPicker({
  value,
  onChange,
  ariaLabel,
  /**
   * `true` : une entrée « Aucune » est proposée en tête et rend `null`.
   *
   * ⚠️ ELLE N'EST PAS DÉCORATIVE. Pour une liste d'aliments, `null` (« aucune
   * couleur ») et `gray` (« gris ») sont deux états DIFFÉRENTS : le premier
   * n'affiche aucun accent, le second affiche une pastille grise. Sans cette
   * entrée, un coach ne pourrait jamais revenir en arrière.
   */
  autoriserAucune = false,
  libelleAucune = "Aucune",
}: {
  readonly value: ColorKey | null;
  readonly onChange: (color: ColorKey | null) => void;
  readonly ariaLabel: string;
  readonly autoriserAucune?: boolean;
  readonly libelleAucune?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const current = value === null ? null : COLOR_STYLES[value];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Couleur : ${current?.label ?? libelleAucune}`}
        className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {current ? (
          <span className={`h-2.5 w-2.5 rounded-full ${current.dot}`} aria-hidden="true" />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full border border-border" aria-hidden="true" />
        )}
        <span className="hidden sm:inline">{current?.label ?? libelleAucune}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute left-0 z-30 mt-1 flex w-40 flex-col gap-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-lg"
        >
          {autoriserAucune && (
            <button
              type="button"
              role="menuitemradio"
              aria-checked={value === null}
              aria-label={`Couleur ${libelleAucune}`}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs text-foreground transition-colors duration-150 ease-out hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
            >
              <span className="h-3 w-3 flex-shrink-0 rounded-full border border-border" aria-hidden="true" />
              <span className="flex-1">{libelleAucune}</span>
              {value === null && <Check size={13} className="text-primary" aria-hidden="true" />}
            </button>
          )}
          {COLOR_ORDER.map((color) => {
            const style = COLOR_STYLES[color];
            const selected = color === value;
            return (
              <button
                key={color}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-label={`Couleur ${style.label}`}
                onClick={() => {
                  onChange(color);
                  setOpen(false);
                }}
                className="flex min-h-11 items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs text-foreground transition-colors duration-150 ease-out hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
              >
                <span className={`h-3 w-3 flex-shrink-0 rounded-full ${style.dot}`} aria-hidden="true" />
                <span className="flex-1">{style.label}</span>
                {selected && <Check size={13} className="text-primary" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
