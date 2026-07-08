"use client";

import { useCallback } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { setProgramAssignment } from "@/lib/supabase/programs";
import type { AssignableContentType } from "@/types";

type SetAssignmentFn = (
  studentId: string,
  contentType: AssignableContentType,
  contentId: string,
  assigned: boolean,
) => void;

/**
 * Remplacement direct de useAdminData().setAssignment (même signature),
 * utilisé partout où la prop onSetAssignment est passée à AssignStudentsModal
 * / AssignContentToStudentModal. Quand `active` (programme ET élève tous les
 * deux réellement Supabase) et que le contenu est un programme, écrit dans la
 * table `assignments` réelle ; sinon retombe sur `fallback` (mock
 * localStorage), inchangé pour les plans nutrition/documents non encore
 * migrés ou les élèves/programmes mock.
 */
export function useProgramAssignment(
  active: boolean,
  fallback: SetAssignmentFn,
  onWritten?: () => void,
): SetAssignmentFn {
  return useCallback(
    (studentId, contentType, contentId, assigned) => {
      if (active && contentType === "programme") {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          void setProgramAssignment(supabase, studentId, contentId, assigned).then(() => {
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
