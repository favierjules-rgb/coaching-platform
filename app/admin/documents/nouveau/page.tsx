"use client";

import { useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, FileUp } from "lucide-react";

import { CheckboxField, Field, SelectField, TextareaField } from "@/components/admin/AdminFormFields";
import { DocumentFileUploadField } from "@/components/admin/DocumentFileUploadField";
import { PrimaryButton } from "@/components/admin/Modal";
import { useAdminData } from "@/hooks/useAdminData";
import { useContentAssignment } from "@/hooks/useContentAssignment";
import { useSupabaseDocuments } from "@/hooks/useSupabaseDocuments";
import { useSupabaseStudents } from "@/hooks/useSupabaseStudents";
import { fullName } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { createDocument as createDocumentSupabase } from "@/lib/supabase/documents";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { UploadedDocumentFile } from "@/lib/supabase/storage-documents";
import type {
  AdminDocumentStatus,
  DocumentCategory,
  DocumentDistributionMode,
  DocumentType,
  DocumentVisibility,
} from "@/types";

const typeOptions: { value: DocumentType; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "vidéo", label: "Vidéo" },
  { value: "lien", label: "Lien" },
  { value: "guide", label: "Guide" },
  { value: "image", label: "Image" },
  { value: "texte", label: "Texte / note" },
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
  { value: "deblocage-date", label: "Déblocage à une date précise" },
];

const visibilityOptions: { value: DocumentVisibility; label: string }[] = [
  { value: "assigned", label: "Élèves assignés uniquement" },
  { value: "global", label: "Tous les élèves actifs (global)" },
];

