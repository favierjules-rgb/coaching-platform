import { Camera, Target } from "lucide-react";

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

function PhotoTile({
  photo,
  label,
}: {
  photo: ProgressPhoto;
  label: string;
}) {
  return (
    <div className="flex flex-col border border-border">
      {photo.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- image locale (blob:) non compatible avec next/image
        <img
          src={photo.imageUrl}
          alt={`Photo de progression — ${label}`}
          className="aspect-[3/4] w-full border-b border-border object-cover"
        />
      ) : (
        <div className="flex aspect-[3/4] flex-col items-center justify-center gap-2 border-b border-border bg-gradient-to-br from-zinc-900 to-black">
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
          <span>{new Date(photo.date).toLocaleDateString("fr-FR")}</span>
          {photo.weightKg !== null && (
            <span className="text-foreground">{photo.weightKg} kg</span>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {photo.note}
        </p>
      </div>
    </div>
  );
}

export function ProgressPhotos({ photos }: { photos: ProgressPhoto[] }) {
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <span className="mb-3 block text-xs uppercase tracking-wide text-muted-foreground">
          Avant / actuelle / objectif
        </span>
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {highlights.map((photo) => (
            <PhotoTile
              key={photo.id}
              photo={photo}
              label={highlightLabels[photo.type as Exclude<ProgressPhotoType, "mensuelle">]}
            />
          ))}
        </div>
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
                label={new Date(photo.date).toLocaleDateString("fr-FR", {
                  month: "short",
                })}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
