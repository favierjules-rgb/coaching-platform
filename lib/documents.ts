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

/* ═══════════════════════════════════════════════════════════════════════
   CLASSIFICATION DU FICHIER (B) — LE MIME DÉCIDE, PAS LA DÉCLARATION
   ═══════════════════════════════════════════════════════════════════════ */

/** Ce qu'on sait RENDRE — distinct de `DocumentType`, qui est ce que le coach déclare. */
export type DocumentKind = "image" | "pdf" | "video" | "autre";

/**
 * ⚠️ LE MIME RÉEL PASSE AVANT `document.type`, ET CE N'EST PAS UN DÉTAIL.
 *
 * `documents.type` est un `<select>` rempli à la main par le coach, modifiable
 * APRÈS l'upload et sans aucune revalidation du fichier déjà présent : passer
 * un document de `pdf` à `image` laisse `storage_path` sur le PDF. Un
 * aiguillage sur `type` rendait donc un PDF comme une image, et inversement,
 * sur la seule foi d'une déclaration.
 *
 * `file_mime_type` est un FAIT : il vient de `file.type` au moment de l'upload
 * (lib/supabase/storage-documents.ts) et il est aussi le `contentType` de
 * l'objet Storage. Il décide.
 *
 * `type` ne sert plus que de REPLI, pour les lignes antérieures au champ
 * `file_mime_type` (7 des 17 documents actuels l'ont à `null`).
 *
 * « Absent » couvre TROIS valeurs, et il faut les trois :
 *   · `null`                      — ligne antérieure au champ ;
 *   · `""`                        — une édition a transformé l'absence en chaîne
 *                                   vide (corrigé par ailleurs dans ce lot,
 *                                   mais les lignes déjà écrites restent) ;
 *   · `"application/octet-stream"` — c'est le marqueur que pose
 *                                   `uploadDocumentFile` quand `file.type`
 *                                   est vide : il dit « MIME inconnu », pas
 *                                   « fichier binaire à ne pas afficher ».
 */
export function documentKind(document: {
  type: DocumentType;
  fileMimeType: string | null;
}): DocumentKind {
  const mime = (document.fileMimeType ?? "").trim().toLowerCase();
  const mimeInconnu = mime === "" || mime === "application/octet-stream";

  if (!mimeInconnu) {
    if (mime.startsWith("image/")) return "image";
    if (mime === "application/pdf") return "pdf";
    if (mime.startsWith("video/")) return "video";
    // Un MIME présent mais d'une autre famille (zip, docx…) est un fait, lui
    // aussi : on ne retombe PAS sur `type` pour le contredire.
    return "autre";
  }

  switch (document.type) {
    case "image":
      return "image";
    case "pdf":
      return "pdf";
    case "vidéo":
      return "video";
    default:
      return "autre";
  }
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
