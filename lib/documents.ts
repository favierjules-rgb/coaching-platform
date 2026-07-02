import type { DocumentCategory, DocumentResource, DocumentType } from "@/types";

export const documentCategoryLabels: Record<DocumentCategory, string> = {
  nutrition: "Nutrition",
  entrainement: "Entraînement",
  administratif: "Administratif",
};

export const documentTypeLabels: Record<DocumentType, string> = {
  pdf: "PDF",
  "vidéo": "Vidéo",
  lien: "Lien",
  guide: "Guide",
  image: "Image",
};

export const documentFilters = [
  { key: "tous", label: "Tous" },
  { key: "nutrition", label: "Nutrition" },
  { key: "entrainement", label: "Entraînement" },
  { key: "administratif", label: "Administratif" },
  { key: "vidéo", label: "Vidéos" },
  { key: "guide", label: "Guides" },
] as const;

export type DocumentFilterKey = (typeof documentFilters)[number]["key"];

export function matchesDocumentFilter(
  document: DocumentResource,
  filter: DocumentFilterKey,
): boolean {
  return (
    filter === "tous" ||
    document.category === filter ||
    document.type === filter
  );
}

export function matchesDocumentSearch(
  document: DocumentResource,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const haystack = [
    document.title,
    document.description,
    documentCategoryLabels[document.category],
    documentTypeLabels[document.type],
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(normalized);
}
