"use client";

import { useState } from "react";
import { CheckCircle, UserPlus } from "lucide-react";

import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StudentPickerList } from "@/components/admin/StudentPickerList";
import type { AdminStudent, AssignableContentType } from "@/types";

interface AssignStudentsModalProps {
  contentLabel: string;
  contentType: AssignableContentType;
  contentId: string;
  students: AdminStudent[];
  assignedStudentIds: string[];
  onSetAssignment: (studentId: string, contentType: AssignableContentType, contentId: string, assigned: boolean) => void;
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

  function close() {
    setOpen(false);
    setConfirmed(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={
          triggerVariant === "primary"
            ? "border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary-hover"
            : "border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
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
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
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
                selectedIds={assignedStudentIds}
                onToggle={(studentId, checked) => onSetAssignment(studentId, contentType, contentId, checked)}
              />
              <PrimaryButton onClick={() => setConfirmed(true)}>Terminer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
