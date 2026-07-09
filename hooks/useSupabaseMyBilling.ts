"use client";

import { useCallback, useEffect, useState } from "react";

import { getStudentBillingSummary } from "@/lib/supabase/billing";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import type { StudentBillingSummary } from "@/types";

export interface SupabaseMyBillingState {
  ready: boolean;
  active: boolean;
  studentId: string | null;
  summary: StudentBillingSummary | null;
  refetch: () => Promise<void>;
  /** Renvoie l'URL Stripe Checkout à ouvrir, ou `null` en cas d'échec (voir `error`). */
  startCheckout: (planKey: string) => Promise<{ url: string | null; error: string | null }>;
  openPortal: () => Promise<{ url: string | null; error: string | null }>;
}

/**
 * Statut billing de l'élève connecté, pour /profil (chantier
 * "supabase-stripe-payments-subscriptions"). Lecture directe via le client
 * navigateur (RLS `*_select_own_student`) — jamais de mock, jamais les
 * données d'un autre élève. `active` ne vaut `true` que si un compte élève
 * Supabase est réellement identifié.
 */
export function useSupabaseMyBilling(): SupabaseMyBillingState {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [summary, setSummary] = useState<StudentBillingSummary | null>(null);

  const refetch = useCallback(async () => {
    const supabase = createSupabaseBrowserClient();
    if (!supabase) {
      setReady(true);
      return;
    }
    const id = await getCurrentStudentId(supabase);
    if (!id) {
      setStudentId(null);
      setSummary(null);
      setReady(true);
      return;
    }
    const result = await getStudentBillingSummary(supabase, id);
    setStudentId(id);
    setSummary(result);
    setReady(true);
  }, []);

  // Chargement initial isolé de `refetch` (appelé plus bas), conformément à
  // la règle react-hooks/set-state-in-effect déjà appliquée partout ailleurs
  // dans ce repo.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createSupabaseBrowserClient();
      if (!supabase) {
        if (!cancelled) setReady(true);
        return;
      }
      const id = await getCurrentStudentId(supabase);
      if (!id) {
        if (!cancelled) {
          setStudentId(null);
          setSummary(null);
          setReady(true);
        }
        return;
      }
      const result = await getStudentBillingSummary(supabase, id);
      if (!cancelled) {
        setStudentId(id);
        setSummary(result);
        setReady(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const startCheckout = useCallback(
    async (planKey: string): Promise<{ url: string | null; error: string | null }> => {
      if (!studentId) return { url: null, error: "Compte élève non identifié." };
      try {
        const response = await fetch("/api/stripe/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, planKey }),
        });
        const data = await response.json();
        return response.ok ? { url: data.url as string, error: null } : { url: null, error: data.error ?? "Échec de la création du paiement." };
      } catch {
        return { url: null, error: "Échec de la création du paiement." };
      }
    },
    [studentId],
  );

  const openPortal = useCallback(async (): Promise<{ url: string | null; error: string | null }> => {
    if (!studentId) return { url: null, error: "Compte élève non identifié." };
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

  return { ready, active: studentId !== null, studentId, summary, refetch, startCheckout, openPortal };
}
