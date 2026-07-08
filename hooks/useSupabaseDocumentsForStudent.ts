"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getStudentDocumentsWithAvailability, type StudentDocumentWithAvailability } from "@/lib/supabase/documents";

/**
 * Documents accessibles (avec disponibilité calculée) pour un élève précis
 * dont l'id et la date de début sont déjà connus — utilisé côté admin
 * (/admin/eleves/[studentId], staff RLS = accès complet) contrairement à
 * hooks/useSupabaseStudentDocuments.ts qui résout l'élève connecté lui-même.
 */
export function useSupabaseDocumentsForStudent(studentId: string | null, startDate: string | null) {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<StudentDocumentWithAvailability[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase || !studentId || !startDate) {
      setDocuments([]);
      setLoading(false);
      return;
    }
    const list = await getStudentDocumentsWithAvailability(supabase, studentId, startDate);
    setDocuments(list);
    setLoading(false);
  }, [studentId, startDate]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase || !studentId || !startDate) {
        if (!cancelled) {
          setDocuments([]);
          setLoading(false);
        }
        return;
      }
      const list = await getStudentDocumentsWithAvailability(supabase, studentId, startDate);
      if (!cancelled) {
        setDocuments(list);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [studentId, startDate]);

  return { loading, documents, refetch };
}
