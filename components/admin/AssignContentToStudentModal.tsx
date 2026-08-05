"use client";

import { useState } from "react";
import { CheckCircle, Info, UserPlus } from "lucide-react";

import {
  filterAssignableProgramModels,
  initialContentSelection,
  terminerAssignation,
  terminerAssignationUnique,
  toggleSingleSelection,
  toggleStudentSelection,
  type ContentSelection,
} from "@/lib/assignment-selection";
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
  ) => void | boolean | Promise<boolean | void>;
  /** true si l'élève affiché est lui-même réel (Supabase). */
  isSupabaseStudent?: boolean;
  /** true si `programs` contient de vrais programmes Supabase et que cet élève est lui-même réel. */
  canAssignRealPrograms?: boolean;
  /** true si `nutritionPlans` contient de vrais plans Supabase et que cet élève est lui-même réel. */
  canAssignRealNutrition?: boolean;
  /** true si `documents` contient de vrais documents Supabase et que cet élève est lui-même réel. */
  canAssignRealDocuments?: boolean;
}

const SELECTION_VIDE: ContentSelection = { programme: [], nutrition: [], document: [] };

/**
 * Modale « Attribuer un contenu à [élève] » de la fiche élève admin —
 * réécrite (fix/student-profile-content-assignment) sur le pattern validé
 * d'AssignStudentsModal :
 *
 * - la sélection vit LOCALEMENT, initialisée depuis l'état réel à CHAQUE
 *   ouverture (fermer/rouvrir recharge les vraies coches) ;
 * - cocher/décocher ne modifie QUE la sélection locale — AUCUNE écriture ;
 * - « Terminer » est le SEUL point d'écriture : diff sélection ↔ état
 *   initial par type de contenu, toutes les écritures attendues, un échec
 *   laisse la modale ouverte avec la sélection conservée ;
 * - fermer par la croix abandonne la sélection sans rien écrire ;
 * - la liste des programmes n'affiche que les MODÈLES (les copies
 *   individuelles — ownerStudentId posé — sont exclues) ; un modèle est
 *   coché si une assignation ACTIVE pointe vers lui ou vers la copie de
 *   l'élève (isProgramCheckedForStudent) ;
 * - aucun email, achat ni webhook n'est déclenché ici (la page passe
 *   notifyByEmail: false à useContentAssignment).
 */
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
  // État initial figé à l'ouverture (base du diff du « Terminer ») et
  // sélection locale visible — voir lib/assignment-selection.
  const [initial, setInitial] = useState<ContentSelection>(SELECTION_VIDE);
  const [selection, setSelection] = useState<ContentSelection>(SELECTION_VIDE);
  // Atomicité UI : « Terminer » attend TOUTES les écritures (verrou
  // anti-double-clic), un échec laisse la modale OUVERTE avec un message.
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  // Seuls les MODÈLES sont proposables — jamais les copies individuelles
  // (elles dupliqueraient la ligne du modèle, et attribuer la copie d'un
  // élève n'a pas de sens produit). Les programmes mock restent listés.
  const modeles = filterAssignableProgramModels(programs);

  function ouvrir() {
    const état = initialContentSelection(student, {
      programs,
      nutritionPlanIds: nutritionPlans.map((p) => p.id),
      documentIds: documents.map((d) => d.id),
    });
    setInitial(état);
    setSelection(état);
    setConfirmed(false);
    setSaving(false);
    setSaveFailed(false);
    setOpen(true);
  }

  // Fermeture (croix, ou après confirmation) : AUCUNE écriture — la
  // sélection locale est simplement abandonnée.
  function close() {
    setOpen(false);
    setConfirmed(false);
    setSaving(false);
    setSaveFailed(false);
  }

  function basculer(type: AssignableContentType, contentId: string, checked: boolean) {
    // NUTRITION = CHOIX UNIQUE. Un élève n'a qu'un seul plan nutritionnel
    // assigné à la fois (index unique partiel sur nutrition_plans.student_id) :
    // cocher un plan remplace le précédent au lieu de s'y ajouter.
    // Programmes et documents restent en sélection multiple, inchangés.
    const bascule = type === "nutrition" ? toggleSingleSelection : toggleStudentSelection;
    setSelection((prev) => ({ ...prev, [type]: bascule(prev[type], contentId, checked) }));
  }

  function terminer() {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    // SEUL point d'écriture de la modale : un diff par type de contenu,
    // toutes les écritures attendues (terminerAssignation) — un `false` ou
    // un rejet quelconque rend l'ensemble en échec, jamais de faux succès.
    //
    // NUTRITION : `terminerAssignationUnique` n'émet AUCUN retrait quand un
    // plan est sélectionné — la RPC assign_nutrition_plan retire l'ancien
    // dans la même transaction. Émettre les deux recréerait un enchaînement
    // « désassigner puis assigner » non transactionnel, avec une fenêtre
    // pendant laquelle l'élève n'a aucun plan.
    void Promise.all(
      (["programme", "nutrition", "document"] as const).map((type) => {
        const terminerType = type === "nutrition" ? terminerAssignationUnique : terminerAssignation;
        return terminerType(initial[type], selection[type], (contentId, assigned) =>
          onSetAssignment(student.id, type, contentId, assigned),
        );
      }),
    ).then((résultats) => {
      setSaving(false);
      if (résultats.every(({ ok }) => ok)) {
        setConfirmed(true);
      } else {
        setSaveFailed(true);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={ouvrir}
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
                    {modeles.length === 0 && (
                      <p className="text-sm text-muted-foreground">Aucun programme créé pour le moment.</p>
                    )}
                    {modeles.map((p) => (
                      <CheckboxField
                        key={p.id}
                        label={p.name}
                        checked={selection.programme.includes(p.id)}
                        onChange={(checked) => basculer("programme", p.id, checked)}
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
                        checked={selection.nutrition.includes(p.id)}
                        onChange={(checked) => basculer("nutrition", p.id, checked)}
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
                        checked={selection.document.includes(d.id)}
                        onChange={(checked) => basculer("document", d.id, checked)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {saveFailed && (
                <p className="rounded-panel border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  L&apos;enregistrement a échoué. Ta sélection est conservée — réessaie, ou vérifie ta connexion.
                </p>
              )}
              <PrimaryButton disabled={saving} onClick={terminer}>
                {saving ? "Enregistrement…" : "Terminer"}
              </PrimaryButton>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
