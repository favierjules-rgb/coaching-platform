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
/**
 * MODE PRÉSENTIEL — le même hook, pour un élève DÉCLARÉ.
 *
 * ⚠️ DEUX CHOSES SEULEMENT CHANGENT, et elles sont ici : d'où vient l'identité
 * de l'élève, et quelle route reçoit la soumission. Les lectures
 * (`getWorkoutFeedbackBySession`, `getWorkoutFeedbackForStudent`) sont
 * strictement les mêmes : elles filtrent par `student_id`, et la RLS
 * `..._select` autorise déjà le staff sur ses élèves via
 * `student_ids_entrainement_lecture()`. Rien à dupliquer.
 *
 * ⚠️ `pourEleve` N'OUVRE AUCUN DROIT. Un identifiant transmis par le client
 * ne vaut rien en soi : la lecture reste sous RLS, et l'écriture est tranchée
 * par `requireStaffForStudent` côté serveur. Au pire, un coach curieux qui
 * forgerait un identifiant obtiendrait des listes vides et un 403.
 */
export interface OptionsFeedbackSeance {
  /**
   * `students.id` de l'élève dont on saisit la séance. Absent — le cas de
   * TOUS les montages élève —, l'identité est dérivée du compte connecté,
   * exactement comme avant.
   */
  readonly pourEleve?: string | null;
}

export function useSupabaseWorkoutFeedback(
  sessionKey: string,
  options: OptionsFeedbackSeance = {},
) {
  const pourEleve = options.pourEleve ?? null;
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
      /* Mode présentiel : l'élève est celui de la fiche ouverte, pas le
         compte connecté — un coach n'a pas de ligne `students`, et
         `getCurrentStudentId` rendrait `null`, ce qui désactiverait tout. */
      const id = pourEleve ?? (await getCurrentStudentId(supabase));
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
  }, [sessionKey, applyResult, pourEleve]);

  const submit = useCallback(
    async (payload: Omit<WorkoutFeedbackPayload, "studentId" | "sessionKey">) => {
      if (!studentId) return false;
      // Couche SERVEUR obligatoire (contrôle technique phase 1) : le client
      // n'envoie que le réalisé ; l'identité élève est dérivée de la session
      // authentifiée côté serveur et le snapshot du prescrit y est construit
      // à partir des lignes réelles — jamais depuis le navigateur.
      /* ⚠️ DEUX ROUTES, DEUX CONTRATS. Celle de l'élève refuse la clé
         `studentId` par son schéma strict — c'est sa promesse, et on n'y
         touche pas. Celle du présentiel l'exige, et la valide par
         `requireStaffForStudent` avant la moindre lecture. */
      const route = pourEleve
        ? "/api/admin/presentiel/workout-feedback"
        : "/api/student/workout-feedback";
      const corps = pourEleve
        ? { ...payload, sessionKey, studentId: pourEleve }
        : { ...payload, sessionKey };
      try {
        const response = await fetch(route, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corps),
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
    [studentId, sessionKey, pourEleve],
  );

  return { ready, active: ready && studentId !== null, studentId, existingFeedback, history, submit };
}
