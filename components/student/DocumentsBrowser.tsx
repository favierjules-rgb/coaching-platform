"use client";

import { useState } from "react";

import { DocumentCard } from "@/components/student/DocumentCard";
import type { DocumentItem } from "@/types";

const filters = [
  { key: "tous", label: "Tous" },
  { key: "nutrition", label: "Nutrition" },
  { key: "entrainement", label: "Entraînement" },
  { key: "administratif", label: "Administratif" },
  { key: "vidéo", label: "Vidéos" },
  { key: "guide", label: "Guides" },
] as const;

type FilterKey = (typeof filters)[number]["key"];

export function DocumentsBrowser({ documents }: { documents: DocumentItem[] }) {
  const [active, setActive] = useState<FilterKey>("tous");

  const filtered =
    active === "tous"
      ? documents
      : documents.filter(
          (document) => document.category === active || document.type === active,
        );

  return (
    <div>
      <div className="mb-8 flex flex-wrap gap-2">
        {filters.map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => setActive(filter.key)}
            className={`border px-4 py-2 text-xs uppercase tracking-widest transition-colors ${
              active === filter.key
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
          Aucun document dans cette catégorie pour le moment.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((document) => (
            <DocumentCard key={document.id} document={document} />
          ))}
        </div>
      )}
    </div>
  );
}
