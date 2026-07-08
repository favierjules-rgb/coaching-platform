"use client";

import { useState } from "react";
import { CheckCircle, Info, UserPlus } from "lucide-react";

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
  /**
   * Élève Supabase : plans nutrition/documents ne sont pas encore migrés
   * (leurs ids mock ne sont pas des UUID, donc aucune ligne
   * `document_assignments` ne peut réellement être créée) — ces deux
   * sections restent un message informatif plutôt que des cases à cocher
   * factices. Les programmes, eux, sont réellement assignables dès que
   * `canAssignRealPrograms` est vrai (voir `programsAreSupabase` au niveau
   * de la page appelante).
   */
  isSupabaseStudent?: boolean;
  /** true si `programs` contient de vrais programmes Supabase et que cet élève est lui-même réel. */
  canAssignRealPrograms?: boolean;
}

export function AssignContentToStudentModal({
  student,
  programs,
  nutritionPlans,
  documents,
  onSetAssignment,
  isSupabaseStudent = false,
  canAssignRealPrograms = false,
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
                {isSupabaseStudent && !canAssignRealPrograms ? (
                  <div className="flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                    <Info size={18} className="mt-0.5 flex-shrink-0" />
                    Crée d&apos;abord un programme réel (Admin &gt; Programmes) pour pouvoir l&apos;attribuer à cet élève.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {programs.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun programme créé pour le moment.</p>
                    )}
                    {programs.map((p) => (
                      <CheckboxField
                        key={p.id}
                        label={p.name}
                        checked={student.assignedProgramIds.includes(p.id)}
                        onChange={(checked) => onSetAssignment(student.id, "programme", p.id, checked)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {isSupabaseStudent ? (
                <div className="flex items-start gap-3 border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
                  <Info size={18} className="mt-0.5 flex-shrink-0" />
                  Plans alimentaires et documents : attribution disponible après la migration de ces contenus vers
                  Supabase. Cette action n&apos;est pas encore persistée pour cet élève.
                </div>
              ) : (
                <>
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
                </>
              )}

              <PrimaryButton onClick={() => setConfirmed(true)}>Terminer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
