"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { DocumentLibraryCard } from "@/components/student/DocumentLibraryCard";
import { useDocumentAccess } from "@/hooks/useDocumentAccess";
import {
  documentFilters,
  matchesDocumentFilter,
  matchesDocumentSearch,
  type DocumentFilterKey,
} from "@/lib/documents";
import type { DocumentResource, StudentDocumentAccess } from "@/types";

interface DocumentLibraryProps {
  studentId: string;
  documents: DocumentResource[];
  accessSeed: StudentDocumentAccess[];
}

export function DocumentLibrary({
  studentId,
  documents,
  accessSeed,
}: DocumentLibraryProps) {
  const { getStatus } = useDocumentAccess(studentId, accessSeed);
  const [activeFilter, setActiveFilter] = useState<DocumentFilterKey>("tous");
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      documents.filter(
        (document) =>
          matchesDocumentFilter(document, activeFilter) &&
          matchesDocumentSearch(document, query),
      ),
    [documents, activeFilter, query],
  );

  return (
    <div>
      <div className="relative mb-6">
        <Search
          size={16}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Rechercher par titre, description ou catégorie…"
          className="w-full border border-border bg-background py-3 pl-11 pr-4 text-sm text-foreground transition-colors focus:border-primary focus:outline-none"
        />
      </div>

      <div className="mb-8 flex flex-wrap gap-2">
        {documentFilters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActiveFilter(filter.key)}
            className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
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
        <p className="text-sm text-muted-foreground">
          Aucun document ne correspond à ta recherche.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((document) => (
            <DocumentLibraryCard
              key={document.id}
              document={document}
              status={getStatus(document.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
