"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getAssignedNutritionPlansForStudent } from "@/lib/supabase/nutrition";
import type { AdminNutritionPlan } from "@/types";

/**
 * Plans alimentaires réellement assignés à l'élève connecté, pour les
 * pages /nutrition — même principe que useSupabaseTrainingProgram :
 * `ready` passe à `true` une fois la vérification terminée, `active` ne
 * vaut `true` que si un compte élève Supabase est réellement identifié
 * (sinon l'appelant retombe sur data/student.ts, comme actuellement).
 * `plans` reste un tableau vide tant que l'élève réel n'a aucun plan
 * assigné ("Aucun plan alimentaire attribué"), même si `active` est vrai.
 * `activePlan` est celui à mettre en avant (statut "actif", sinon le plus
 * récemment assigné).
 */
export function useSupabaseNutritionForStudent() {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [plans, setPlans] = useState<AdminNutritionPlan[]>([]);

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
      const assignedPlans = await getAssignedNutritionPlansForStudent(supabase, id);
      if (!cancelled) {
        setStudentId(id);
        setPlans(assignedPlans);
        setReady(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activePlan = plans.find((p) => p.status === "actif") ?? null;

  return { ready, active: ready && studentId !== null, studentId, plans, activePlan };
}
