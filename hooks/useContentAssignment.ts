"use client";

import { useCallback } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { setDocumentAssignment } from "@/lib/supabase/documents";
import { setNutritionAssignment } from "@/lib/supabase/nutrition";
import { setProgramAssignment } from "@/lib/supabase/programs";
import type { AssignableContentType } from "@/types";

type SetAssignmentFn = (
  studentId: string,
  contentType: AssignableContentType,
  contentId: string,
  assigned: boolean,
) => void;

const WRITERS: Partial<Record<AssignableContentType, typeof setProgramAssignment>> = {
  programme: setProgramAssignment,
  nutrition: setNutritionAssignment,
  document: setDocumentAssignment,
};

/**
 * Remplacement direct de useAdminData().setAssignment (même signature),
 * utilisé partout où la prop onSetAssignment est passée à AssignStudentsModal
 * / AssignContentToStudentModal. `active` indique, par type de contenu, si
 * le contenu ET l'élève affichés sont tous les deux réellement Supabase —
 * dans ce cas écrit dans la vraie table dédiée (`assignments` pour les
 * programmes, `nutrition_plans.student_id` pour la nutrition,
 * `document_assignments` pour les documents) ; sinon retombe sur `fallback`
 * (mock localStorage).
 */
export function useContentAssignment(
  active: Partial<Record<AssignableContentType, boolean>>,
  fallback: SetAssignmentFn,
  onWritten?: () => void,
): SetAssignmentFn {
  return useCallback(
    (studentId, contentType, contentId, assigned) => {
      const write = WRITERS[contentType];
      if (active[contentType] && write) {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          void write(supabase, studentId, contentId, assigned).then(() => {
            onWritten?.();
          });
          return;
        }
      }
      fallback(studentId, contentType, contentId, assigned);
    },
    [active, fallback, onWritten],
  );
}
