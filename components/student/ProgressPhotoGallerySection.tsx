"use client";

import { useState } from "react";

import { AddProgressPhotoModal } from "@/components/student/AddProgressPhotoModal";
import { ProgressPhotos } from "@/components/student/ProgressPhotos";
import type { ProgressPhoto } from "@/types";

interface ProgressPhotoGallerySectionProps {
  studentId: string;
  initialPhotos: ProgressPhoto[];
  defaultWeightKg: number;
}

export function ProgressPhotoGallerySection({
  studentId,
  initialPhotos,
  defaultWeightKg,
}: ProgressPhotoGallerySectionProps) {
  const [photos, setPhotos] = useState(initialPhotos);

  return (
    <div className="mb-6 border border-border bg-card p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-lg font-bold uppercase text-foreground">
          Photos de progression
        </h2>
        <AddProgressPhotoModal
          studentId={studentId}
          defaultWeightKg={defaultWeightKg}
          onAdd={(photo) => setPhotos((prev) => [...prev, photo])}
        />
      </div>
      <ProgressPhotos photos={photos} />
    </div>
  );
}
