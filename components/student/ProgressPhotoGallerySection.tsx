import {
  AddProgressPhotoModal,
  type AjoutPhotoMeta,
} from "@/components/student/AddProgressPhotoModal";
import { ProgressPhotos } from "@/components/student/ProgressPhotos";
import type { ProgressPhoto } from "@/types";

interface ProgressPhotoGallerySectionProps {
  studentId: string;
  photos: ProgressPhoto[];
  defaultWeightKg: number;
  onAdd: (photo: ProgressPhoto) => void;
  /**
   * Téléverseur Storage (P3A) — relayé tel quel à `AddProgressPhotoModal`,
   * dont la présence décide du mode. Absent = parcours de démonstration.
   */
  onUpload?: (file: File, meta: AjoutPhotoMeta) => Promise<string | null>;
  onDelete?: (photoId: string) => void;
}

/**
 * Purement présentationnel : `photos` vient du hook partagé
 * useStudentProfile, monté une seule fois plus haut sur la page.
 *
 * ⚠️ IL NE DÉCIDE PAS DU MODE D'UPLOAD, IL LE RELAIE. C'est le parent qui
 * sait si un élève Supabase réel est identifié — et, sur `/profil`, c'est le
 * seul à connaître le vrai `students.id` (la prop `studentId` y vient de
 * `data/student.ts`). Voir l'en-tête d'`AddProgressPhotoModal`.
 */
export function ProgressPhotoGallerySection({
  studentId,
  photos,
  defaultWeightKg,
  onAdd,
  onUpload,
  onDelete,
}: ProgressPhotoGallerySectionProps) {
  return (
    <div className="mb-6 rounded-card border border-border bg-card p-6 shadow-soft">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Photos de progression
        </h2>
        <AddProgressPhotoModal
          studentId={studentId}
          defaultWeightKg={defaultWeightKg}
          onAdd={onAdd}
          onUpload={onUpload}
        />
      </div>
      <ProgressPhotos photos={photos} onDelete={onDelete} />
    </div>
  );
}
