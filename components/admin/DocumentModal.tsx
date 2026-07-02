"use client";

import { useState } from "react";
import { CheckCircle, Eye, Pencil } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { Modal, PrimaryButton } from "@/components/admin/Modal";
import { StatusBadge, contentStatusTone } from "@/components/admin/StatusBadge";
import {
  documentCategoryLabels,
  documentStatusLabels,
  documentTypeLabels,
  fullName,
} from "@/lib/admin";
import type { AdminDocument, AdminDocumentStatus, AdminStudent, DocumentCategory, DocumentType } from "@/types";

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

function formFromDoc(doc: AdminDocument) {
  return {
    title: doc.title,
    type: doc.type,
    category: doc.category,
    shortDescription: doc.shortDescription,
    fullDescription: doc.fullDescription,
    externalUrl: doc.externalUrl,
    fileName: doc.fileName ?? "",
    status: doc.status,
    important: doc.important,
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
      shortDescription: form.shortDescription,
      fullDescription: form.fullDescription,
      externalUrl: form.externalUrl,
      fileName: form.fileName || null,
      status: form.status,
      important: form.important,
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
              <TextareaField label="Description courte" value={form.shortDescription} onChange={(v) => setField("shortDescription", v)} rows={2} />
              <TextareaField label="Description complète" value={form.fullDescription} onChange={(v) => setField("fullDescription", v)} rows={3} />
              <Field label="Lien externe" value={form.externalUrl} onChange={(v) => setField("externalUrl", v)} />
              <Field label="Nom du fichier (mocké)" value={form.fileName} onChange={(v) => setField("fileName", v)} />
              <SelectField label="Statut" value={form.status} onChange={(v) => setField("status", v as AdminDocumentStatus)} options={statusOptions} />
              <CheckboxField label="Marquer comme important" checked={form.important} onChange={(v) => setField("important", v)} />
              <PrimaryButton onClick={handleSave}>Enregistrer</PrimaryButton>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <StatusBadge label={documentStatusLabels[document.status]} tone={contentStatusTone(document.status)} />
                {document.important && <StatusBadge label="Important" tone="red" />}
              </div>
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {documentTypeLabels[document.type]} · {documentCategoryLabels[document.category]}
              </div>
              <p className="text-sm text-foreground">{document.shortDescription}</p>
              <p className="text-sm text-muted-foreground">{document.fullDescription}</p>
              {document.externalUrl && (
                <p className="text-xs text-muted-foreground">Lien : {document.externalUrl}</p>
              )}
              {document.fileName && <p className="text-xs text-muted-foreground">Fichier : {document.fileName}</p>}
              <div>
                <span className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                  Élèves ayant accès ({document.assignedStudentIds.length})
                </span>
                <div className="flex max-h-40 flex-col gap-2 overflow-y-auto">
                  {students.map((s) => (
                    <CheckboxField
                      key={s.id}
                      label={fullName(s)}
                      checked={document.assignedStudentIds.includes(s.id)}
                      onChange={(checked) => onSetAssignment(s.id, "document", document.id, checked)}
                    />
                  ))}
                </div>
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
