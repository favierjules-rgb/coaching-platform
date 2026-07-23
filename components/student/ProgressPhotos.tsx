import { Camera, ImageOff, Target, Trash2 } from "lucide-react";

import type { ProgressPhoto, ProgressPhotoType } from "@/types";

const highlightLabels: Record<Exclude<ProgressPhotoType, "mensuelle">, string> = {
  avant: "Avant",
  actuelle: "Actuelle",
  objectif: "Objectif",
};

const highlightTypes: Exclude<ProgressPhotoType, "mensuelle">[] = [
  "avant",
  "actuelle",
  "objectif",
];

function formatPhotoDate(dateIso: string | null | undefined): string {
  if (!dateIso) {
    return "Date non renseignée";
  }
  const date = new Date(dateIso);
  if (Number.isNaN(date.getTime())) {
    return "Date non renseignée";
  }
  return date.toLocaleDateString("fr-FR");
}

function PhotoTile({
  photo,
  label,
  onDelete,
}: {
  photo: ProgressPhoto;
  label: string;
  onDelete?: (photoId: string) => void;
}) {
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-panel border border-border">
      {onDelete && (
        <button
          type="button"
          onClick={() => onDelete(photo.id)}
          aria-label="Supprimer cette photo"
          className="absolute right-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-control border border-border bg-foreground/75 text-background opacity-0 transition-opacity hover:border-destructive/60 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 group-hover:opacity-100"
        >
          <Trash2 size={14} />
        </button>
      )}
      {photo.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- image locale (data URL / blob:) non compatible avec next/image
        <img
          src={photo.imageUrl}
          alt={`Photo de progression — ${label}`}
          className="aspect-[3/4] w-full border-b border-border object-cover"
        />
      ) : (
        <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 border-b border-border bg-surface-soft">
          {photo.pending ? (
            <Target size={22} className="text-primary" />
          ) : (
            <Camera size={22} className="text-primary" />
          )}
          <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
            {label}
          </span>
          {photo.pending && (
            <span className="text-[10px] text-muted-foreground">À venir</span>
          )}
        </div>
      )}
      <div className="flex flex-col gap-1 p-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatPhotoDate(photo.date)}</span>
          {typeof photo.weightKg === "number" && Number.isFinite(photo.weightKg) && (
            <span className="text-foreground">{photo.weightKg} kg</span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {photo.note || ""}
        </p>
      </div>
    </div>
  );
}

export function ProgressPhotos({
  photos,
  onDelete,
}: {
  photos: ProgressPhoto[];
  onDelete?: (photoId: string) => void;
}) {
  const safePhotos = Array.isArray(photos) ? photos : [];

  const highlights = highlightTypes
    .map((type) => {
      const matches = safePhotos.filter((photo) => photo.type === type);
      if (matches.length === 0) {
        return null;
      }
      return matches.reduce((latest, photo) =>
        new Date(photo.date) > new Date(latest.date) ? photo : latest,
      );
    })
    .filter((photo): photo is ProgressPhoto => photo !== null);

  const highlightIds = new Set(highlights.map((photo) => photo.id));
  const gallery = safePhotos
    .filter((photo) => !highlightIds.has(photo.id))
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (safePhotos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border bg-surface-soft/40 py-10 text-center">
        <ImageOff size={22} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Aucune photo de progression pour le moment.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
          Avant / actuelle / objectif
        </span>
        {highlights.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune photo Avant / Actuelle / Objectif pour le moment.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            {highlights.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                label={highlightLabels[photo.type as Exclude<ProgressPhotoType, "mensuelle">]}
                onDelete={onDelete}
              />
            ))}
          </div>
        )}
      </div>

      {gallery.length > 0 && (
        <div>
          <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
            Galerie mensuelle
          </span>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {gallery.map((photo) => (
              <PhotoTile
                key={photo.id}
                photo={photo}
                label={formatPhotoDate(photo.date) === "Date non renseignée"
                  ? "Photo"
                  : new Date(photo.date).toLocaleDateString("fr-FR", { month: "short" })}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
