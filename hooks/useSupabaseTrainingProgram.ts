"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId, getCurrentStudentProfile } from "@/lib/supabase/current-student";
import { getAssignedProgramsForStudent } from "@/lib/supabase/programs";
import type { AdminProgram, AdminStudent } from "@/types";

/**
 * Programmes réellement assignés à l'élève connecté, pour les pages
 * /entrainement — même principe que useSupabaseWorkoutFeedback :
 * `ready` passe à `true` une fois la vérification terminée, `active` ne
 * vaut `true` que si un compte élève Supabase est réellement identifié
 * (sinon l'appelant retombe sur data/student.ts, comme actuellement).
 * `programs` reste un tableau vide tant que l'élève réel n'a aucun
 * programme assigné ("Aucun programme attribué"), même si `active` est vrai.
 * `activeProgram` est celui à mettre en avant (statut "actif", sinon le
 * plus récemment assigné).
 */
export function useSupabaseTrainingProgram() {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [student, setStudent] = useState<AdminStudent | null>(null);
  const [programs, setPrograms] = useState<AdminProgram[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const id = await getCurrentStudentId(supabase);
      if (!id) {
        if (!cancelled) setReady(true);
        return;
      }
      const [studentProfile, assignedPrograms] = await Promise.all([
        getCurrentStudentProfile(supabase),
        getAssignedProgramsForStudent(supabase, id),
      ]);
      if (!cancelled) {
        setStudentId(id);
        setStudent(studentProfile);
        setPrograms(assignedPrograms);
        setReady(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProgram = programs.find((p) => p.status === "actif") ?? programs[0] ?? null;

  return { ready, active: ready && studentId !== null, studentId, student, programs, activeProgram };
}
