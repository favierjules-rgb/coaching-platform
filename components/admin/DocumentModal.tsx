"use client";

import { useState } from "react";
import { CheckCircle, Eye, Pencil } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import { StudentPickerList } from "@/components/admin/StudentPickerList";
import {
  distributionModeLabels,
  documentCategoryLabels,
  documentStatusLabels,
  documentTypeLabels,
} from "@/lib/admin";
import type {
  AdminDocument,
  AdminDocumentStatus,
  AdminStudent,
  DocumentCategory,
  DocumentDistributionMode,
  DocumentType,
} from "@/types";

const typeOptions: { value: DocumentType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "vidéo", label: "Vidéo" },
  { value: "lien", label: "Lien" },
  { value: "guide", label: "Guide" },
  { value: "image", label: "Image" },
];

const categoryOptions: { value: DocumentCategory; label: string }[] = [
  { value: "nutrition", label: "Nutrition" },
  { value: "entrainement", label: "Entraînement" },
  { value: "administratif", label: "Administratif" },
];

const statusOptions: { value: AdminDocumentStatus; label: string }[] = [
  { value: "brouillon", label: "Brouillon" },
  { value: "publié", label: "Publié" },
  { value: "archivé", label: "Archivé" },
];

const levelOptions = [
  { value: "1", label: "Niveau 1" },
  { value: "2", label: "Niveau 2" },
  { value: "3", label: "Niveau 3" },
  { value: "4", label: "Niveau 4" },
];

const difficultyOptions = [
  { value: "facile", label: "Facile" },
  { value: "intermédiaire", label: "Intermédiaire" },
  { value: "avancé", label: "Avancé" },
];

const distributionOptions: { value: DocumentDistributionMode; label: string }[] = [
  { value: "immediat", label: "Tout disponible immédiatement" },
  { value: "deblocage-auto", label: "Déblocage automatique progressif" },
  { value: "deblocage-manuel", label: "Déblocage manuel par le coach" },
];

function formFromDoc(doc: AdminDocument) {
  return {
    title: doc.title,
    type: doc.type,
    category: doc.category,
    level: String(doc.level),
    difficulty: doc.difficulty,
    shortDescription: doc.shortDescription,
    fullDescription: doc.fullDescription,
    externalUrl: doc.externalUrl,
    fileName: doc.fileName ?? "",
    status: doc.status,
    important: doc.important,
    distributionMode: doc.distributionMode,
    unlockAfterWeeks: String(doc.unlockAfterWeeks),
  };
}

