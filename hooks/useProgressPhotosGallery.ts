"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  archiveProgressPhoto,
  createProgressPhotoWithUpload,
  deleteProgressPhotoPermanently,
  listProgressPhotosWithSignedUrls,
  setAfterCandidate,
  setBeforeCandidate,
  updateProgressPhotoMeta,
  type CreateProgressPhotoInput,
  type UpdateProgressPhotoMetaInput,
} from "@/lib/supabase/progress-photos";
import type { ProgressPhoto } from "@/types";

export interface ProgressPhotosGalleryState {
  loading: boolean;
  photos: ProgressPhoto[];
  refetch: () => Promise<void>;
  uploadPhoto: (file: File, meta: Omit<CreateProgressPhotoInput, "actorType" | "uploadedBy">) => Promise<string | null>;
  updateMeta: (photoId: string, meta: UpdateProgressPhotoMetaInput) => Promise<boolean>;
  archivePhoto: (photoId: string) => Promise<boolean>;
  deletePhoto: (photoId: string) => Promise<boolean>;
  selectBefore: (photoId: string) => Promise<boolean>;
  selectAfter: (photoId: string) => Promise<boolean>;
}

/**
 * Galerie de photos de progression pour un élève donné (chantier
 * "supabase-progress-photos-before-after-export"), partagée entre
 * /progression (actorType "student", studentId résolu via
 * getCurrentStudentId) et /admin/eleves/[studentId]/progression (actorType
 * "coach", studentId = paramètre de route). `includeArchived` vaut
 * automatiquement true côté coach (peut consulter/restaurer l'archive),
 * false côté élève.
 */
export function useProgressPhotosGallery(
  studentId: string | null | undefined,
  actorType: "student" | "coach",
): ProgressPhotosGalleryState {
  const [loading, setLoading] = useState(true);
  const [photos, setPhotos] = useState<ProgressPhoto[]>([]);

  const refetch = useCallback(async () => {
    if (!studentId) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setPhotos([]);
      setLoading(false);
      return;
    }
    const list = await listProgressPhotosWithSignedUrls(supabase, studentId, { includeArchived: actorType === "coach" });
    setPhotos(list);
    setLoading(false);
  }, [studentId, actorType]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      if (!studentId) {
        if (!cancelled) {
          setPhotos([]);
          setLoading(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setPhotos([]);
          setLoading(false);
        }
        return;
      }
      const list = await listProgressPhotosWithSignedUrls(supabase, studentId, { includeArchived: actorType === "coach" });
      if (!cancelled) {
        setPhotos(list);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [studentId, actorType]);

  const uploadPhoto = useCallback(
    async (file: File, meta: Omit<CreateProgressPhotoInput, "actorType" | "uploadedBy">) => {
      if (!studentId) return "Élève non identifié.";
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return "Connexion Supabase indisponible.";
      const result = await createProgressPhotoWithUpload(supabase, studentId, file, {
        ...meta,
        actorType,
        uploadedBy: null,
      });
      await refetch();
      return "error" in result ? result.error : null;
    },
    [studentId, actorType, refetch],
  );

  const updateMeta = useCallback(
    async (photoId: string, meta: UpdateProgressPhotoMetaInput) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      const ok = await updateProgressPhotoMeta(supabase, photoId, meta);
      await refetch();
      return ok;
    },
    [refetch],
  );

  const archivePhoto = useCallback(
    async (photoId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      const ok = await archiveProgressPhoto(supabase, photoId);
      await refetch();
      return ok;
    },
    [refetch],
  );

  const deletePhoto = useCallback(
    async (photoId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      const photo = photos.find((p) => p.id === photoId);
      const ok = await deleteProgressPhotoPermanently(supabase, photoId, photo?.storagePath ?? null);
      await refetch();
      return ok;
    },
    [refetch, photos],
  );

  const selectBefore = useCallback(
    async (photoId: string) => {
      if (!studentId) return false;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      const ok = await setBeforeCandidate(supabase, studentId, photoId);
      await refetch();
      return ok;
    },
    [studentId, refetch],
  );

  const selectAfter = useCallback(
    async (photoId: string) => {
      if (!studentId) return false;
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return false;
      const ok = await setAfterCandidate(supabase, studentId, photoId);
      await refetch();
      return ok;
    },
    [studentId, refetch],
  );

  return { loading, photos, refetch, uploadPhoto, updateMeta, archivePhoto, deletePhoto, selectBefore, selectAfter };
}
