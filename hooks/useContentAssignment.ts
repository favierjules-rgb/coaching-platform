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
  /**
   * Date de début du programme (YYYY-MM-DD), PROGRAMMES UNIQUEMENT.
   *
   * ⚠️ OPTIONNELLE, ET IGNORÉE POUR NUTRITION ET DOCUMENTS — leurs écrivains
   * gardent leur signature à 4 arguments, et le 5ᵉ ne leur est jamais passé.
   * C'est ce qui permet d'ajouter une date aux programmes sans toucher d'un
   * pixel les deux autres parcours d'affectation.
   */
  programStartDate?: string | null,
) => Promise<boolean>;

/**
 * ⚠️ TYPE ÉLARGI AU SEUL ÉCRIVAIN QUI EN A BESOIN. `setProgramAssignment`
 * accepte 5 arguments, les deux autres 4 : TypeScript accepte qu'une fonction
 * à 4 paramètres soit appelée avec 5 (l'extra est ignoré), donc un seul type
 * couvre les trois sans faire semblant que nutrition comprend une date.
 */
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
  options?: {
    /**
     * false = ne JAMAIS envoyer l'email « contenu assigné » depuis ce point
     * d'entrée (fix/student-profile-content-assignment : la modale de la
     * fiche élève ne doit déclencher aucun email). Défaut true — la modale
     * « Assigner » de /admin/programmes conserve son comportement.
     */
    notifyByEmail?: boolean;
  },
): AwaitableSetAssignmentFn {
  const notifyByEmail = options?.notifyByEmail ?? true;
  return useCallback(
    (studentId, contentType, contentId, assigned, programStartDate) => {
      const write = WRITERS[contentType];
      if (active[contentType] && write) {
        const supabase = createSupabaseBrowserClient();
        if (supabase) {
          // La PROMESSE est rendue à l'appelant : la modale attend la fin
          // réelle de l'écriture et reçoit son résultat (fix/program-
          // assignment-checkbox — plus jamais de faux succès fire-and-forget).
          // ⚠️ LE 5ᵉ ARGUMENT NE PART QUE POUR UN PROGRAMME. Le passer à
          // `setNutritionAssignment` serait sans effet, mais mentirait sur
          // l'intention : nutrition et documents n'ont pas de date de début.
          return write(
            supabase,
            studentId,
            contentId,
            assigned,
            contentType === "programme" ? programStartDate : undefined,
          ).then((ok) => {
            onWritten?.();
            // Email envoyé uniquement lors d'une vraie nouvelle attribution
            // (jamais au retrait, "assigned" ci-dessus) — best-effort, ne
            // bloque jamais l'action d'attribution elle-même.
            if (ok && assigned && notifyByEmail) {
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
    [active, fallback, onWritten, notifyByEmail],
  );
}
