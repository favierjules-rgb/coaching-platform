"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getDocumentViewStats, getDocuments, type DocumentViewStats } from "@/lib/supabase/documents";
import type { AdminDocument } from "@/types";

/**
 * Liste des documents Supabase pour /admin/documents — même principe que
 * useSupabaseNutritionPlans : `loading` reste vrai le temps de la requête
 * initiale, `documents` est un tableau vide tant que Supabase n'est pas
 * configuré ou en cas d'erreur. `refetch` rafraîchit après création/édition/
 * assignation.
 */
export function useSupabaseDocuments() {
  const [loading, setLoading] = useState(true);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  /**
   * CONSULTATIONS RÉELLES, PAR DOCUMENT (A).
   *
   * ⚠️ `assignedCount` et `viewedCount` sont DEUX NOMBRES DISTINCTS. La page
   * affichait « Élèves ayant accès » = `assignedStudentIds.length`, un compte
   * d'ASSIGNATIONS, là où le coach cherche une LECTURE. Les deux coexistent
   * désormais, nommés séparément.
   *
   * Une seule requête pour toute la liste (`.in()`), jamais une par document.
   */
  const [viewStats, setViewStats] = useState<Map<string, DocumentViewStats>>(new Map());

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setDocuments([]);
      setViewStats(new Map());
      setLoading(false);
      return;
    }
    const list = await getDocuments(supabase);
    setDocuments(list);
    setViewStats(await getDocumentViewStats(supabase, list.map((d) => d.id)));
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setDocuments([]);
          setViewStats(new Map());
          setLoading(false);
        }
        return;
      }
      const list = await getDocuments(supabase);
      const stats = await getDocumentViewStats(supabase, list.map((d) => d.id));
      if (!cancelled) {
        setDocuments(list);
        setViewStats(stats);
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, documents, viewStats, refetch };
}
