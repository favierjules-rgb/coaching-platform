"use client";

import { useCallback, useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getStudentAccessStatus } from "@/lib/supabase/student-access";
import { getStudentProfile } from "@/lib/supabase/students";
import type { StudentAccessStatus } from "@/types";

export interface SupabaseMyAccessState {
  ready: boolean;
  active: boolean;
  studentId: string | null;
  status: StudentAccessStatus | null;
  /** Formule attribuée par le coach (clé lib/stripe/plans.ts, repli .env), pour proposer un paiement direct sans repasser par le sélecteur. */
  assignedPlan: string | null;
  /** Modèle attribué (chantier "supabase-subscription-templates") — source prioritaire sur `assignedPlan`. */
  assignedTemplateId: string | null;
  startCheckout: (planKey: string) => Promise<{ url: string | null; error: string | null }>;
  startCheckoutForTemplate: (templateId: string) => Promise<{ url: string | null; error: string | null }>;
}

/**
 * Statut d'accès conditionnel de l'élève connecté (chantier
 * "supabase-stripe-access-control"), pour /acces-limite et la mention
 * d'accès de /profil. Résolution de l'élève identique à
 * useSupabaseMyBilling (RLS, jamais un id passé en paramètre).
 */
export function useSupabaseMyAccess(): SupabaseMyAccessState {
  const [ready, setReady] = useState(false);
  const [studentId, setStudentId] = useState<string | null>(null);
  const [status, setStatus] = useState<StudentAccessStatus | null>(null);
  const [assignedPlan, setAssignedPlan] = useState<string | null>(null);
  const [assignedTemplateId, setAssignedTemplateId] = useState<string | null>(null);

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
        if (!cancelled) setReady(true);
        return;
      }
      const [accessStatus, profile] = await Promise.all([
        getStudentAccessStatus(supabase, id),
        getStudentProfile(supabase, id),
      ]);
      if (!cancelled) {
        setStudentId(id);
        setStatus(accessStatus);
        setAssignedPlan(profile?.assignedStripePlan ?? null);
        setAssignedTemplateId(profile?.assignedSubscriptionTemplateId ?? null);
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
        return response.ok
          ? { url: data.url as string, error: null }
          : { url: null, error: data.error ?? "Échec de la création du paiement." };
      } catch {
        return { url: null, error: "Échec de la création du paiement." };
      }
    },
    [studentId],
  );

  const startCheckoutForTemplate = useCallback(
    async (templateId: string): Promise<{ url: string | null; error: string | null }> => {
      if (!studentId) return { url: null, error: "Compte élève non identifié." };
      try {
        const response = await fetch("/api/stripe/create-checkout-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId, templateId }),
        });
        const data = await response.json();
        return response.ok
          ? { url: data.url as string, error: null }
          : { url: null, error: data.error ?? "Échec de la création du paiement." };
      } catch {
        return { url: null, error: "Échec de la création du paiement." };
      }
    },
    [studentId],
  );

  return { ready, active: studentId !== null, studentId, status, assignedPlan, assignedTemplateId, startCheckout, startCheckoutForTemplate };
}
