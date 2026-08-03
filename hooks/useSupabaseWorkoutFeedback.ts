"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getWorkoutFeedbackBySession, getWorkoutFeedbackForStudent } from "@/lib/supabase/workout-feedback";
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
  // Historique COMPLET des retours de l'élève connecté
  // (feat/student-previous-set-performance) : mêmes fonctions de lecture que
  // /entrainement/historique — par student_id, indépendant des assignations,
  // en requêtes GROUPÉES (3 requêtes pour TOUTE la séance, jamais une par
  // exercice). Sert uniquement aux repères « Dernières perfs » ; en cas
  // d'échec de lecture, tableau vide = simplement aucun repère affiché.
  const [history, setHistory] = useState<AdminStudentFeedback[]>([]);

  const applyResult = useCallback(
    (id: string | null, feedback: AdminStudentFeedback | null, historique: AdminStudentFeedback[]) => {
      setStudentId(id);
      setExistingFeedback(feedback);
      setHistory(historique);
      setReady(true);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) applyResult(null, null, []);
        return;
      }
      const id = await getCurrentStudentId(supabase);
      if (!id) {
        if (!cancelled) applyResult(null, null, []);
        return;
      }
      const [feedback, historique] = await Promise.all([
        getWorkoutFeedbackBySession(supabase, id, sessionKey),
        getWorkoutFeedbackForStudent(supabase, id),
      ]);
      if (!cancelled) applyResult(id, feedback, historique);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [sessionKey, applyResult]);

  const submit = useCallback(
    async (payload: Omit<WorkoutFeedbackPayload, "studentId" | "sessionKey">) => {
      if (!studentId) return false;
      // Couche SERVEUR obligatoire (contrôle technique phase 1) : le client
      // n'envoie que le réalisé ; l'identité élève est dérivée de la session
      // authentifiée côté serveur et le snapshot du prescrit y est construit
      // à partir des lignes réelles — jamais depuis le navigateur.
      try {
        const response = await fetch("/api/student/workout-feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, sessionKey }),
        });
        if (!response.ok) return false;
        const { feedback } = (await response.json()) as { feedback: AdminStudentFeedback | null };
        if (feedback) {
          setExistingFeedback(feedback);
        }
        return feedback != null;
      } catch {
        return false;
      }
    },
    [studentId, sessionKey],
  );

  return { ready, active: ready && studentId !== null, studentId, existingFeedback, history, submit };
}
