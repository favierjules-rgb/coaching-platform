"use client";

import { useId, useState, type ReactNode } from "react";
import { CheckCircle, X } from "lucide-react";

interface MockActionModalProps {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  successMessage: string;
  triggerVariant?: "primary" | "outline";
  children?: ReactNode;
}

/**
 * Action mockée (aucune donnée envoyée nulle part) : ouvre un panneau,
 * affiche un formulaire d'exemple puis un message de confirmation. Sert de
 * base aux boutons "Modifier mes informations", "Ajouter une photo",
 * "Mettre à jour mes mensurations" et "Mettre à jour mon poids".
 */
export function MockActionModal({
  triggerLabel,
  title,
  description,
  confirmLabel,
  successMessage,
  triggerVariant = "outline",
  children,
}: MockActionModalProps) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function close() {
    setOpen(false);
    setSubmitted(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          triggerVariant === "primary"
            ? "border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
            : "border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        }
      >
        {triggerLabel}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md border border-border bg-card p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <h3 className="font-heading text-lg font-bold uppercase text-foreground">
                {title}
              </h3>
              <button
                type="button"
                onClick={close}
                aria-label="Fermer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <X size={18} />
              </button>
            </div>

            {submitted ? (
              <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
                <CheckCircle size={18} className="flex-shrink-0" />
                {successMessage}
              </div>
            ) : (
              <>
                <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
                  {description}
                </p>
                {children && <div className="mb-5 flex flex-col gap-4">{children}</div>}
                <button
                  type="button"
                  onClick={() => setSubmitted(true)}
                  className="w-full bg-primary py-3 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
                >
                  {confirmLabel}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export function MockField({
  label,
  placeholder,
  type = "text",
}: {
  label: string;
  placeholder?: string;
  type?: string;
}) {
  const id = useId();
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground"
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        className="w-full border border-border bg-background px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
      />
    </div>
  );
}
