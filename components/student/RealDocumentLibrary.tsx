"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, ExternalLink, FileText, Loader2, Lock, PlayCircle } from "lucide-react";

import { ImportantMark } from "@/components/admin/ImportantMark";
import { documentCategoryLabels, documentTypeLabels, formatDate, matchesTextSearch } from "@/lib/admin";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { StudentDocumentWithAvailability } from "@/lib/supabase/documents";
import { getSignedDocumentFileUrl } from "@/lib/supabase/storage-documents";
import type { AdminDocumentStatus, DocumentCategory } from "@/types";

type FilterKey = "tous" | DocumentCategory | "vidéo" | "guide" | "verrouilles";

const filters: { key: FilterKey; label: string }[] = [
  { key: "tous", label: "Mes documents" },
  { key: "vidéo", label: "Vidéos" },
  { key: "guide", label: "Guides" },
  { key: "nutrition", label: "Nutrition" },
  { key: "entrainement", label: "Entraînement" },
  { key: "administratif", label: "Administratif" },
  { key: "verrouilles", label: "À venir / verrouillés" },
];

function matchesFilter(item: StudentDocumentWithAvailability, filter: FilterKey): boolean {
  if (filter === "tous") return true;
  if (filter === "verrouilles") return !item.availability.available;
  if (filter === "vidéo" || filter === "guide") return item.document.type === filter;
  return item.document.category === filter;
}

function unlockLabel(unlockDate: string | null): string {
  if (!unlockDate) return "Disponible bientôt";
  const target = new Date(unlockDate);
  const diffDays = Math.ceil((target.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diffDays > 0) {
    return `Disponible dans ${diffDays} jour${diffDays > 1 ? "s" : ""} (${formatDate(unlockDate)})`;
  }
  return `Disponible le ${formatDate(unlockDate)}`;
}

const statusDotTone: Record<AdminDocumentStatus, string> = {
  brouillon: "bg-muted-foreground",
  publié: "bg-success",
  archivé: "bg-destructive",
};

/**
 * Ouvre un fichier réellement uploadé (Storage privé) via une URL signée
 * générée à la demande — jamais d'URL stockée/permanente. La génération
 * elle-même est soumise à la policy RLS du bucket (voir schema.sql,
 * `documents_bucket_select_accessible`) : un document verrouillé côté app
 * n'expose de toute façon jamais ce bouton (voir `availability.available`
 * plus bas), donc ce chemin n'est jamais atteint pour un document non
 * débloqué.
 */
function StorageFileButton({ storagePath, label, icon: Icon }: { storagePath: string; label: string; icon: typeof Download }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  async function handleOpen() {
    setLoading(true);
    setError(false);
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setLoading(false);
      setError(true);
      return;
    }
    const url = await getSignedDocumentFileUrl(supabase, storagePath);
    setLoading(false);
    if (!url) {
      setError(true);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleOpen()}
        disabled={loading}
        className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
      >
        {loading ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
        {label}
      </button>
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] text-destructive">
          <AlertTriangle size={12} className="flex-shrink-0" />
          Impossible d&apos;ouvrir ce fichier.
        </p>
      )}
    </div>
  );
}

function DocumentCard({ item }: { item: StudentDocumentWithAvailability }) {
  const { document, availability } = item;

  return (
    <div className={`flex flex-col gap-3 rounded-card border border-border bg-card p-6 shadow-soft ${!availability.available ? "bg-surface-soft/40" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDotTone[document.status]}`} />
          <h3 className="font-heading text-base font-bold uppercase text-foreground">{document.title}</h3>
          {document.important && <ImportantMark />}
        </div>
      </div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {documentTypeLabels[document.type]} · {documentCategoryLabels[document.category]}
      </p>
      {document.shortDescription && <p className="text-sm text-foreground">{document.shortDescription}</p>}

      {!availability.available ? (
        <p className="flex items-center gap-2 rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <Lock size={13} className="flex-shrink-0" />
          {unlockLabel(availability.unlockDate)}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {document.type === "texte" && document.contentText && (
            <p className="whitespace-pre-wrap text-sm text-foreground">{document.contentText}</p>
          )}
          {document.type === "vidéo" &&
            (document.storagePath ? (
              <StorageFileButton storagePath={document.storagePath} label="Voir la vidéo" icon={PlayCircle} />
            ) : (
              document.videoUrl && (
                <a
                  href={document.videoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <PlayCircle size={14} />
                  Voir la vidéo
                </a>
              )
            ))}
          {document.type === "pdf" &&
            (document.storagePath ? (
              <StorageFileButton storagePath={document.storagePath} label="Télécharger" icon={Download} />
            ) : (
              document.externalUrl && (
                <a
                  href={document.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Download size={14} />
                  Télécharger
                </a>
              )
            ))}
          {document.type !== "vidéo" &&
            document.type !== "pdf" &&
            document.type !== "texte" &&
            (document.storagePath ? (
              <StorageFileButton storagePath={document.storagePath} label="Ouvrir" icon={ExternalLink} />
            ) : (
              document.externalUrl && (
                <a
                  href={document.externalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pressable flex min-h-[44px] items-center gap-1.5 rounded-control border border-primary px-3 py-2 text-xs uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <ExternalLink size={14} />
                  Ouvrir
                </a>
              )
            ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">
        {availability.available ? `Publié le ${formatDate(document.createdAt)}` : ""}
      </p>
    </div>
  );
}

export function RealDocumentLibrary({ documents }: { documents: StudentDocumentWithAvailability[] }) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>("tous");
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      documents.filter(
        (item) =>
          matchesFilter(item, activeFilter) &&
          matchesTextSearch([item.document.title, item.document.shortDescription], query),
      ),
    [documents, activeFilter, query],
  );

  if (documents.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <FileText size={16} />
        Aucun document disponible pour le moment.
      </p>
    );
  }

  return (
    <div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Rechercher par titre ou description…"
        className="mb-6 w-full rounded-control border border-border bg-surface-soft px-4 py-3 text-sm text-foreground transition-colors focus:border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
      />

      <div className="mb-8 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
            aria-pressed={activeFilter === filter.key}
            className={`pressable min-h-[40px] rounded-full border px-4 py-2 text-xs uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
              activeFilter === filter.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun document ne correspond à ta recherche.</p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <DocumentCard key={item.document.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
