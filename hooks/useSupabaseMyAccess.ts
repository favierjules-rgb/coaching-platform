"use client";

import { useEffect, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { getCurrentStudentId } from "@/lib/supabase/current-student";
import { getStudentAccessStatus } from "@/lib/supabase/student-access";
import { getSubscriptionTemplateById } from "@/lib/supabase/subscription-templates";
import { getStudentProfile } from "@/lib/supabase/students";
import type { StudentAccessStatus, SubscriptionTemplate } from "@/types";

export interface SupabaseMyAccessState {
  ready: boolean;
  active: boolean;
  studentId: string | null;
  status: StudentAccessStatus | null;
  /**
   * Modèle attribué par le coach (chantier "supabase-subscription-templates")
   * — unique source de la formule côté élève. `null` si aucun modèle n'a
   * encore été attribué : dans ce cas, ne jamais proposer de paiement ni de
   * sélecteur de formule (l'élève ne choisit jamais librement).
   */
  assignedTemplate: SubscriptionTemplate | null;
  /**
   * Crée une session Stripe Checkout pour le modèle attribué. N'envoie
   * volontairement aucun `templateId`/`planKey` : le serveur
   * (`/api/stripe/create-checkout-session`) résout systématiquement
   * `student_profiles.assigned_subscription_template_id` lui-même pour un
   * appelant élève — impossible de payer une autre formule que celle
   * attribuée, même en modifiant la requête depuis le navigateur.
   */
  payAssignedTemplate: () => Promise<{ url: string | null; error: string | null }>;
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
  const [assignedTemplate, setAssignedTemplate] = useState<SubscriptionTemplate | null>(null);

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
      const template = profile?.assignedSubscriptionTemplateId
        ? await getSubscriptionTemplateById(supabase, profile.assignedSubscriptionTemplateId)
        : null;
      if (!cancelled) {
        setStudentId(id);
        setStatus(accessStatus);
        setAssignedTemplate(template);
        setReady(true);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function payAssignedTemplate(): Promise<{ url: string | null; error: string | null }> {
    if (!studentId) return { url: null, error: "Compte élève non identifié." };
    try {
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId }),
      });
      const data = await response.json();
      return response.ok
        ? { url: data.url as string, error: null }
        : { url: null, error: data.error ?? "Échec de la création du paiement." };
    } catch {
      return { url: null, error: "Échec de la création du paiement." };
    }
  }

  return { ready, active: studentId !== null, studentId, status, assignedTemplate, payAssignedTemplate };
}
