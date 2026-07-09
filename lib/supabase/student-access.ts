import type { SupabaseClient } from "@supabase/supabase-js";

import { computeStudentAccess } from "@/lib/stripe/access-status";
import { getSubscriptionForStudent } from "@/lib/supabase/billing";
import { getStudentProfile } from "@/lib/supabase/students";
import type { BillingAccessMode, StudentAccessReason, StudentAccessStatus } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Accès conditionnel aux pages élève (chantier "supabase-stripe-access-control") :
 * entraînement/nutrition/documents/progression nécessitent un abonnement
 * Stripe actif, sauf dérogation manuelle du coach. Le statut Stripe
 * (`subscriptions.status`) reste l'unique source de vérité — jamais
 * recalculé et stocké comme un simple booléen "actif" qui deviendrait
 * obsolète si Stripe change côté serveur : `getStudentAccessStatus`
 * recalcule à chaque appel à partir de la ligne `subscriptions` la plus
 * récente et du `billing_access_mode` courant. Le calcul pur lui-même
 * (`computeStudentAccess`) vit dans lib/stripe/access-status.ts (aucune
 * dépendance Supabase, réutilisé tel quel par lib/supabase/billing.ts pour
 * /admin/paiements sans import circulaire) et est ré-exporté ici pour les
 * appelants existants.
 *
 * Pas de `server-only` ici (contrairement à lib/supabase/guards.ts) :
 * `getStudentAccessStatus` prend un client déjà résolu en paramètre et est
 * utilisée aussi bien côté navigateur (hook élève, cadenas de menu) que
 * côté serveur (guard) — voir lib/supabase/guards.ts::requireActiveStudentAccess
 * pour la résolution serveur de l'élève connecté.
 */

export { computeStudentAccess };

type TypedSupabaseClient = SupabaseClient<Database>;

/** Lit `billing_access_mode` + l'abonnement le plus récent, puis calcule le statut d'accès. Utilisable côté navigateur (RLS) ou serveur. */
export async function getStudentAccessStatus(supabase: TypedSupabaseClient, studentId: string): Promise<StudentAccessStatus> {
  const [profile, subscription] = await Promise.all([
    getStudentProfile(supabase, studentId),
    getSubscriptionForStudent(supabase, studentId),
  ]);
  const accessMode = profile?.billingAccessMode ?? "subscription_required";
  return computeStudentAccess(accessMode, subscription?.status ?? null);
}

export interface UpdateStudentAccessInput {
  billingAccessMode: BillingAccessMode;
  /** Modèle attribué (chantier "supabase-subscription-templates") — source de vérité pour la formule ; `assigned_stripe_plan`/`assigned_stripe_price_id` sont recopiés depuis ce modèle pour compatibilité descendante (affichage), jamais l'inverse. */
  assignedSubscriptionTemplateId: string | null;
  accessNote: string;
}

/** Écriture admin (bloc "Accès au site" de la fiche élève) — RLS + trigger `protect_access_columns` n'autorisent que coach/admin. */
export async function updateStudentAccess(
  supabase: TypedSupabaseClient,
  studentId: string,
  input: UpdateStudentAccessInput,
): Promise<boolean> {
  let assignedStripePlan: string | null = null;
  let assignedStripePriceId: string | null = null;
  if (input.assignedSubscriptionTemplateId) {
    const { data: template } = await supabase
      .from("subscription_templates")
      .select("name, stripe_price_id")
      .eq("id", input.assignedSubscriptionTemplateId)
      .maybeSingle();
    assignedStripePlan = template?.name ?? null;
    assignedStripePriceId = template?.stripe_price_id ?? null;
  }

  const { error } = await supabase
    .from("student_profiles")
    .update({
      billing_access_mode: input.billingAccessMode,
      assigned_subscription_template_id: input.assignedSubscriptionTemplateId,
      assigned_stripe_plan: assignedStripePlan,
      assigned_stripe_price_id: assignedStripePriceId,
      access_note: input.accessNote,
      access_updated_at: new Date().toISOString(),
    })
    .eq("student_id", studentId);
  if (error) {
    console.error(`[Supabase] updateStudentAccess : ${error.message}`);
  }
  return !error;
}

export const accessModeLabels: Record<BillingAccessMode, string> = {
  subscription_required: "Automatique selon abonnement",
  manual_allowed: "Autoriser sans paiement",
  manual_blocked: "Bloquer manuellement",
};

export const accessReasonLabels: Record<StudentAccessReason, string> = {
  manual_allowed: "Accès manuel autorisé",
  manual_blocked: "Accès manuel bloqué",
  subscription_active: "Abonnement actif",
  no_subscription: "Aucun abonnement",
  subscription_incomplete: "Abonnement incomplet",
  subscription_incomplete_expired: "Abonnement incomplet expiré",
  subscription_past_due: "Paiement en retard",
  subscription_canceled: "Abonnement annulé",
  subscription_unpaid: "Abonnement impayé",
  subscription_paused: "Abonnement en pause",
};