export function DocumentModal({
  document,
  students,
  onSave,
  onSetAssignment,
  triggerLabel,
  initialEditing = false,
}: {
  document: AdminDocument;
  students: AdminStudent[];
  onSave: (partial: Partial<AdminDocument>) => void;
  onSetAssignment: (studentId: string, contentType: "document", contentId: string, assigned: boolean) => void;
  triggerLabel: string;
  initialEditing?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(initialEditing);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState(() => formFromDoc(document));

  function setField<K extends keyof ReturnType<typeof formFromDoc>>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function close() {
    setOpen(false);
    setEditing(initialEditing);
    setSaved(false);
  }

  function handleSave() {
    onSave({
      title: form.title,
      type: form.type,
      category: form.category,
      level: Number(form.level) || 1,
      difficulty: form.difficulty,
      shortDescription: form.shortDescription,
      fullDescription: form.fullDescription,
      externalUrl: form.externalUrl,
      fileName: form.fileName || null,
      status: form.status,
      important: form.important,
      distributionMode: form.distributionMode,
      unlockAfterWeeks: Number(form.unlockAfterWeeks) || 0,
    });
    setSaved(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setForm(formFromDoc(document));
          setEditing(initialEditing);
          setOpen(true);
        }}
        className={
          initialEditing
            ? "flex items-center gap-1.5 border border-primary bg-primary px-4 py-2 text-xs font-bold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-red-700"
            : "flex items-center gap-1.5 border border-border px-4 py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-primary hover:text-primary"
        }
      >
        {initialEditing ? <Pencil size={13} /> : <Eye size={13} />}
        {triggerLabel}
      </button>

      {open && (
        <Modal title={document.title} onClose={close} maxWidth="max-w-lg">
          {saved ? (
            <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
              <CheckCircle size={18} className="flex-shrink-0" />
              Document mis à jour.
            </div>
          ) : editing ? (
            <div className="flex flex-col gap-4">
              <Field label="Titre" value={form.title} onChange={(v) => setField("title", v)} />
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Type" value={form.type} onChange={(v) => setField("type", v as DocumentType)} options={typeOptions} />
                <SelectField label="Catégorie" value={form.category} onChange={(v) => setField("category", v as DocumentCategory)} options={categoryOptions} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <SelectField label="Niveau" value={form.level} onChange={(v) => setField("level", v)} options={levelOptions} />
                <SelectField
                  label="Difficulté"
                  value={form.difficulty}
                  onChange={(v) => setField("difficulty", v as typeof form.difficulty)}
                  options={difficultyOptions}
                />
              </div>
              <TextareaField label="Description courte" value={form.shortDescription} onChange={(v) => setField("shortDescription", v)} rows={2} />
              <TextareaField label="Description complète" value={form.fullDescription} onChange={(v) => setField("fullDescription", v)} rows={3} />
              <Field label="Lien externe" value={form.externalUrl} onChange={(v) => setField("externalUrl", v)} />
              <Field label="Nom du fichier (mocké)" value={form.fileName} onChange={(v) => setField("fileName", v)} />
              <SelectField label="Statut" value={form.status} onChange={(v) => setField("status", v as AdminDocumentStatus)} options={statusOptions} />
              <CheckboxField label="Marquer comme important" checked={form.important} onChange={(v) => setField("important", v)} />
              <SelectField
                label="Mode de distribution"
                value={form.distributionMode}
                onChange={(v) => setField("distributionMode", v as DocumentDistributionMode)}
                options={distributionOptions}
              />
              {form.distributionMode === "deblocage-auto" && (
                <Field
                  label="Déblocage après X semaines"
                  type="number"
                  value={form.unlockAfterWeeks}
                  onChange={(v) => setField("unlockAfterWeeks", v)}
                />
              )}
              <PrimaryButton onClick={handleSave}>Enregistrer</PrimaryButton>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge label={documentStatusLabels[document.status]} tone={contentStatusTone(document.status)} />
                {document.important && <StatusBadge label="Important" tone="red" />}
                <StatusBadge label={`Niveau ${document.level}`} tone="muted" />
              </div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {documentTypeLabels[document.type]} · {documentCategoryLabels[document.category]} · {document.difficulty}
              </div>
              <p className="text-sm text-foreground">{document.shortDescription}</p>
              <p className="text-sm text-muted-foreground">{document.fullDescription}</p>
              {document.externalUrl && (
                <p className="text-xs text-muted-foreground">Lien : {document.externalUrl}</p>
              )}
              {document.fileName && <p className="text-xs text-muted-foreground">Fichier : {document.fileName}</p>}
              <p className="text-xs text-muted-foreground">
                Distribution : {distributionModeLabels[document.distributionMode]}
                {document.distributionMode === "deblocage-auto" && ` (après ${document.unlockAfterWeeks} semaine(s))`}
              </p>
              <div>
                <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Élèves ayant accès ({document.assignedStudentIds.length})
                </span>
                <StudentPickerList
                  students={students}
                  selectedIds={document.assignedStudentIds}
                  onToggle={(studentId, checked) => onSetAssignment(studentId, "document", document.id, checked)}
                />
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="flex items-center justify-center gap-2 border border-primary px-4 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
              >
                <Pencil size={13} />
                Modifier
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
