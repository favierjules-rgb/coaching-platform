"use client";

import { useId, useRef, useState } from "react";
import { AlertTriangle, CheckCircle, FileUp, Loader2, Trash2 } from "lucide-react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  deleteDocumentFile,
  uploadDocumentFile,
  validateDocumentFile,
  warnLargeVideo,
  type UploadedDocumentFile,
} from "@/lib/supabase/storage-documents";
import type { DocumentType } from "@/types";

function acceptFor(type: DocumentType): string | undefined {
  if (type === "pdf") return "application/pdf";
  if (type === "image") return "image/*";
  if (type === "vidéo") return "video/*";
  return undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Consigne lisible (types + taille max) affichée dans la zone d'upload — purement informative, dérivée des mêmes contraintes que validateDocumentFile. */
function acceptHint(type: DocumentType): string {
  if (type === "pdf") return "PDF — 25 Mo max.";
  if (type === "image") return "Image (jpg, png, webp…) — 10 Mo max.";
  if (type === "vidéo") return "Vidéo — 200 Mo max.";
  return "Fichier — 25 Mo max.";
}

interface DocumentFileUploadFieldProps {
  /** Id (déjà généré ou réel) sous lequel le fichier est rangé dans le bucket : `<documentId>/<timestamp>-<nom>`. */
  documentId: string;
  type: DocumentType;
  /** Fichier déjà uploadé (édition) — affiché avec une option "Remplacer". */
  current: { storagePath: string; fileName: string | null; fileSizeBytes: number | null } | null;
  onUploaded: (file: UploadedDocumentFile | null) => void;
}

/**
 * Upload réel d'un fichier (PDF/image/vidéo/autre) vers le bucket Storage
 * "documents" — voir lib/supabase/storage-documents.ts. Reste indépendant
 * du champ "lien externe" existant (PR #20) : l'admin choisit soit un
 * upload, soit une URL, soit les deux ; rien n'est obligatoire ici.
 */
export function DocumentFileUploadField({ documentId, type, current, onUploaded }: DocumentFileUploadFieldProps) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<UploadedDocumentFile | null>(
    current ? { storagePath: current.storagePath, fileName: current.fileName ?? "", fileSizeBytes: current.fileSizeBytes ?? 0, fileMimeType: "" } : null,
  );

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setError(null);
    setWarning(null);
    if (!file) {
      setSelectedFile(null);
      return;
    }
    const validationError = validateDocumentFile(file, type);
    if (validationError) {
      setError(validationError);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setWarning(warnLargeVideo(file, type));
    setSelectedFile(file);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setUploading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setError("Supabase n'est pas configuré.");
      setUploading(false);
      return;
    }

    // Remplacement : on supprime l'ancien fichier une fois le nouveau
    // uploadé avec succès (jamais avant, pour ne pas perdre le fichier en
    // cas d'échec de l'upload).
    const previousPath = uploaded?.storagePath ?? null;

    const result = await uploadDocumentFile(supabase, documentId, selectedFile);
    setUploading(false);
    if ("error" in result) {
      setError(`Échec de l'upload : ${result.error}`);
      return;
    }

    if (previousPath && previousPath !== result.storagePath) {
      await deleteDocumentFile(supabase, previousPath);
    }

    setUploaded(result);
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    onUploaded(result);
  }

  async function handleRemove() {
    if (!uploaded) return;
    const supabase = createSupabaseBrowserClient();
    if (supabase) {
      await deleteDocumentFile(supabase, uploaded.storagePath);
    }
    setUploaded(null);
    onUploaded(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="block text-xs uppercase tracking-wide text-muted-foreground">
        Fichier uploadé {type === "pdf" ? "(PDF)" : type === "image" ? "(image)" : type === "vidéo" ? "(vidéo)" : ""}
      </label>

      {uploaded && (
        <div className="flex items-center justify-between gap-3 rounded-control border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          <span className="flex min-w-0 items-center gap-2 truncate">
            <CheckCircle size={16} className="flex-shrink-0" />
            <span className="truncate">
              {uploaded.fileName || uploaded.storagePath}
              {uploaded.fileSizeBytes > 0 && ` — ${formatSize(uploaded.fileSizeBytes)}`}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void handleRemove()}
            aria-label={`Retirer le fichier ${uploaded.fileName || uploaded.storagePath}`}
            className="pressable flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
          >
            <Trash2 size={16} aria-hidden />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface-soft/40 p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileUp size={14} aria-hidden className="flex-shrink-0" />
          {acceptHint(type)}
        </div>
        <input
          ref={fileInputRef}
          id={inputId}
          type="file"
          accept={acceptFor(type)}
          onChange={handleFileChange}
          className="block w-full rounded-control text-sm text-muted-foreground file:mr-4 file:min-h-[44px] file:rounded-control file:border file:border-primary file:bg-transparent file:px-4 file:py-2 file:text-xs file:font-bold file:uppercase file:tracking-widest file:text-primary hover:file:bg-primary hover:file:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        />
      </div>

      {selectedFile && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-surface-soft/40 px-4 py-3 text-xs text-muted-foreground">
          <span className="flex min-w-0 items-center gap-2">
            <FileUp size={14} aria-hidden className="flex-shrink-0" />
            <span className="truncate">
              {selectedFile.name} — {formatSize(selectedFile.size)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => void handleUpload()}
            disabled={uploading}
            className="pressable flex min-h-[44px] flex-shrink-0 items-center gap-1.5 rounded-control border border-primary px-4 py-2 uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Envoi…
              </>
            ) : (
              "Uploader"
            )}
          </button>
        </div>
      )}

      {warning && (
        <p className="flex items-center gap-2 text-xs text-warning">
          <AlertTriangle size={13} aria-hidden className="flex-shrink-0" />
          {warning}
        </p>
      )}
      {error && (
        <p className="flex items-center gap-2 text-xs text-destructive" role="alert">
          <AlertTriangle size={13} aria-hidden className="flex-shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
