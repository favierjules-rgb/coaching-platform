"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  addCurrentStudentMeasurement,
  addCurrentStudentProgressPhoto,
  getCurrentStudentProfile,
  updateCurrentStudentWeight,
} from "@/lib/supabase/current-student";
import { getStudentOnboardingDetails } from "@/lib/supabase/onboarding";
import { createProgressPhotoWithUpload } from "@/lib/supabase/progress-photos";
import { deleteProgressPhotoSupabase, updateStudentFields } from "@/lib/supabase/students";
import type { StudentProfileState } from "@/hooks/useStudentProfile";
import type { CustomMeasurementInput } from "@/components/student/UpdateMeasurementsModal";
import type {
  AdminStudent,
  BodyMeasurementType,
  ProgressPhoto,
  ProgressPhotoType,
  StudentProfile,
  SupabaseStudentProfile,
} from "@/types";

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
  // accessType/email : hors StudentProfileState (partagé avec le mock, qui
  // n'a ni l'un ni l'autre) — utilisés par ProfilPageContent pour afficher la
  // version "essentiel" d'un compte programme_seul (chantier suppression
  // auto. 6 mois).
  const [accessType, setAccessType] = useState<"coaching" | "programme_seul">("coaching");
  const [email, setEmail] = useState("");
  /*
   * LA FICHE `student_profiles` BRUTE — P8, et la SYMÉTRIE avec le coach.
   *
   * `useSupabaseStudentDetail` (côté coach) porte déjà exactement ce champ, et
   * lui aussi appelle `getFullAdminStudent` ET `getStudentProfile` : les quatre
   * blocs résumé — préférences alimentaires, sportives, blessures, objectifs —
   * ne peuvent pas être rendus depuis `AdminStudent`, qui n'en porte qu'un
   * sous-ensemble ancien dont trois colonnes sont mortes (voir
   * lib/profil-eleve-onboarding.ts).
   *
   * ⚠️ `null` VEUT DIRE « PAS DE FICHE », JAMAIS « PAS DE RÉPONSES ». L'écran
   * doit le dire, et ne JAMAIS retomber sur `data/student.ts` pour autant.
   *
   * ⚠️ UNE REQUÊTE DE PLUS, ASSUMÉE. `getFullAdminStudent` lit déjà cette
   * ligne mais ne la rend pas ; la lui faire rendre changerait sa signature et
   * tous ses appelants. C'est le même arbitrage, et la même duplication, que
   * côté coach depuis l'origine.
   */
  const [onboardingProfile, setOnboardingProfile] = useState<SupabaseStudentProfile | null>(null);

  const applyFetchResult = useCallback(
    (student: AdminStudent | null, profile: SupabaseStudentProfile | null) => {
      setStudentId(student?.id ?? null);
      setState(student ? toProfileState(student) : null);
      setAccessType(student?.accessType ?? "coaching");
      setEmail(student?.email ?? "");
      setOnboardingProfile(profile);
      setReady(true);
    },
    [],
  );

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      applyFetchResult(null, null);
      return;
    }
    const student = await getCurrentStudentProfile(supabase);
    const profile = student ? await getStudentOnboardingDetails(supabase, student.id) : null;
    applyFetchResult(student, profile);
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
        if (!cancelled) applyFetchResult(null, null);
        return;
      }
      const student = await getCurrentStudentProfile(supabase);
      const profile = student ? await getStudentOnboardingDetails(supabase, student.id) : null;
      if (!cancelled) applyFetchResult(student, profile);
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

  /*
   * L'UPLOAD RÉEL DEPUIS /profil — P3A.
   *
   * ⚠️ C'EST LE HOOK QUI CONNAÎT LE VRAI `students.id`, PAS LE FORMULAIRE.
   * `app/(student)/profil/page.tsx` passe `studentId={student.id}` depuis
   * `data/student.ts` : la prop reçue par `AddProgressPhotoModal` est un
   * identifiant de DÉMONSTRATION, même sous Supabase. L'upload doit donc
   * partir d'ici, où `studentId` vient de `getCurrentStudentProfile`, sinon
   * le fichier atterrirait sous un dossier Storage qui n'appartient à
   * personne — et la policy `progress_photos_bucket_student_or_staff`
   * (premier segment du chemin = current_student_id()) le refuserait.
   *
   * ⚠️ `photoType: "autre"` EST LE COMPORTEMENT HISTORIQUE, PAS UN DÉFAUT
   * CHOISI AU HASARD. Ce formulaire ne demande pas l'angle ; les 8 lignes
   * déjà en base portent toutes `photo_type = 'autre'`, la valeur par défaut
   * de la colonne. Le rôle de la photo (`type`), lui, est bien transporté.
   */
  const uploadPhoto = useCallback(
    async (
      file: File,
      meta: { type: ProgressPhotoType; date: string; weightKg: number | null; note: string },
    ): Promise<string | null> => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return "Connexion Supabase indisponible.";
      if (!studentId) return "Élève non identifié.";
      const result = await createProgressPhotoWithUpload(supabase, studentId, file, {
        photoType: "autre",
        type: meta.type,
        date: meta.date,
        weightKg: meta.weightKg,
        note: meta.note,
        uploadedBy: null,
        actorType: "student",
      });
      await refetch();
      return "error" in result ? result.error : null;
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

  return {
    ready,
    state,
    accessType,
    email,
    onboardingProfile,
    updateProfile,
    updateWeight,
    updateMeasurements,
    addPhoto,
    uploadPhoto,
    removePhoto,
  };
}
