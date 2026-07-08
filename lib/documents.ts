import type { DocumentCategory, DocumentResource, DocumentType } from "@/types";

/**
 * Intervalle (en semaines de programme) entre chaque palier de niveau pour
 * le déblocage automatique progressif : niveau 1 dès la semaine 1, niveau 2
 * à la semaine 3, niveau 3 à la semaine 5, etc.
 */
export const DOCUMENT_UNLOCK_INTERVAL_WEEKS = 2;

export interface StudentDocumentAvailability {
  available: boolean;
  unlockAtWeek: number | null;
}

/**
 * Calcule si un document est disponible pour l'élève en fonction de sa
 * semaine de programme actuelle. Prépare la logique future Supabase (une
 * vraie date de déblocage par élève) sans encore la connecter.
 */
export function computeStudentDocumentAvailability(
  document: DocumentResource,
  weekNumber: number,
): StudentDocumentAvailability {
  if (document.distributionMode === "immediat") {
    return { available: true, unlockAtWeek: null };
  }
  const unlockAtWeek = 1 + Math.max(0, document.level - 1) * DOCUMENT_UNLOCK_INTERVAL_WEEKS;
  return {
    available: weekNumber >= unlockAtWeek,
    unlockAtWeek: weekNumber >= unlockAtWeek ? null : unlockAtWeek,
  };
}

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
  texte: "Texte / note",
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
