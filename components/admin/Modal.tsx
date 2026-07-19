"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ title, onClose, children, maxWidth = "max-w-md" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Fermeture au clavier (Échap) + piège de focus basique (Tab/Shift+Tab
  // restent dans la modale) — audit design juillet 2026, Lot 1 : ce
  // composant est partagé par toutes les modales admin, ces deux
  // comportements manquaient partout. Ajoutés une seule fois ici plutôt que
  // par consommateur ; aucun changement d'API, aucun consommateur existant à
  // modifier.
  useEffect(() => {
    dialogRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
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
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
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
        className={`modal-content-scale-in flex max-h-[90vh] w-full ${maxWidth} flex-col border border-border bg-card outline-none`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <h3 className="font-heading text-lg font-bold uppercase text-foreground">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-muted-foreground transition-colors hover:text-foreground"
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
      className="w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary"
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
    "border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary";
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
