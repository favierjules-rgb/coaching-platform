"use client";

import { useState } from "react";
import { CheckCircle, StickyNote } from "lucide-react";

import { TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";

export function AddCoachNoteModal({ onAdd }: { onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [text, setText] = useState("");

  function close() {
    setOpen(false);
    setSubmitted(false);
    setText("");
  }

  function handleSubmit() {
    if (!text.trim()) return;
    onAdd(text.trim());
    setSubmitted(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <StickyNote size={13} />
        Ajouter une note
      </button>

      {open && (
        <Modal title="Ajouter une note coach" onClose={close}>
          {submitted ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Note ajoutée.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <TextareaField label="Note privée" value={text} onChange={setText} rows={4} placeholder="Visible uniquement par toi..." />
              <PrimaryButton onClick={handleSubmit} disabled={!text.trim()}>
                Enregistrer la note
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
