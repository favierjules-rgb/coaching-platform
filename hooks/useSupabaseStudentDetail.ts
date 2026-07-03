"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  addCoachNoteSupabase,
  addProgressPhotoSupabase,
  deleteProgressPhotoSupabase,
  getFullAdminStudent,
  updateStudentFields,
  updateStudentPaymentSupabase,
  upsertBodyMeasurements,
  upsertCustomMeasurement,
} from "@/lib/supabase/students";
import type { CustomMeasurementInput } from "@/components/student/UpdateMeasurementsModal";
import type { AdminStudent, BodyMeasurementType, ProgressPhoto, StudentPaymentProfile } from "@/types";

/**
 * Équivalent Supabase de la logique mock (useAdminData + isLinked) pour
 * /admin/eleves/[studentId] : charge la fiche complète d'un élève par id et
 * expose des handlers d'écriture avec la même forme que les handlers mock
 * de la page, pour que le JSX de la page n'ait pas à changer.
 *
 * `student` vaut `null` tant que le chargement est en cours ou si aucun
 * élève Supabase ne correspond à cet id (cas normal pour un id mock du
 * type "adm-1", qui n'est pas un UUID) — la page retombe alors sur la
 * logique mock existante (isLinked / useAdminData).
 */
export function useSupabaseStudentDetail(studentId: string | undefined) {
  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<AdminStudent | null>(null);
  const entryCountRef = useRef(0);

  const applyFetchResult = useCallback((found: AdminStudent | null) => {
    entryCountRef.current = found?.paymentProfile.entries.length ?? 0;
    setStudent(found);
    setLoading(false);
  }, []);

  const refetch = useCallback(async () => {
    if (!studentId) {
      applyFetchResult(null);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      applyFetchResult(null);
      return;
    }
    const found = await getFullAdminStudent(supabase, studentId);
    applyFetchResult(found);
  }, [studentId, applyFetchResult]);

  // Chargement initial isolé de `refetch` (appelé plus bas par les
  // handlers d'écriture) pour que l'appel de mise à jour d'état reste
  // imbriqué dans une fonction locale à l'effet plutôt qu'un appel direct
  // d'un callback de hook, conformément à la règle react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!studentId) {
        if (!cancelled) applyFetchResult(null);
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) applyFetchResult(null);
        return;
      }
      const found = await getFullAdminStudent(supabase, studentId);
      if (!cancelled) applyFetchResult(found);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [studentId, applyFetchResult]);

  const updateFields = useCallback(
    async (partial: Partial<AdminStudent>) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return;
      await updateStudentFields(supabase, studentId, partial);
      await refetch();
    },
    [studentId, refetch],
  );

  const updateWeight = useCallback(
    async (weightKg: number) => {
      await updateFields({ currentWeightKg: weightKg });
    },
    [updateFields],
  );

  const updateTarget = useCallback(
    async (targetKg: number) => {
      await updateFields({ targetWeightKg: targetKg });
    },
    [updateFields],
  );

  const updateMeasurements = useCallback(
    async (
      values: Partial<Record<BodyMeasurementType, number>>,
      date: string,
      note: string,
      custom: CustomMeasurementInput | null,
    ) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return;
      await upsertBodyMeasurements(supabase, studentId, values, date, note);
      if (custom) {
        await upsertCustomMeasurement(supabase, studentId, custom, date);
      }
      await refetch();
    },
    [studentId, refetch],
  );

  const addPhoto = useCallback(
    async (photo: ProgressPhoto) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return;
      await addProgressPhotoSupabase(supabase, studentId, {
        type: photo.type,
        date: photo.date,
        weightKg: photo.weightKg,
        note: photo.note,
        imageUrl: photo.imageUrl,
        storagePath: photo.storagePath,
        pending: photo.pending,
      });
      await refetch();
    },
    [studentId, refetch],
  );

  const deletePhoto = useCallback(
    async (photoId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      await deleteProgressPhotoSupabase(supabase, photoId);
      await refetch();
    },
    [refetch],
  );

  const updatePayment = useCallback(
    async (nextProfile: StudentPaymentProfile) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return;
      await updateStudentPaymentSupabase(supabase, studentId, entryCountRef.current, nextProfile);
      await refetch();
    },
    [studentId, refetch],
  );

  const addCoachNote = useCallback(
    async (text: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return;
      await addCoachNoteSupabase(supabase, studentId, text);
      await refetch();
    },
    [studentId, refetch],
  );

  return {
    loading,
    student,
    updateStudentFields: updateFields,
    updateWeight,
    updateTarget,
    updateMeasurements,
    addPhoto,
    deletePhoto,
    updatePayment,
    addCoachNote,
  };
}
