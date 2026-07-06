"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  addCurrentStudentMeasurement,
  addCurrentStudentProgressPhoto,
  getCurrentStudentProfile,
  updateCurrentStudentWeight,
} from "@/lib/supabase/current-student";
import { deleteProgressPhotoSupabase, updateStudentFields } from "@/lib/supabase/students";
import type { StudentProfileState } from "@/hooks/useStudentProfile";
import type { CustomMeasurementInput } from "@/components/student/UpdateMeasurementsModal";
import type { AdminStudent, BodyMeasurementType, ProgressPhoto, StudentProfile } from "@/types";

function toProfileState(student: AdminStudent): StudentProfileState {
  const profile: StudentProfile = {
    id: student.id,
    firstName: student.firstName,
    lastName: student.lastName,
    goal: student.goal,
    level: student.level,
    startDate: student.startDate,
    weekNumber: 1,
    age: student.age,
    heightCm: student.heightCm,
    currentWeightKg: student.currentWeightKg,
    targetWeightKg: student.targetWeightKg,
    trainingFrequencyPerWeek: student.trainingFrequencyPerWeek,
    trainingLocation: student.trainingLocation,
    coachingStatus: student.status,
  };
  return {
    profile,
    weightHistory: student.weightHistory,
    measurements: student.measurements,
    customMeasurements: student.customMeasurements,
    measurementHistory: student.measurementHistory,
    photos: student.progressPhotos,
  };
}

/**
 * Équivalent Supabase de hooks/useStudentProfile.ts pour /profil, avec la
 * même interface de retour (state + updateProfile/updateWeight/
 * updateMeasurements/addPhoto/removePhoto) pour que ProfilPageContent
 * puisse choisir entre les deux sans changer sa logique de rendu.
 *
 * `ready` vaut `false` tant que la vérification Supabase est en cours (pour
 * éviter un flash de contenu mock avant de savoir si un vrai profil élève
 * existe), puis `true` avec soit un `state` réel, soit `state: null` si
 * Supabase n'est pas configuré, si personne n'est connecté, ou si le compte
 * connecté n'a pas encore de fiche élève — dans tous ces cas l'appelant doit
 * retomber sur le mock/localStorage.
 */
export function useSupabaseStudentProfile() {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [state, setState] = useState<StudentProfileState | null>(null);

  const applyFetchResult = useCallback((student: AdminStudent | null) => {
    setStudentId(student?.id ?? null);
    setState(student ? toProfileState(student) : null);
    setReady(true);
  }, []);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      applyFetchResult(null);
      return;
    }
    const student = await getCurrentStudentProfile(supabase);
    applyFetchResult(student);
  }, [applyFetchResult]);

  // Chargement initial isolé de `refetch` (appelé plus bas par les
  // handlers d'écriture) : l'appel de mise à jour d'état reste imbriqué
  // dans une fonction locale à l'effet plutôt qu'un appel direct d'un
  // callback de hook, conformément à la règle react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) applyFetchResult(null);
        return;
      }
      const student = await getCurrentStudentProfile(supabase);
      if (!cancelled) applyFetchResult(student);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [applyFetchResult]);

  const updateProfile = useCallback(
    async (partial: Partial<StudentProfile>): Promise<boolean> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return false;
      const success = await updateStudentFields(supabase, studentId, partial);
      await refetch();
      return success;
    },
    [studentId, refetch],
  );

  const updateWeight = useCallback(
    async (weightKg: number): Promise<boolean> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return false;
      const success = await updateCurrentStudentWeight(supabase, studentId, weightKg);
      await refetch();
      return success;
    },
    [studentId, refetch],
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
      await addCurrentStudentMeasurement(supabase, studentId, values, date, note, custom);
      await refetch();
    },
    [studentId, refetch],
  );

  const addPhoto = useCallback(
    async (photo: ProgressPhoto) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return;
      await addCurrentStudentProgressPhoto(supabase, studentId, {
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

  const removePhoto = useCallback(
    async (photoId: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      await deleteProgressPhotoSupabase(supabase, photoId);
      await refetch();
    },
    [refetch],
  );

  return { ready, state, updateProfile, updateWeight, updateMeasurements, addPhoto, removePhoto };
}
