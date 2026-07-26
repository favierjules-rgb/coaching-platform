"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

import { bodyOverflowFor } from "@/lib/admin-shell-nav";

/**
 * Verrou de scroll du document partagé par TOUTES les modales admin (polish
 * final — l'arrière-plan défilait derrière les modales alors que le drawer
 * d'AdminShell le bloquait déjà). Compteur module : la première modale
 * ouverte mémorise `body.style.overflow` et pose "hidden" (même helper
 * `bodyOverflowFor` que le drawer) ; seule la fermeture de la DERNIÈRE
 * modale restaure exactement la valeur d'origine — une modale empilée qui se
 * ferme ne débloque donc pas le body sous celle qui reste ouverte. Le
 * cleanup d'effet couvre bouton, overlay, Échap ET démontage du composant.
 */
let openModalCount = 0;
let previousBodyOverflow = "";

function lockBodyScroll() {
  if (openModalCount === 0) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = bodyOverflowFor(true, previousBodyOverflow);
  }
  openModalCount += 1;
}

function unlockBodyScroll() {
  openModalCount = Math.max(0, openModalCount - 1);
  if (openModalCount === 0) {
    document.body.style.overflow = bodyOverflowFor(false, previousBodyOverflow);
  }
}

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ title, onClose, children, maxWidth = "max-w-md" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // Fermeture au clavier (Échap) + piège de focus basique (Tab/Shift+Tab
  // restent dans la modale) — audit design juillet 2026, Lot 1. Polish Apple
  // admin (Lot C) : au démontage, le focus REVIENT à l'élément qui avait le
  // focus à l'ouverture (le déclencheur), au lieu d'être perdu ; le titre est
  // relié via aria-labelledby. Ce composant est partagé par toutes les
  // modales admin — aucun changement d'API, aucun consommateur à modifier.
  //
  // CORRECTION BLOQUANTE « Réponse coach » (25/07/2026) : l'effet dépendait
  // de [onClose]. Or les consommateurs passent une fonction recréée à chaque
  // rendu — à CHAQUE frappe dans un champ de la modale, l'état parent change,
  // `onClose` change d'identité, l'effet se ré-exécutait entièrement et
  // `dialogRef.current?.focus()` VOLAIT le focus du textarea (1 caractère
  // puis perte du curseur). L'effet ne s'exécute désormais qu'UNE fois au
  // montage ; `onClose` est lu via une ref tenue à jour, sans jamais
  // re-déclencher l'effet, re-verrouiller le scroll ni re-focaliser.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    lockBodyScroll();
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      previouslyFocused?.focus?.();
    };
    // Montage/démontage uniquement — voir commentaire ci-dessus : toute
    // dépendance réactive ici re-focaliserait la modale à chaque frappe.
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="modal-overlay-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(event) => {
        // Ferme au clic sur l'overlay uniquement (pas sur le contenu de la
        // modale) — comparaison de cible stricte, pas de stopPropagation
        // nécessaire côté contenu.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`modal-content-scale-in flex max-h-[90vh] w-full ${maxWidth} flex-col overflow-hidden rounded-card border border-border bg-card shadow-soft outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <h3 id={titleId} className="font-heading text-lg font-bold uppercase text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-2 -mt-1 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-surface-soft hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="pressable min-h-[44px] w-full rounded-control bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
    >
      {children}
    </button>
  );
}

export function OutlineButton({
  children,
  onClick,
  href,
}: {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
}) {
  const className =
    "pressable inline-flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  if (href) {
    return (
      <a href={href} className={className}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {children}
    </button>
  );
}
