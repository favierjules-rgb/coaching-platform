"use client";

import { useState } from "react";
import { CheckCircle, UserPlus } from "lucide-react";

import { CheckboxField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import type { AdminDocument, AdminNutritionPlan, AdminProgram, AdminStudent, AssignableContentType } from "@/types";

interface AssignContentToStudentModalProps {
  student: AdminStudent;
  programs: AdminProgram[];
  nutritionPlans: AdminNutritionPlan[];
  documents: AdminDocument[];
  onSetAssignment: (
    studentId: string,
    contentType: AssignableContentType,
    contentId: string,
    assigned: boolean,
  ) => void;
}

export function AssignContentToStudentModal({
  student,
  programs,
  nutritionPlans,
  documents,
  onSetAssignment,
}: AssignContentToStudentModalProps) {
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
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      >
        <UserPlus size={13} />
        Attribuer contenu
      </button>

      {open && (
        <Modal title={`Attribuer un contenu à ${student.firstName}`} onClose={close} maxWidth="max-w-lg">
          {confirmed ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Contenus attribués mis à jour.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div>
                <h4 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Programmes</h4>
                <div className="flex flex-col gap-2">
                  {programs.map((p) => (
                    <CheckboxField
                      key={p.id}
                      label={p.name}
                      checked={student.assignedProgramIds.includes(p.id)}
                      onChange={(checked) => onSetAssignment(student.id, "programme", p.id, checked)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Plans alimentaires</h4>
                <div className="flex flex-col gap-2">
                  {nutritionPlans.map((p) => (
                    <CheckboxField
                      key={p.id}
                      label={p.name}
                      checked={student.assignedNutritionPlanIds.includes(p.id)}
                      onChange={(checked) => onSetAssignment(student.id, "nutrition", p.id, checked)}
                    />
                  ))}
                </div>
              </div>
              <div>
                <h4 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Documents</h4>
                <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                  {documents.map((d) => (
                    <CheckboxField
                      key={d.id}
                      label={d.title}
                      checked={student.assignedDocumentIds.includes(d.id)}
                      onChange={(checked) => onSetAssignment(student.id, "document", d.id, checked)}
                    />
                  ))}
                </div>
              </div>
              <PrimaryButton onClick={() => setConfirmed(true)}>Terminer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
