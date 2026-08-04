"use client";

import { useCallback, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { guardNutritionAssignment } from "@/lib/supabase/nutrition-assignment-guard";
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
      return base(studentId, contentType, contentId, assigned);
    },
    [base, versionsById],
  );

  return { setAssignment, refusal, clearRefusal: () => setRefusal(null) };
}
