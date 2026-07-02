import Link from "next/link";
import {
  BookOpen,
  FileText,
  Image as ImageIcon,
  Link2,
  Video,
  type LucideIcon,
} from "lucide-react";

import { DocumentStatusBadge } from "@/components/student/DocumentStatusBadge";
import { ImportantBadge } from "@/components/student/ImportantBadge";
import { documentCategoryLabels, documentTypeLabels } from "@/lib/documents";
import type { DocumentResource, DocumentStatus, DocumentType } from "@/types";

const typeIcons: Record<DocumentType, LucideIcon> = {
  pdf: FileText,
  "vidéo": Video,
  guide: BookOpen,
  lien: Link2,
  image: ImageIcon,
};

interface DocumentLibraryCardProps {
  document: DocumentResource;
  status: DocumentStatus;
}

export function DocumentLibraryCard({
  document,
  status,
}: DocumentLibraryCardProps) {
  const Icon = typeIcons[document.type];

  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={22} className="text-primary" />
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            {documentTypeLabels[document.type]}
          </span>
        </div>
        {document.important && <ImportantBadge />}
      </div>

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {documentCategoryLabels[document.category]}
        </div>
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {document.title}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {document.description}
        </p>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Ajouté le {document.createdAt}</span>
        <DocumentStatusBadge status={status} />
      </div>

      <div className="flex gap-2">
        <Link
          href={`/documents/${document.id}`}
          className="flex-1 border border-primary py-2 text-center text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          Ouvrir
        </Link>
        {document.type === "pdf" && (
          <button
            type="button"
            className="flex-1 border border-border py-2 text-xs uppercase tracking-widest text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            Télécharger
          </button>
        )}
      </div>
    </div>
  );
}