export default function NewDocumentPage() {
  const router = useRouter();
  const { state, createDocument, setAssignment } = useAdminData();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Id généré côté client avant la création de la ligne `documents`, pour
  // uploader directement vers `<documentId>/...` dans le bucket Storage
  // sans déplacement de fichier après coup (voir lib/supabase/documents.ts::createDocument).
  const [pendingDocumentId] = useState(() => crypto.randomUUID());
  const [uploadedFile, setUploadedFile] = useState<UploadedDocumentFile | null>(null);

  // Dès que Supabase est configuré, la création doit produire une vraie
  // ligne `documents` — jamais de repli mock silencieux (même principe que
  // /admin/nutrition/nouveau).
  const supabaseActive = isSupabaseConfigured();
  const supabaseDocuments = useSupabaseDocuments();
  const supabaseStudents = useSupabaseStudents();
  const students = supabaseActive ? supabaseStudents.students : state.students;
  const handleSetAssignment = useContentAssignment(
    { document: supabaseActive },
    setAssignment,
    supabaseDocuments.refetch,
  );

  const [title, setTitle] = useState("");
  const [type, setType] = useState<DocumentType>("pdf");
  const [category, setCategory] = useState<DocumentCategory>("nutrition");
  const [level, setLevel] = useState("1");
  const [difficulty, setDifficulty] = useState<"facile" | "intermédiaire" | "avancé">("facile");
  const [shortDescription, setShortDescription] = useState("");
  const [fullDescription, setFullDescription] = useState("");
  const [contentText, setContentText] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [status, setStatus] = useState<AdminDocumentStatus>("brouillon");
  const [important, setImportant] = useState(false);
  const [distributionMode, setDistributionMode] = useState<DocumentDistributionMode>("immediat");
  const [unlockAfterWeeks, setUnlockAfterWeeks] = useState("0");
  const [unlockAt, setUnlockAt] = useState("");
  const [visibility, setVisibility] = useState<DocumentVisibility>("assigned");
  const [tags, setTags] = useState("");
  const [assignedStudentIds, setAssignedStudentIds] = useState<string[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0];
    setFileName(selected ? selected.name : null);
  }

  function toggleStudent(studentId: string, checked: boolean) {
    setAssignedStudentIds((prev) => (checked ? [...prev, studentId] : prev.filter((id) => id !== studentId)));
  }

  function validateUrls(): string | null {
    const urlToCheck = type === "vidéo" ? videoUrl : type === "texte" ? "" : externalUrl;
    if (!urlToCheck.trim()) {
      return null;
    }
    try {
      new URL(urlToCheck);
      return null;
    } catch {
      return "L'URL saisie n'est pas valide (ex : https://...).";
    }
  }

  /** Au moins un contenu réel doit être fourni selon le type — jamais de document vide silencieusement enregistré. */
  function validateContent(): string | null {
    if (type === "texte") {
      return contentText.trim() ? null : "Renseigne le contenu texte de ce document.";
    }
    if (type === "vidéo") {
      return videoUrl.trim() || uploadedFile ? null : "Ajoute un lien vidéo ou uploade un fichier vidéo.";
    }
    return externalUrl.trim() || uploadedFile ? null : "Ajoute une URL externe ou uploade un fichier.";
  }

  async function handleCreate(publish: boolean) {
    setSaveError(null);
    const urlError = validateUrls();
    if (urlError) {
      setSaveError(urlError);
      return;
    }
    const contentError = validateContent();
    if (contentError) {
      setSaveError(contentError);
      return;
    }

    const data = {
      title: title.trim() || "Document sans titre",
      type,
      category,
      level: Number(level) || 1,
      difficulty,
      shortDescription,
      fullDescription,
      contentText,
      externalUrl,
      videoUrl,
      fileName: uploadedFile?.fileName ?? fileName,
      storagePath: uploadedFile?.storagePath ?? null,
      fileSizeBytes: uploadedFile?.fileSizeBytes ?? null,
      fileMimeType: uploadedFile?.fileMimeType ?? null,
      status: publish ? ("publié" as const) : status,
      important,
      distributionMode,
      unlockAfterWeeks: Number(unlockAfterWeeks) || 0,
      unlockAt: distributionMode === "deblocage-date" && unlockAt ? new Date(unlockAt).toISOString() : null,
      visibility,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };

    if (supabaseActive) {
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const id = await createDocumentSupabase(supabase, data, pendingDocumentId);
        if (!id) {
          setSaveError("Échec de l'enregistrement du document. Réessaie.");
          return;
        }
        for (const studentId of assignedStudentIds) {
          await handleSetAssignment(studentId, "document", id, true);
        }
        await supabaseDocuments.refetch();
        setCreatedId(id);
        return;
      }
    }

    const id = createDocument({ ...data, assignedStudentIds: [] });
    assignedStudentIds.forEach((studentId) => setAssignment(studentId, "document", id, true));
    setCreatedId(id);
  }

  const documents = supabaseActive ? supabaseDocuments.documents : state.documents;
  const created = createdId ? documents.find((d) => d.id === createdId) : null;

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

      {saveError && (
        <p className="mb-6 flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {saveError}
        </p>
      )}

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
            {type === "texte" ? (
              <TextareaField label="Contenu texte" value={contentText} onChange={setContentText} rows={5} />
            ) : type === "vidéo" ? (
              <Field label="Lien vidéo (YouTube, Vimeo...)" value={videoUrl} onChange={setVideoUrl} placeholder="https://..." />
            ) : (
              <Field label="Lien externe / PDF" value={externalUrl} onChange={setExternalUrl} placeholder="https://..." />
            )}
            <Field label="Tags (séparés par des virgules)" value={tags} onChange={setTags} />

            {supabaseActive ? (
              <DocumentFileUploadField
                documentId={pendingDocumentId}
                type={type}
                current={null}
                onUploaded={setUploadedFile}
              />
            ) : (
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
                    {fileName} — mode démo (Supabase non configuré), aucun upload réel.
                  </p>
                )}
              </div>
            )}

            <SelectField label="Statut" value={status} onChange={(v) => setStatus(v as AdminDocumentStatus)} options={statusOptions} />
            <CheckboxField label="Marquer comme important" checked={important} onChange={setImportant} />
            <SelectField
              label="Visibilité"
              value={visibility}
              onChange={(v) => setVisibility(v as DocumentVisibility)}
              options={visibilityOptions}
            />
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
            {distributionMode === "deblocage-date" && (
              <Field label="Date de déblocage" type="date" value={unlockAt} onChange={setUnlockAt} />
            )}
          </div>
        </div>

        <div className="border border-border bg-card p-6">
          <h2 className="mb-4 font-heading text-lg font-bold uppercase text-foreground">
            Élèves autorisés
          </h2>
          {visibility === "global" && (
            <p className="mb-3 text-xs text-muted-foreground">
              Document global : visible de tous les élèves actifs dès publié, l&apos;assignation ci-dessous reste
              optionnelle.
            </p>
          )}
          <div className="flex flex-col gap-2">
            {students.map((s) => (
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
