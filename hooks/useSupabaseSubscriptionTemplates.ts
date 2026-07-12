"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getActiveSubscriptionTemplates, getAllSubscriptionTemplates } from "@/lib/supabase/subscription-templates";
import type { SubscriptionTemplate } from "@/types";

export interface SupabaseSubscriptionTemplatesState {
  loading: boolean;
  templates: SubscriptionTemplate[];
  refetch: () => Promise<void>;
}

/**
 * Modèles d'abonnements (chantier "supabase-subscription-templates") —
 * `activeOnly` pour les sélecteurs élève/attribution (RLS
 * `subscription_templates_select_active_or_staff` laisse tout le monde lire
 * les formules actives), `false` pour `/admin/abonnements` (staff
 * uniquement, y compris les formules archivées).
 */
export function useSupabaseSubscriptionTemplates(activeOnly: boolean): SupabaseSubscriptionTemplatesState {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<SubscriptionTemplate[]>([]);

  async function load() {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setTemplates([]);
      setLoading(false);
      return;
    }
    const result = activeOnly ? await getActiveSubscriptionTemplates(supabase) : await getAllSubscriptionTemplates(supabase);
    setTemplates(result);
    setLoading(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }
      const result = activeOnly ? await getActiveSubscriptionTemplates(supabase) : await getAllSubscriptionTemplates(supabase);
      if (!cancelled) {
        setTemplates(result);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [activeOnly]);

  return { loading, templates, refetch: load };
}
