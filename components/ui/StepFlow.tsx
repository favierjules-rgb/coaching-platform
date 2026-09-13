"use client";

import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Briques d'interface d'un parcours PAS À PAS — une étape par écran, avec
 * retour arrière.
 *
 * ⚠️ POURQUOI UN SECOND JEU DE BRIQUES PLUTÔT QUE D'ÉTENDRE
 * `ProgressiveQuestions`. Celui-ci dévoile les questions VERTICALEMENT :
 * toutes les questions atteintes restent montées, on descend dans la page.
 * Ici une seule étape existe à la fois et on peut revenir en arrière — deux
 * comportements incompatibles. `ProgressiveQuestions` est en outre partagé
 * avec « Mon bilan offert » : l'étendre ferait dériver un formulaire qui
 * n'a rien demandé. Les deux jeux coexistent, chacun avec son usage.
 *
 * Accessibilité : la carte d'étape est un `group` labellisé par sa question,
 * la progression est annoncée une seule fois (région live unique, portée par
 * le parent), les cibles font ≥ 44 px, et le focus est déplacé sur le titre
 * de l'étape à CHAQUE changement d'étape — contrairement au dévoilement
 * vertical, où déplacer le focus couperait la frappe. Ici le changement est
 * toujours provoqué par un clic délibéré sur « Continuer » ou « Retour ».
 */

/** Barre de progression du parcours. */
export function StepProgress({ current, total }: { current: number; total: number }) {
  const percent = Math.round((current / total) * 100);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <p className="font-heading text-xs font-semibold uppercase tracking-[0.3em] text-primary">
          Étape {current} sur {total}
        </p>
        <p className="text-xs uppercase tracking-widest text-muted-foreground">{percent} %</p>
      </div>
      <div className="h-1 w-full rounded-full bg-border" aria-hidden>
        <div
          className="h-1 rounded-full bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Une étape. Le contenu n'est monté que lorsqu'elle est active : les autres
 * étapes n'existent ni pour la souris, ni pour le clavier, ni pour un
 * lecteur d'écran.
 */
export function Step({
  titleId,
  title,
  hint,
  animate,
  children,
}: {
  titleId: string;
  title: string;
  hint?: string;
  animate: boolean;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-labelledby={titleId}
      className={animate ? "step-enter" : undefined}
    >
      <h3
        id={titleId}
        tabIndex={-1}
        className="font-heading text-xl font-extrabold uppercase leading-tight text-foreground focus-visible:outline-none sm:text-2xl md:text-3xl"
      >
        {title}
      </h3>
      {hint ? <p className="mt-3 text-sm text-muted-foreground">{hint}</p> : null}
      <div className="mt-8">{children}</div>
    </div>
  );
}

/**
 * Grande carte de choix — cible tactile généreuse, état sélectionné lisible
 * autrement que par la seule couleur (coche + bordure + fond).
 *
 * `multiple` change le rôle ET la forme du repère : un choix unique se
 * comporte en radio, un choix multiple en case à cocher. Les deux restent
 * des `<button>` — pas d'input masqué sous un label, ce qui casse la
 * navigation clavier sur certains lecteurs d'écran.
 */
export function ChoiceCard({
  selected,
  multiple,
  label,
  description,
  onSelect,
}: {
  selected: boolean;
  multiple?: boolean;
  label: string;
  description?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      onClick={onSelect}
      className={`pressable flex min-h-[64px] w-full items-center justify-between gap-4 border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:p-5 ${
        selected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:border-primary/60"
      }`}
    >
      <span className="flex flex-col gap-1">
        <span
          className={`font-heading text-sm font-bold uppercase leading-tight sm:text-base ${
            selected ? "text-foreground" : "text-foreground/90"
          }`}
        >
          {label}
        </span>
        {description ? (
          <span className="text-xs leading-relaxed text-muted-foreground">{description}</span>
        ) : null}
      </span>
      <span
        aria-hidden
        className={`flex h-6 w-6 flex-shrink-0 items-center justify-center border transition-colors ${
          multiple ? "rounded-[4px]" : "rounded-full"
        } ${selected ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}
      >
        {selected ? <Check size={14} strokeWidth={3} /> : null}
      </span>
    </button>
  );
}

/** Grille de cartes de choix — une colonne sur mobile, deux dès 640 px. */
export function ChoiceGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
  return (
    <div className={`grid grid-cols-1 gap-3 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>{children}</div>
  );
}

/**
 * Barre de navigation du parcours.
 *
 * ⚠️ « Continuer » EST TOUJOURS CLIQUABLE, JAMAIS DÉSACTIVÉ. Un bouton
 * `disabled` ne dit pas POURQUOI il l'est, n'est pas focusable, et laisse
 * l'utilisateur chercher ce qui manque. Le bouton reste actif et, si
 * l'étape est incomplète, affiche l'erreur correspondante. C'est la même
 * règle que pour les champs : on explique, on ne bloque pas en silence.
 */
export function StepNav({
  onBack,
  onNext,
  backLabel = "Retour",
  nextLabel = "Continuer",
  showBack,
  nextDisabled,
  busy,
}: {
  onBack: () => void;
  onNext: () => void;
  backLabel?: string;
  nextLabel?: string;
  showBack: boolean;
  nextDisabled?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="mt-10 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      {showBack ? (
        <button
          type="button"
          onClick={onBack}
          className="pressable inline-flex min-h-[48px] items-center justify-center gap-2 border border-border px-5 py-3 text-sm font-bold uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <ArrowLeft size={16} aria-hidden />
          {backLabel}
        </button>
      ) : (
        <span className="hidden sm:block" />
      )}

      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        aria-busy={busy ? true : undefined}
        className="pressable inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60 sm:flex-none"
      >
        {nextLabel}
        <ArrowRight size={16} aria-hidden />
      </button>
    </div>
  );
}
