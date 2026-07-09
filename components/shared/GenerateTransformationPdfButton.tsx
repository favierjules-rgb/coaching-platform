"use client";

import { useState } from "react";
import { Download, FileWarning } from "lucide-react";

import { downloadPdfBlob, generateTransformationRecapPdf, type TransformationRecapInput } from "@/lib/pdf/transformation-recap";

interface GenerateTransformationPdfButtonProps {
  /** null tant qu'il manque une photo "avant" ou "après" sélectionnée. */
  input: TransformationRecapInput | null;
  fileName: string;
  label?: string;
}

/** Bouton "Générer / Télécharger le PDF" partagé élève + admin (chantier "supabase-progress-photos-before-after-export"). */
export function GenerateTransformationPdfButton({
  input,
  fileName,
  label = "Télécharger le PDF avant/après",
}: GenerateTransformationPdfButtonProps) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    if (!input) return;
    setGenerating(true);
    setError(null);
    try {
      const blob = await generateTransformationRecapPdf(input);
      downloadPdfBlob(blob, fileName);
    } catch {
      setError("Échec de la génération du PDF. Réessaie.");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={!input || generating}
        className="flex items-center gap-2 border border-primary px-4 py-2 text-xs uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-primary"
      >
        <Download size={14} aria-hidden="true" />
        {generating ? "Génération…" : label}
      </button>
      {!input && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <FileWarning size={12} aria-hidden="true" />
          Sélectionne une photo « avant » et une photo « après » pour générer le PDF.
        </p>
      )}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
