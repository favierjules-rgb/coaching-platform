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

/**
 * Écriture AWAITABLE (fix/program-assignment-checkbox) : la modale doit
 * attendre la fin réelle des écritures avant d'afficher le succès — le
 * booléen résolu remonte l'échec (ex. RPC refusée) au lieu de le perdre.
 */
type AwaitableSetAssignmentFn = (
  studentId: string,
  contentType: AssignableContentType,
  contentId: string,
  assigned: boolean,
) => Promise<boolean>;

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
): AwaitableSetAssignmentFn {
  return useCallback(
    (studentId, contentType, contentId, assigned) => {
      const write = WRITERS[contentType];
      if (active[contentType] && write) {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          // La PROMESSE est rendue à l'appelant : la modale attend la fin
          // réelle de l'écriture et reçoit son résultat (fix/program-
          // assignment-checkbox — plus jamais de faux succès fire-and-forget).
          return write(supabase, studentId, contentId, assigned).then((ok) => {
            onWritten?.();
            // Email envoyé uniquement lors d'une vraie nouvelle attribution
            // (jamais au retrait, "assigned" ci-dessus) — best-effort, ne
            // bloque jamais l'action d'attribution elle-même.
            if (ok && assigned) {
              fetch("/api/email/content-assigned", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ studentId, contentType, contentId }),
              }).catch(() => {});
            }
            return ok;
          });
        }
      }
      fallback(studentId, contentType, contentId, assigned);
      return Promise.resolve(true);
    },
    [active, fallback, onWritten],
  );
}
