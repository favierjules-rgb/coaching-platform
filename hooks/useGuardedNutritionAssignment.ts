"use client";

import { useCallback, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { guardNutritionAssignment } from "@/lib/supabase/nutrition-assignment-guard";
import { ASSIGN_REFUSED_BY_DATABASE_FR } from "@/lib/supabase/nutrition-assignment";
import type { AssignableContentType } from "@/types";

type SetAssignmentFn = (
  studentId: string,
  contentType: AssignableContentType,
  contentId: string,
  assigned: boolean,
) => Promise<boolean>;

/**
 * Enveloppe la fonction d'assignation existante avec la GARDE v2, sans
 * toucher à `useContentAssignment` — qui est partagé par les programmes et
 * les documents et ne doit rien connaître de la nutrition.
 *
 * La garde ne s'applique qu'au type `nutrition` et qu'à une ATTRIBUTION :
 * un retrait passe toujours. Le refus intervient AVANT tout appel à
 * `setNutritionAssignment`, donc sans jamais désassigner le plan précédent.
 *
 * ELLE N'EST PAS L'AUTORITÉ. Depuis fix/nutrition-single-assigned-plan, la
 * validation qui fait foi est celle de la RPC `assign_nutrition_plan`, qui
 * revalide dans la transaction. Cette garde existe pour donner un message
 * PRÉCIS à l'écran avant l'aller-retour réseau ; si la base refuse malgré
 * tout (édition concurrente), le refus est affiché ici aussi.
 *
 * `versionsById` évite une requête quand la version est déjà connue
 * (la liste des plans la porte).
 */
export function useGuardedNutritionAssignment(
  base: SetAssignmentFn,
  versionsById: Readonly<Record<string, number | undefined>> = {},
): { setAssignment: SetAssignmentFn; refusal: string | null; clearRefusal: () => void } {
  const [refusal, setRefusal] = useState<string | null>(null);

  const setAssignment = useCallback<SetAssignmentFn>(
    async (studentId, contentType, contentId, assigned) => {
      if (contentType !== "nutrition") {
        return base(studentId, contentType, contentId, assigned);
      }
      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const decision = await guardNutritionAssignment(
          supabase,
          contentId,
          assigned,
          versionsById[contentId],
        );
        if (!decision.allowed) {
          setRefusal(decision.message);
          return false;
        }
      }
      setRefusal(null);
      const écrit = await base(studentId, contentType, contentId, assigned);
      if (!écrit) {
        // La pré-validation avait autorisé, mais la RPC a refusé : le plan a
        // changé entre-temps (édition concurrente, suppression). La base est
        // l'autorité — on le dit plutôt que d'afficher un faux succès.
        setRefusal(ASSIGN_REFUSED_BY_DATABASE_FR);
      }
      return écrit;
    },
    [base, versionsById],
  );

  return { setAssignment, refusal, clearRefusal: () => setRefusal(null) };
}
