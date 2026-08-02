"use client";

import { useState } from "react";
import { CheckCircle, UserPlus } from "lucide-react";

import { terminerAssignation, toggleStudentSelection } from "@/lib/assignment-selection";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StudentPickerList } from "@/components/admin/StudentPickerList";
import type { AdminStudent, AssignableContentType } from "@/types";

interface AssignStudentsModalProps {
  contentLabel: string;
  contentType: AssignableContentType;
  contentId: string;
  students: AdminStudent[];
  assignedStudentIds: string[];
  onSetAssignment: (
    studentId: string,
    contentType: AssignableContentType,
    contentId: string,
    assigned: boolean,
  ) => void | boolean | Promise<boolean | void>;
  triggerLabel?: string;
  triggerVariant?: "primary" | "outline";
}

export function AssignStudentsModal({
  contentLabel,
  contentType,
  contentId,
  students,
  assignedStudentIds,
  onSetAssignment,
  triggerLabel = "Assigner",
  triggerVariant = "outline",
}: AssignStudentsModalProps) {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  // Correctif fix/program-assignment-checkbox : la sélection vit ICI,
  // localement, initialisée depuis les assignations existantes à CHAQUE
  // ouverture (fermer/rouvrir recharge donc l'état réel). Aucune écriture
  // pendant la sélection — le diff ne part qu'au clic sur « Terminer ».
  const [selection, setSelection] = useState<string[]>([]);
  // Atomicité UI : « Terminer » attend TOUTES les écritures (verrou
  // anti-double-clic), et un échec laisse la modale OUVERTE avec un message
  // — jamais de faux succès.
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  function close() {
    setOpen(false);
    setConfirmed(false);
    setSaving(false);
    setSaveFailed(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setSelection(assignedStudentIds);
          setOpen(true);
        }}
        className={
          triggerVariant === "primary"
            ? "pressable flex min-h-[44px] items-center rounded-control border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            : "pressable flex min-h-[44px] items-center rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        }
      >
        <span className="flex items-center gap-1.5">
          <UserPlus size={13} />
          {triggerLabel}
        </span>
      </button>

      {open && (
        <Modal title={`Assigner — ${contentLabel}`} onClose={close}>
          {confirmed ? (
            <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle size={18} className="flex-shrink-0" />
              Assignation mise à jour.
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Coche les élèves qui doivent avoir accès à ce contenu.
              </p>
              <StudentPickerList
                students={students}
                selectedIds={selection}
                onToggle={(studentId, checked) => setSelection((prev) => toggleStudentSelection(prev, studentId, checked))}
              />
              {saveFailed && (
                <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  L&apos;enregistrement a échoué. Ta sélection est conservée — réessaie, ou vérifie ta connexion.
                </p>
              )}
              <PrimaryButton
                disabled={saving}
                onClick={() => {
                  if (saving) return;
                  setSaving(true);
                  setSaveFailed(false);
                  // SEUL point d'écriture : le diff sélection ↔ assignations
                  // initiales, TOUTES les écritures attendues avant de
                  // confirmer — un échec laisse la modale ouverte.
                  void terminerAssignation(assignedStudentIds, selection, (studentId, assigned) =>
                    onSetAssignment(studentId, contentType, contentId, assigned),
                  ).then(({ ok }) => {
                    setSaving(false);
                    if (ok) {
                      setConfirmed(true);
                    } else {
                      setSaveFailed(true);
                    }
                  });
                }}
              >
                {saving ? "Enregistrement…" : "Terminer"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
