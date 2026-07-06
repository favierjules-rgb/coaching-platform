"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getWorkoutFeedbackBySession, saveWorkoutFeedback } from "@/lib/supabase/workout-feedback";
import type { AdminStudentFeedback, WorkoutFeedbackPayload } from "@/types";

/**
 * Retour de séance Supabase pour /entrainement/seance/[sessionId], avec
 * repli mock/localStorage géré par l'appelant (SessionFeedbackSection) :
 * `active` ne vaut `true` qu'une fois la vérification terminée ET un
 * compte élève Supabase réellement identifié pour l'utilisateur connecté
 * (voir lib/supabase/current-student.ts::getCurrentStudentId) — sinon
 * (Supabase non configuré, personne connecté, ou compte sans fiche élève),
 * l'appelant doit continuer avec useAdminData comme actuellement.
 */
export function useSupabaseWorkoutFeedback(sessionKey: string) {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [existingFeedback, setExistingFeedback] = useState<AdminStudentFeedback | null>(null);

  const applyResult = useCallback((id: string | null, feedback: AdminStudentFeedback | null) => {
    setStudentId(id);
    setExistingFeedback(feedback);
    setReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) applyResult(null, null);
        return;
      }
      const id = await getCurrentStudentId(supabase);
      if (!id) {
        if (!cancelled) applyResult(null, null);
        return;
      }
      const feedback = await getWorkoutFeedbackBySession(supabase, id, sessionKey);
      if (!cancelled) applyResult(id, feedback);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionKey, applyResult]);

  const submit = useCallback(
    async (payload: Omit<WorkoutFeedbackPayload, "studentId" | "sessionKey">) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId) return false;
      const saved = await saveWorkoutFeedback(supabase, { ...payload, studentId, sessionKey });
      if (saved) {
        setExistingFeedback(saved);
      }
      return saved !== null;
    },
    [studentId, sessionKey],
  );

  return { ready, active: ready && studentId !== null, existingFeedback, submit };
}
