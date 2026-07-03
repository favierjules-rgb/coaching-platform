"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, FileUp } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { PrimaryButton } from "@/components/admin/Modal";
import { useAdminData } from "@/hooks/useAdminData";
import { fullName } from "@/lib/admin";
import type {
  AdminDocumentStatus,
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
  { value: "1", label: "Niveau 1 — débutant" },
  { value: "2", label: "Niveau 2 — intermédiaire" },
  { value: "3", label: "Niveau 3 — avancé" },
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

export default function NewDocumentPage() {
  const router = useRouter();
  const { state, createDocument, setAssignment } = useAdminData();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentType>("pdf");
  const [category, setCategory] = useState<DocumentCategory>("nutrition");
  const [level, setLevel] = useState("1");
  const [difficulty, setDifficulty] = useState<"facile" | "intermédiaire" | "avancé">("facile");
  const [shortDescription, setShortDescription] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminDocumentStatus>("brouillon");
  const [important, setImportant] = useState(false);
  const [distributionMode, setDistributionMode] = useState<DocumentDistributionMode>("immediat");
  const [unlockAfterWeeks, setUnlockAfterWeeks] = useState("0");
  const [assignedStudentIds, setAssignedStudentIds] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setFileName(selected ? selected.name : null);
  }

  function toggleStudent(studentId: string, checked: boolean) {
    setAssignedStudentIds((prev) => (checked ? [...prev, studentId] : prev.filter((id) => id !== studentId)));
  }

  function handleCreate(publish: boolean) {
    const id = createDocument({
      title: title.trim() || "Document sans titre",
      type,
      category,
      level: Number(level) || 1,
      difficulty,
      shortDescription,
      fullDescription,
      externalUrl,
      fileName,
      storagePath: null,
      status: publish ? "publié" : status,
      important,
      distributionMode,
      unlockAfterWeeks: Number(unlockAfterWeeks) || 0,
      assignedStudentIds: [],
    });
    assignedStudentIds.forEach((studentId) => setAssignment(studentId, "document", id, true));
    setCreatedId(id);
  }

  const created = createdId ? state.documents.find((d) => d.id === createdId) : null;

  if (created) {
    return (
      <div>
        <Link href="/admin/documents" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={14} />
          Documents
        </Link>
        <div className="flex items-center gap-3 border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-400">
          <CheckCircle size={18} className="flex-shrink-0" />
          Document &quot;{created.title}&quot; enregistré.
        </div>
        <button
          type="button"
          onClick={() => router.push("/admin/documents")}
          className="mt-4 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div>
      <Link href="/admin/documents" className="mb-6 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground">
        <ArrowLeft size={14} />
        Documents
      </Link>

      <div className="mb-8">
        <h1 className="font-heading text-3xl font-extrabold uppercase text-foreground md:text-4xl">
          Ajouter un document
        </h1>
      </div>

      <div className="flex flex-col gap-6">
        <div className="border border-border bg-card p-6">
          <div className="flex flex-col gap-4">
            <Field label="Titre" value={title} onChange={setTitle} />
            <div className="grid grid-cols-2 gap-4">
              <SelectField label="Type" value={type} onChange={(v) => setType(v as DocumentType)} options={typeOptions} />
              <SelectField label="Catégorie" value={category} onChange={(v) => setCategory(v as DocumentCategory)} options={categoryOptions} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SelectField label="Niveau" value={level} onChange={setLevel} options={levelOptions} />
              <SelectField
                label="Difficulté"
                value={difficulty}
                onChange={(v) => setDifficulty(v as typeof difficulty)}
                options={difficultyOptions}
              />
            </div>
            <TextareaField label="Description courte" value={shortDescription} onChange={setShortDescription} rows={2} />
            <TextareaField label="Description complète" value={fullDescription} onChange={setFullDescription} rows={4} />
            <Field label="Lien externe (fictif)" value={externalUrl} onChange={setExternalUrl} placeholder="https://documents.seth-coaching.mock/..." />

            <div>
              <label htmlFor={fileInputId} className="mb-2 block text-xs uppercase tracking-wide text-muted-foreground">
                Fichier (mocké)
              </label>
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground file:mr-4 file:border file:border-primary file:bg-transparent file:px-4 file:py-2 file:text-xs file:uppercase file:tracking-widest file:text-primary hover:file:bg-primary hover:file:text-primary-foreground"
              />
              {fileName && (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <FileUp size={13} />
                  {fileName} — sera préparé pour Supabase Storage une fois connecté.
                </p>
              )}
            </div>

            <SelectField label="Statut" value={status} onChange={(v) => setStatus(v as AdminDocumentStatus)} options={statusOptions} />
            <CheckboxField label="Marquer comme important" checked={important} onChange={setImportant} />
          </div>
        </div>

        <div className="border border-border bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Mode de distribution
          </h2>
          <div className="flex flex-col gap-4">
            <SelectField
              label="Mode"
              value={distributionMode}
              onChange={(v) => setDistributionMode(v as DocumentDistributionMode)}
              options={distributionOptions}
            />
            {distributionMode === "deblocage-auto" && (
              <Field
                label="Déblocage après X semaines de coaching"
                type="number"
                value={unlockAfterWeeks}
                onChange={setUnlockAfterWeeks}
                placeholder="Ex : 2"
              />
            )}
            {distributionMode === "deblocage-auto" && (
              <p className="text-xs text-muted-foreground">
                Un document de niveau {level} avec un déblocage de {unlockAfterWeeks || 0} semaine(s) devient
                disponible à partir de la semaine {(Number(level) - 1) * (Number(unlockAfterWeeks) || 0) + 1} du
                coaching de l&apos;élève.
              </p>
            )}
          </div>
        </div>

        <div className="border border-border bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Élèves autorisés
          </h2>
          <div className="flex flex-col gap-2">
            {state.students.map((s) => (
              <CheckboxField
                key={s.id}
                label={fullName(s)}
                checked={assignedStudentIds.includes(s.id)}
                onChange={(checked) => toggleStudent(s.id, checked)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <PrimaryButton onClick={() => handleCreate(false)}>Enregistrer document</PrimaryButton>
          <button
            type="button"
            onClick={() => handleCreate(true)}
            className="border border-primary px-4 py-3 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
          >
            Publier
          </button>
        </div>
      </div>
    </div>
  );
}
