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
  /** true si l'élève affiché est lui-même réel (Supabase). */
  isSupabaseStudent?: boolean;
  /** true si `programs` contient de vrais programmes Supabase et que cet élève est lui-même réel. */
  canAssignRealPrograms?: boolean;
  /** true si `nutritionPlans` contient de vrais plans Supabase et que cet élève est lui-même réel. */
  canAssignRealNutrition?: boolean;
  /** true si `documents` contient de vrais documents Supabase et que cet élève est lui-même réel. */
  canAssignRealDocuments?: boolean;
}

export function AssignContentToStudentModal({
  student,
  programs,
  nutritionPlans,
  documents,
  onSetAssignment,
  isSupabaseStudent = false,
  canAssignRealPrograms = false,
  canAssignRealNutrition = false,
  canAssignRealDocuments = false,
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
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
      >
        <UserPlus size={13} />
        Attribuer contenu
      </button>

      {open && (
        <Modal title={`Attribuer un contenu à ${student.firstName}`} onClose={close} maxWidth="max-w-lg">
          {confirmed ? (
            <div className="flex items-center gap-3 rounded-panel border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
              <CheckCircle size={18} className="flex-shrink-0" />
              Contenus attribués mis à jour.
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              <div>
                <h4 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Programmes</h4>
                {isSupabaseStudent && !canAssignRealPrograms ? (
                  <div className="flex items-start gap-3 rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
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

              <div>
                <h4 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Plans alimentaires</h4>
                {isSupabaseStudent && !canAssignRealNutrition ? (
                  <div className="flex items-start gap-3 rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    <Info size={18} className="mt-0.5 flex-shrink-0" />
                    Crée d&apos;abord un plan alimentaire réel (Admin &gt; Nutrition) pour pouvoir l&apos;attribuer à
                    cet élève.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {nutritionPlans.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun plan créé pour le moment.</p>
                    )}
                    {nutritionPlans.map((p) => (
                      <CheckboxField
                        key={p.id}
                        label={p.name}
                        checked={student.assignedNutritionPlanIds.includes(p.id)}
                        onChange={(checked) => onSetAssignment(student.id, "nutrition", p.id, checked)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="mb-3 text-xs uppercase tracking-wide text-muted-foreground">Documents</h4>
                {isSupabaseStudent && !canAssignRealDocuments ? (
                  <div className="flex items-start gap-3 rounded-panel border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning">
                    <Info size={18} className="mt-0.5 flex-shrink-0" />
                    Crée d&apos;abord un document réel (Admin &gt; Documents) pour pouvoir l&apos;attribuer à cet
                    élève.
                  </div>
                ) : (
                  <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                    {documents.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun document créé pour le moment.</p>
                    )}
                    {documents.map((d) => (
                      <CheckboxField
                        key={d.id}
                        label={d.title}
                        checked={student.assignedDocumentIds.includes(d.id)}
                        onChange={(checked) => onSetAssignment(student.id, "document", d.id, checked)}
                      />
                    ))}
                  </div>
                )}
              </div>

              <PrimaryButton onClick={() => setConfirmed(true)}>Terminer</PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
