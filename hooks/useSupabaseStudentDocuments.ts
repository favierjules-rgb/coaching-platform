"use client";

import { useEffect, useState } from "react";

import { getCurrentStudentProfile } from "@/lib/supabase/current-student";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getStudentDocumentsWithAvailability, type StudentDocumentWithAvailability } from "@/lib/supabase/documents";

/**
 * Documents réellement accessibles à l'élève connecté, pour /documents —
 * même principe que useSupabaseNutritionForStudent : `ready` passe à `true`
 * une fois la vérification terminée, `active` ne vaut `true` que si un
 * compte élève Supabase est réellement identifié (sinon repli mock/
 * localStorage, voir data/student.ts). `documents` reste un tableau vide
 * tant qu'aucun document réel n'est accessible ("Aucun document
 * disponible"), même si `active` est vrai.
 */
export function useSupabaseStudentDocuments() {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [documents, setDocuments] = useState<StudentDocumentWithAvailability[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const student = await getCurrentStudentProfile(supabase);
      if (!student) {
        if (!cancelled) setReady(true);
        return;
      }
      const list = await getStudentDocumentsWithAvailability(supabase, student.id, student.startDate);
      if (!cancelled) {
        setStudentId(student.id);
        setDocuments(list);
        setReady(true);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { ready, active: ready && studentId !== null, studentId, documents };
}
