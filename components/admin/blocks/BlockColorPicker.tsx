"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";

import type { BlockColorKey } from "@/lib/training-block-editing";
import { BLOCK_COLOR_ORDER, BLOCK_COLOR_STYLES } from "@/components/admin/blocks/block-view-model";

/**
 * Sélecteur de couleur d'un bloc (Lot 4.2). Accessible : bouton nommé,
 * focus visible, nom TEXTUEL de chaque couleur, état sélectionné annoncé
 * (`aria-pressed`), fermeture clavier (Échap). Accents discrets — la couleur
 * n'est qu'une pastille, jamais un remplissage massif.
 */
export function BlockColorPicker({
  value,
  onChange,
  ariaLabel,
}: {
  value: BlockColorKey;
  onChange: (color: BlockColorKey) => void;
  ariaLabel: string;
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

  const current = BLOCK_COLOR_STYLES[value];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Couleur : ${current.label}`}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 py-2 text-[11px] text-muted-foreground transition-colors duration-150 ease-out hover:border-primary/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.97]"
      >
        <span className={`h-2.5 w-2.5 rounded-full ${current.dot}`} aria-hidden="true" />
        <span className="hidden sm:inline">{current.label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute left-0 z-30 mt-1 flex w-40 flex-col gap-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-lg"
        >
          {BLOCK_COLOR_ORDER.map((color) => {
            const style = BLOCK_COLOR_STYLES[color];
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
                className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-left text-xs text-foreground transition-colors duration-150 ease-out hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
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
