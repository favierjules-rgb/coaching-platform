"use client";

import { useCallback, useEffect, useState } from "react";

import { getStudentBillingSummary } from "@/lib/supabase/billing";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import type { StudentBillingSummary } from "@/types";

export interface SupabaseStudentBillingState {
  loading: boolean;
  summary: StudentBillingSummary | null;
  refetch: () => Promise<void>;
  createCheckoutLink: (planKey: string) => Promise<{ url: string | null; error: string | null }>;
  /** Chantier "supabase-subscription-templates" — source prioritaire, `createCheckoutLink` (planKey/.env) reste un repli temporaire. */
  createCheckoutLinkForTemplate: (templateId: string) => Promise<{ url: string | null; error: string | null }>;
  openPortal: () => Promise<{ url: string | null; error: string | null }>;
}

/**
 * Statut billing d'un élève précis, pour la fiche
 * /admin/eleves/[studentId] (chantier "supabase-stripe-payments-subscriptions").
 * Le coach peut créer un lien de paiement ou ouvrir le portail pour
 * n'importe quel élève (RLS staff `for all` sur les 3 tables billing).
 */
export function useSupabaseStudentBilling(studentId: string | undefined): SupabaseStudentBillingState {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<StudentBillingSummary | null>(null);

  const refetch = useCallback(async () => {
    if (!studentId) {
      setSummary(null);
      setLoading(false);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setSummary(null);
      setLoading(false);
      return;
    }
    const result = await getStudentBillingSummary(supabase, studentId);
    setSummary(result);
    setLoading(false);
  }, [studentId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      if (!studentId) {
        if (!cancelled) {
          setSummary(null);
          setLoading(false);
        }
        return;
      }
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) {
          setSummary(null);
          setLoading(false);
        }
        return;
      }
      const result = await getStudentBillingSummary(supabase, studentId);
      if (!cancelled) {
        setSummary(result);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [studentId]);

  const createCheckoutLink = useCallback(
    async (planKey: string): Promise<{ url: string | null; error: string | null }> => {
      if (!studentId) return { url: null, error: "Élève non identifié." };
      try {
        const response = await fetch("/api/stripe/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, planKey }),
        });
        const data = await response.json();
        return response.ok ? { url: data.url as string, error: null } : { url: null, error: data.error ?? "Échec de la création du lien." };
      } catch {
        return { url: null, error: "Échec de la création du lien." };
      }
    },
    [studentId],
  );

  const createCheckoutLinkForTemplate = useCallback(
    async (templateId: string): Promise<{ url: string | null; error: string | null }> => {
      if (!studentId) return { url: null, error: "Élève non identifié." };
      try {
        const response = await fetch("/api/stripe/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, templateId }),
        });
        const data = await response.json();
        return response.ok ? { url: data.url as string, error: null } : { url: null, error: data.error ?? "Échec de la création du lien." };
      } catch {
        return { url: null, error: "Échec de la création du lien." };
      }
    },
    [studentId],
  );

  const openPortal = useCallback(async (): Promise<{ url: string | null; error: string | null }> => {
    if (!studentId) return { url: null, error: "Élève non identifié." };
    try {
      const response = await fetch("/api/stripe/create-customer-portal-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const data = await response.json();
      return response.ok ? { url: data.url as string, error: null } : { url: null, error: data.error ?? "Échec de l'ouverture du portail." };
    } catch {
      return { url: null, error: "Échec de l'ouverture du portail." };
    }
  }, [studentId]);

  return { loading, summary, refetch, createCheckoutLink, createCheckoutLinkForTemplate, openPortal };
}
