import { AddProgressPhotoModal } from "@/components/student/AddProgressPhotoModal";
import { ProgressPhotos } from "@/components/student/ProgressPhotos";
import type { ProgressPhoto } from "@/types";

interface ProgressPhotoGallerySectionProps {
  studentId: string;
  photos: ProgressPhoto[];
  defaultWeightKg: number;
  onAdd: (photo: ProgressPhoto) => void;
  onDelete?: (photoId: string) => void;
}

/**
 * Purement présentationnel : `photos` vient du hook partagé
 * useStudentProfile, monté une seule fois plus haut sur la page.
 */
export function ProgressPhotoGallerySection({
  studentId,
  photos,
  defaultWeightKg,
  onAdd,
  onDelete,
}: ProgressPhotoGallerySectionProps) {
  return (
    <div className="mb-6 border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Photos de progression
        </h2>
        <AddProgressPhotoModal
          studentId={studentId}
          defaultWeightKg={defaultWeightKg}
          onAdd={onAdd}
        />
      </div>
      <ProgressPhotos photos={photos} onDelete={onDelete} />
    </div>
  );
}
