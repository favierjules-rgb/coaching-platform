"use client";

import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Briques d'interface des questionnaires progressifs — partagées par
 * « Services aux entreprises » et « Mon bilan offert ».
 *
 * Extraites du formulaire entreprise en juillet 2026, sans la moindre
 * modification de rendu : le HTML produit est identique au caractère près
 * (vérifié par comparaison du rendu avant/après extraction). Les deux
 * formulaires restent ainsi visuellement alignés sans que l'un puisse
 * dériver de l'autre.
 */

/** Message d'erreur d'un champ — placé juste sous lui, relié par `aria-describedby`. */
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" aria-hidden />
      {message}
    </p>
  );
}

/**
 * Une question. `revealed` conditionne le montage : une question non encore
 * atteinte n'existe pas dans le DOM — ni pour la souris, ni pour le clavier,
 * ni pour un lecteur d'écran. L'animation d'apparition ne joue qu'après la
 * première interaction (`animate`), pour que le premier rendu de la page
 * soit immobile.
 */
export function QuestionBlock({
  index,
  label,
  revealed,
  animate,
  children,
}: {
  index: number;
  label: string;
  revealed: boolean;
  animate: boolean;
  children: ReactNode;
}) {
  if (!revealed) return null;
  return (
    <div
      className={`border-t border-border pt-8 first:border-t-0 first:pt-0 ${animate ? "question-reveal" : ""}`}
    >
      <p className="mb-1 font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
        0{index}
      </p>
      <h3 className="mb-4 font-heading text-lg font-bold uppercase text-foreground sm:text-xl">{label}</h3>
      {children}
    </div>
  );
}

/** Repère de progression — remplace la vue d'ensemble perdue par le dévoilement. */
export function ProgressIndicator({ current, total }: { current: number; total: number }) {
  const percent = Math.round((current / total) * 100);
  return (
    <div className="flex flex-col gap-2">
      {/* Pas d'`aria-live` ici : l'annonce est portée par l'unique région
          live du formulaire, en bas — sinon le changement serait lu deux fois. */}
      <p className="text-xs uppercase tracking-widest text-muted-foreground">
        Question {current} sur {total}
      </p>
      <div className="h-px w-full bg-border" aria-hidden>
        <div
          className="h-px bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** Classe commune des champs de saisie : cible tactile ≥ 44 px, focus visible. */
export const progressiveInputClass =
  "min-h-[44px] w-full border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";

/** Classe commune d'une option cliquable (radio ou case à cocher). */
export function progressiveOptionClass(selected: boolean): string {
  return `pressable flex min-h-[44px] cursor-pointer items-center gap-3 border px-4 py-3 text-sm transition-colors ${
    selected
      ? "border-primary bg-primary/10 text-foreground"
      : "border-border text-muted-foreground hover:border-primary/60"
  }`;
}
