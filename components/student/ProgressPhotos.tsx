import { Camera, Target } from "lucide-react";

import type { ProgressPhoto, ProgressPhotoHighlight } from "@/types";

const highlightLabels: Record<ProgressPhotoHighlight, string> = {
  avant: "Avant",
  actuelle: "Actuelle",
  objectif: "Objectif",
};

function PhotoTile({
  photo,
  label,
}: {
  photo: ProgressPhoto;
  label: string;
}) {
  return (
    <div className="flex flex-col border border-border">
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
  const highlights = photos.filter(
    (photo): photo is ProgressPhoto & { highlight: ProgressPhotoHighlight } =>
      photo.highlight !== null,
  );
  const gallery = photos.filter((photo) => photo.highlight === null);

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
              label={highlightLabels[photo.highlight]}
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
