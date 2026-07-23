"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, Dumbbell, Plus } from "lucide-react";

import type { TrainingBlockCategory } from "@/types";

/**
 * Menu « + Ajouter un bloc » (Lot 4.2). Propose UNIQUEMENT Musculation et
 * Cardio — jamais Mixed ni Repos (le repos est l'état émergent d'une séance sans
 * bloc, le type mixed est dérivé). Accessible au clavier, fermeture Échap.
 */
export function AddTrainingBlockMenu({ onAdd }: { onAdd: (category: TrainingBlockCategory) => void }) {
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

  function pick(category: TrainingBlockCategory) {
    onAdd(category);
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3 text-xs uppercase tracking-widest text-muted-foreground transition-colors duration-150 ease-out hover:border-primary hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-[0.99]"
      >
        <Plus size={14} />
        Ajouter un bloc
      </button>

      {open && (
        <div
          role="menu"
          className="animate-fade-in absolute left-1/2 z-20 mt-1 flex w-56 -translate-x-1/2 flex-col gap-0.5 rounded-2xl border border-border bg-card p-1.5 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("strength")}
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors duration-150 ease-out hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            <Dumbbell size={15} className="text-muted-foreground" aria-hidden="true" />
            Bloc Musculation
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => pick("cardio")}
            className="flex min-h-11 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm text-foreground transition-colors duration-150 ease-out hover:bg-card-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            <Activity size={15} className="text-muted-foreground" aria-hidden="true" />
            Bloc Cardio
          </button>
        </div>
      )}
    </div>
  );
}
