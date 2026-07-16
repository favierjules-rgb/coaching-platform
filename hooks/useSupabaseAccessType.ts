"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentAccessType } from "@/lib/supabase/current-student";

/**
 * `access_type` du compte élève connecté (chantier module Programmation,
 * étape 6) — "coaching" (défaut, pendant le chargement et si Supabase n'est
 * pas configuré) ou "programme_seul". Utilisé par StudentSidebar pour
 * masquer les entrées de menu hors périmètre d'un compte programme_seul.
 */
export function useSupabaseAccessType(): "coaching" | "programme_seul" {
  const [accessType, setAccessType] = useState<"coaching" | "programme_seul">("coaching");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) return;
      const result = await getCurrentStudentAccessType(supabase);
      if (!cancelled) setAccessType(result);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return accessType;
}
