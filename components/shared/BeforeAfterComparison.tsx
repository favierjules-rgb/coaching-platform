import { ImageOff } from "lucide-react";

import { formatDate } from "@/lib/admin";
import type { ProgressPhoto } from "@/types";

interface BeforeAfterComparisonProps {
  before: ProgressPhoto;
  after: ProgressPhoto;
  coachComment?: string | null;
}

function daysBetween(a: string, b: string): number | null {
  const timeA = new Date(a).getTime();
  const timeB = new Date(b).getTime();
  if (Number.isNaN(timeA) || Number.isNaN(timeB)) return null;
  return Math.round(Math.abs(timeB - timeA) / 86_400_000);
}

function formatWeightDelta(kg: number): string {
  const rounded = Math.round(kg * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded} kg`;
}

function PhotoColumn({ photo, label }: { photo: ProgressPhoto; label: string }) {
  return (
    <figure className="flex flex-col border border-border">
      {photo.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL signée Supabase Storage, non compatible next/image (domaine dynamique)
        <img
          src={photo.imageUrl}
          alt={`Photo "${label}" du ${formatDate(photo.date)}`}
          className="aspect-[3/4] w-full border-b border-border object-cover"
        />
      ) : (
        <div className="flex aspect-[3/4] w-full flex-col items-center justify-center gap-2 border-b border-border bg-gradient-to-br from-zinc-900 to-black text-muted-foreground">
          <ImageOff size={22} aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-widest">Image indisponible</span>
        </div>
      )}
      <figcaption className="flex flex-col gap-1 p-3 text-xs">
        <span className="font-heading text-sm font-bold uppercase text-foreground">{label}</span>
        <span className="text-muted-foreground">{formatDate(photo.date)}</span>
        <span className="text-foreground">
          {typeof photo.weightKg === "number" && Number.isFinite(photo.weightKg) ? `${photo.weightKg} kg` : "Poids non renseigné"}
        </span>
      </figcaption>
    </figure>
  );
}

/** Comparaison avant/après (chantier "supabase-progress-photos-before-after-export"), réutilisée côté élève et admin. */
export function BeforeAfterComparison({ before, after, coachComment }: BeforeAfterComparisonProps) {
  const duration = daysBetween(before.date, after.date);
  const hasWeights = typeof before.weightKg === "number" && typeof after.weightKg === "number";
  const weightDelta = hasWeights ? formatWeightDelta((after.weightKg as number) - (before.weightKg as number)) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <PhotoColumn photo={before} label="Avant" />
        <PhotoColumn photo={after} label="Après" />
      </div>
      <div role="list" aria-label="Résumé de la comparaison" className="flex flex-wrap gap-x-6 gap-y-2 border border-border bg-background p-4 text-sm">
        {duration !== null && (
          <p role="listitem">
            <span className="text-muted-foreground">Durée : </span>
            <span className="text-foreground">
              {duration} jour{duration > 1 ? "s" : ""}
            </span>
          </p>
        )}
        {weightDelta !== null && (
          <p role="listitem">
            <span className="text-muted-foreground">Variation de poids : </span>
            <span className="text-foreground">{weightDelta}</span>
          </p>
        )}
        {!hasWeights && (
          <p role="listitem" className="text-muted-foreground">
            Poids non renseigné pour au moins une des deux photos.
          </p>
        )}
      </div>
      {coachComment && (
        <div className="border border-border bg-background p-4 text-sm">
          <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Commentaire du coach</p>
          <p className="leading-relaxed text-foreground">{coachComment}</p>
        </div>
      )}
    </div>
  );
}
