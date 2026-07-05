"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import {
  getAdminWorkoutFeedbackList,
  updateWorkoutFeedbackCoachReply,
  updateWorkoutFeedbackStatus,
} from "@/lib/supabase/workout-feedback";
import type { AdminStudentFeedback, FeedbackStatus } from "@/types";

/**
 * Liste des retours d'entraînement Supabase pour /admin/retours, avec les
 * actions coach (statut, réponse) qui rafraîchissent la liste après
 * écriture. `loading` reste vrai le temps du chargement initial ; `feedback`
 * est un tableau vide tant que Supabase n'est pas configuré, n'a encore
 * aucun retour, ou en cas d'erreur — l'appelant (app/admin/retours/page.tsx)
 * retombe alors sur la liste mock (useAdminData), comme pour
 * hooks/useSupabaseStudents.ts.
 */
export function useSupabaseAdminFeedback() {
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState<AdminStudentFeedback[]>([]);

  const applyResult = useCallback((list: AdminStudentFeedback[]) => {
    setFeedback(list);
    setLoading(false);
  }, []);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      applyResult([]);
      return;
    }
    const list = await getAdminWorkoutFeedbackList(supabase);
    applyResult(list);
  }, [applyResult]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) applyResult([]);
        return;
      }
      const list = await getAdminWorkoutFeedbackList(supabase);
      if (!cancelled) applyResult(list);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [applyResult]);

  const updateStatus = useCallback(
    async (feedbackId: string, status: FeedbackStatus) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      await updateWorkoutFeedbackStatus(supabase, feedbackId, status);
      await refetch();
    },
    [refetch],
  );

  const addReply = useCallback(
    async (feedbackId: string, reply: string) => {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      await updateWorkoutFeedbackCoachReply(supabase, feedbackId, reply);
      await refetch();
    },
    [refetch],
  );

  return { loading, feedback, updateStatus, addReply };
}
