"use client";

import { useCallback, useEffect, useState } from "react";

import { getAdminBillingList, type AdminBillingListItem } from "@/lib/supabase/billing";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface SupabaseAdminBillingState {
  loading: boolean;
  items: AdminBillingListItem[];
  refetch: () => Promise<void>;
}

/** Liste billing complète (tous les élèves) pour /admin/billing (chantier "supabase-stripe-payments-subscriptions"). */
export function useSupabaseAdminBilling(): SupabaseAdminBillingState {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<AdminBillingListItem[]>([]);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setItems([]);
      setLoading(false);
      return;
    }
    const result = await getAdminBillingList(supabase);
    setItems(result);
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setItems([]);
          setLoading(false);
        }
        return;
      }
      const result = await getAdminBillingList(supabase);
      if (!cancelled) {
        setItems(result);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { loading, items, refetch };
}
