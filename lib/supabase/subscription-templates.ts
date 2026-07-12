import type { SupabaseClient } from "@supabase/supabase-js";

import type { BillingInterval, SubscriptionTemplate } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès Supabase pour les modèles d'abonnements (chantier
 * "supabase-subscription-templates") : formules gérées depuis l'admin
 * (table `subscription_templates`) au lieu d'un mapping figé par variables
 * d'environnement. Lecture : élève (formules actives) et staff (toutes,
 * actives ou archivées). Écriture : réservée aux routes API
 * `/api/admin/subscription-templates/*`, via le client Supabase de la
 * session du coach connecté (RLS `subscription_templates_manage_staff`) —
 * jamais le client service role pour cette table.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type SubscriptionTemplateRow = Database["public"]["Tables"]["subscription_templates"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function mapSubscriptionTemplateRow(row: SubscriptionTemplateRow): SubscriptionTemplate {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    amountCents: row.amount_cents,
    currency: row.currency,
    billingInterval: row.billing_interval as BillingInterval,
    durationMonths: row.duration_months,
    stripeProductId: row.stripe_product_id,
    stripePriceId: row.stripe_price_id,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

/* ─── Lecture ─── */

/** Formules actives uniquement — sélecteur élève/admin (paiement, attribution). */
export async function getActiveSubscriptionTemplates(supabase: TypedSupabaseClient): Promise<SubscriptionTemplate[]> {
  const { data, error } = await supabase
    .from("subscription_templates")
    .select("*")
    .eq("is_active", true)
    .order("amount_cents", { ascending: true });
  devWarn("getActiveSubscriptionTemplates", error);
  return (data ?? []).map(mapSubscriptionTemplateRow);
}

/** Toutes les formules (actives + archivées) — réservé à `/admin/abonnements` (staff uniquement, RLS). */
export async function getAllSubscriptionTemplates(supabase: TypedSupabaseClient): Promise<SubscriptionTemplate[]> {
  const { data, error } = await supabase.from("subscription_templates").select("*").order("created_at", { ascending: false });
  devWarn("getAllSubscriptionTemplates", error);
  return (data ?? []).map(mapSubscriptionTemplateRow);
}

export async function getSubscriptionTemplateById(supabase: TypedSupabaseClient, id: string): Promise<SubscriptionTemplate | null> {
  const { data, error } = await supabase.from("subscription_templates").select("*").eq("id", id).maybeSingle();
  devWarn("getSubscriptionTemplateById", error);
  return data ? mapSubscriptionTemplateRow(data) : null;
}

export async function getSubscriptionTemplateByPriceId(
  supabase: TypedSupabaseClient,
  stripePriceId: string,
): Promise<SubscriptionTemplate | null> {
  const { data, error } = await supabase.from("subscription_templates").select("*").eq("stripe_price_id", stripePriceId).maybeSingle();
  devWarn("getSubscriptionTemplateByPriceId", error);
  return data ? mapSubscriptionTemplateRow(data) : null;
}

/* ─── Écriture (routes API /api/admin/subscription-templates uniquement) ─── */

export interface CreateSubscriptionTemplateInput {
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  billingInterval: BillingInterval;
  durationMonths: number | null;
  stripeProductId: string | null;
  stripePriceId: string | null;
  createdBy: string | null;
}

export async function createSubscriptionTemplate(
  supabase: TypedSupabaseClient,
  input: CreateSubscriptionTemplateInput,
): Promise<SubscriptionTemplate | null> {
  const { data, error } = await supabase
    .from("subscription_templates")
    .insert({
      name: input.name,
      description: input.description,
      amount_cents: input.amountCents,
      currency: input.currency,
      billing_interval: input.billingInterval,
      duration_months: input.durationMonths,
      stripe_product_id: input.stripeProductId,
      stripe_price_id: input.stripePriceId,
      created_by: input.createdBy,
    })
    .select("*")
    .single();
  devWarn("createSubscriptionTemplate", error);
  return data ? mapSubscriptionTemplateRow(data) : null;
}

export interface UpdateSubscriptionTemplateInput {
  name?: string;
  description?: string;
  durationMonths?: number | null;
  /** Changement de prix : nouveau Price Stripe (l'ancien est désactivé côté Stripe, jamais réutilisé). */
  amountCents?: number;
  stripePriceId?: string | null;
  stripeProductId?: string | null;
  isActive?: boolean;
}

export async function updateSubscriptionTemplate(
  supabase: TypedSupabaseClient,
  id: string,
  input: UpdateSubscriptionTemplateInput,
): Promise<SubscriptionTemplate | null> {
  const payload: Database["public"]["Tables"]["subscription_templates"]["Update"] = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.durationMonths !== undefined) payload.duration_months = input.durationMonths;
  if (input.amountCents !== undefined) payload.amount_cents = input.amountCents;
  if (input.stripePriceId !== undefined) payload.stripe_price_id = input.stripePriceId;
  if (input.stripeProductId !== undefined) payload.stripe_product_id = input.stripeProductId;
  if (input.isActive !== undefined) payload.is_active = input.isActive;

  const { data, error } = await supabase.from("subscription_templates").update(payload).eq("id", id).select("*").single();
  devWarn("updateSubscriptionTemplate", error);
  return data ? mapSubscriptionTemplateRow(data) : null;
}

/** Archive (ne supprime jamais une formule déjà utilisée par des abonnements/paiements historiques). */
export async function archiveSubscriptionTemplate(supabase: TypedSupabaseClient, id: string): Promise<SubscriptionTemplate | null> {
  return updateSubscriptionTemplate(supabase, id, { isActive: false });
}
