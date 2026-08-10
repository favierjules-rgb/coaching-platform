"use client";

import { useCallback, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/**
 * LA COQUILLE — ET RIEN D'AUTRE.
 *
 * ════════════════════════════════════════════════════════════════════════
 * POURQUOI UN PORTAIL, ET NON UN SIMPLE `<div>` SUR PLACE
 * ════════════════════════════════════════════════════════════════════════
 * Ce n'est pas une préférence de style. L'écran de séance rend son
 * formulaire dans un `<fieldset disabled>` tant que le brouillon n'est pas
 * restauré : une modale rendue à l'intérieur hériterait de ce `disabled` et
 * son bouton de fermeture ne recevrait AUCUN clic. Elle se trouverait aussi
 * imbriquée dans un `<form>`, où un bouton sans `type` déclenche un envoi —
 * c'est-à-dire exactement ce que le chantier interdit : pas de submit, pas
 * de reset, pas de nouvelle révision du brouillon.
 *
 * Le portail sort le dialogue de l'arbre du formulaire tout en le laissant
 * dans l'arbre REACT : l'état de la séance n'est ni démonté ni remonté, et
 * la route ne bouge pas.
 *
 * ════════════════════════════════════════════════════════════════════════
 * AUCUNE LOGIQUE MÉTIER ICI
 * ════════════════════════════════════════════════════════════════════════
 * Ni URL, ni source, ni réseau, ni type de média. Cette coquille sait
 * ouvrir, fermer, piéger le focus et rendre ce qu'on lui donne.
 */

interface MediaModalProps {
  ouvert: boolean;
  /** Titre accessible ET visible — c'est le même. */
  titre: string;
  onFermer: () => void;
  children: React.ReactNode;
}

/** Ce qui peut recevoir le focus à l'intérieur du dialogue. */
const FOCUSABLES =
  'a[href], button:not([disabled]), textarea, input, select, iframe, video, [tabindex]:not([tabindex="-1"])';

export function MediaModal({ ouvert, titre, onFermer, children }: MediaModalProps) {
  const idTitre = useId();
  const boite = useRef<HTMLDivElement | null>(null);
  const fermeture = useRef<HTMLButtonElement | null>(null);
  /** L'élément qui avait le focus AVANT l'ouverture — on le lui rendra. */
  const origine = useRef<Element | null>(null);

  const fermer = useCallback(() => {
    onFermer();
  }, [onFermer]);

  useEffect(() => {
    if (!ouvert) return;

    origine.current = document.activeElement;
    const scrollAvant = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function auClavier(evenement: KeyboardEvent) {
      if (evenement.key === "Escape") {
        evenement.stopPropagation();
        fermer();
        return;
      }
      if (evenement.key !== "Tab" || !boite.current) return;
      // Piège à focus : la tabulation tourne DANS le dialogue. Sans cela, le
      // focus repart dans la page derrière le voile, qu'un lecteur d'écran
      // continuerait alors de parcourir.
      const cibles = Array.from(boite.current.querySelectorAll<HTMLElement>(FOCUSABLES));
      if (cibles.length === 0) return;
      const premier = cibles[0];
      const dernier = cibles[cibles.length - 1];
      if (evenement.shiftKey && document.activeElement === premier) {
        evenement.preventDefault();
        dernier.focus();
      } else if (!evenement.shiftKey && document.activeElement === dernier) {
        evenement.preventDefault();
        premier.focus();
      }
    }

    document.addEventListener("keydown", auClavier, true);
    // Le focus part sur la fermeture : c'est le geste le plus probable, et
    // c'est le seul point d'entrée sûr quand le contenu est une iframe
    // tierce dont on ne contrôle pas l'intérieur.
    const minuteur = window.setTimeout(() => fermeture.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", auClavier, true);
      window.clearTimeout(minuteur);
      document.body.style.overflow = scrollAvant;
      // Le focus revient sur le bouton qui a ouvert la modale.
      const precedent = origine.current;
      if (precedent instanceof HTMLElement) precedent.focus();
    };
  }, [ouvert, fermer]);

  if (!ouvert || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 sm:p-6"
      // Le clic sur le VOILE ferme ; un clic dans la carte ne remonte pas
      // jusqu'ici (voir `stopPropagation` ci-dessous).
      onClick={fermer}
      data-media-modal-voile
    >
      <div
        ref={boite}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitre}
        onClick={(evenement) => evenement.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <h2 id={idTitre} className="truncate font-heading text-sm font-bold uppercase text-foreground">
            {titre}
          </h2>
          <button
            ref={fermeture}
            type="button"
            onClick={fermer}
            aria-label="Fermer"
            className="pressable flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-border text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-black">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
