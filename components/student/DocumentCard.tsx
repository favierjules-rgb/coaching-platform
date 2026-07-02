import { BookOpen, FileText, Link2, Video, type LucideIcon } from "lucide-react";

import type { DocumentItem, DocumentType } from "@/types";

const typeIcons: Record<DocumentType, LucideIcon> = {
  pdf: FileText,
  "vidéo": Video,
  guide: BookOpen,
  lien: Link2,
};

export function DocumentCard({ document }: { document: DocumentItem }) {
  const Icon = typeIcons[document.type];

  return (
    <div className="flex flex-col gap-4 border border-border bg-card p-6">
      <div className="flex items-center justify-between">
        <Icon size={22} className="text-primary" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          {document.type}
        </span>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium text-foreground">
          {document.title}
        </h3>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {document.description}
        </p>
      </div>

      <span className="mt-auto text-xs text-muted-foreground">
        Ajouté le {document.addedAt}
      </span>

      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 border border-primary py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
        >
          Ouvrir
        </button>
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
