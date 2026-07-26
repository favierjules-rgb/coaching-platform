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

/**
 * Supprime définitivement la ligne `subscription_templates` (ménage des
 * formules obsolètes/de test depuis /admin/abonnements, staff uniquement via
 * RLS). Sûr côté intégrité : la FK `student_profiles.assigned_subscription_
 * template_id` est `on delete set null` (un élève éventuellement attribué est
 * simplement détaché, jamais cassé), et les abonnements/paiements Stripe
 * historiques portent leur propre `price_id` sans FK vers cette table — ils ne
 * sont pas affectés. Renvoie `true` si la suppression a réussi.
 */
export async function deleteSubscriptionTemplate(supabase: TypedSupabaseClient, id: string): Promise<boolean> {
  const { error } = await supabase.from("subscription_templates").delete().eq("id", id);
  devWarn("deleteSubscriptionTemplate", error);
  return !error;
}

/**
 * Références métier d'un modèle — sert (1) de garde-fou avant toute
 * suppression définitive et (2) à alimenter la confirmation UI. Détail du
 * modèle référentiel (voir supabase/schema.sql) :
 *  - `student_profiles.assigned_subscription_template_id` (FK) ET
 *    `student_profiles.assigned_stripe_price_id` (colonne texte recopiée du
 *    modèle, NON nettoyée par la FK `on delete set null`) → deux vecteurs
 *    d'attribution à contrôler ;
 *  - `subscriptions.stripe_price_id` (texte, pas de FK) → abonnements locaux
 *    (actifs ou historiques) facturés sur ce prix ;
 *  - `subscription_templates.stripe_product_id` partagé par un AUTRE modèle
 *    (le Product Stripe n'est pas unique ; le Price l'est) → décide si le
 *    Product peut être archivé.
 * `stripe_payments` n'a aucune colonne prix/produit/modèle : ses lignes
 * pendent d'un `stripe_subscription_id` et sont donc couvertes indirectement
 * par le compte des abonnements (aucune dépendance directe au modèle).
 */
export interface SubscriptionTemplateReferences {
  studentsByTemplateId: number;
  studentsByPriceId: number;
  subscriptions: number;
  /**
   * Paiements Stripe rattachés à un abonnement portant le price_id du modèle.
   * `stripe_payments` n'a AUCUNE FK vers `subscriptions` et AUCUNE colonne
   * prix/produit/modèle (seul `student_id` est une FK) : un paiement peut donc
   * survivre à la suppression d'une ligne `subscriptions`. Le seul rattachement
   * possible est `stripe_payments.stripe_subscription_id` =
   * `subscriptions.stripe_subscription_id` — un paiement dont l'abonnement a
   * déjà été supprimé n'est rattachable à aucun modèle (aucune référence, donc
   * rien à casser), mais tout paiement encore rattachable est bloquant.
   */
  payments: number;
  otherTemplatesSharingProduct: number;
}

/** Passe le modèle actif/archivé en base (utilisé par l'archivage, la réactivation et la désactivation préalable à la suppression). Idempotent. */
export async function setSubscriptionTemplateActive(
  supabase: TypedSupabaseClient,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  const { error } = await supabase.from("subscription_templates").update({ is_active: isActive }).eq("id", id);
  devWarn("setSubscriptionTemplateActive", error);
  return !error;
}

export type DeleteUnusedTemplateRpcResult =
  | { result: "deleted" }
  | { result: "not_found" }
  | { result: "in_use"; references?: Record<string, number> };

/**
 * Suppression TRANSACTIONNELLE via la RPC `delete_unused_subscription_template`
 * (migration 20260724214500) : verrou de la ligne + revérification de toutes
 * les références + DELETE dans une seule transaction — supprime la fenêtre de
 * course entre le contrôle applicatif et la suppression.
 */
export async function deleteUnusedSubscriptionTemplateRpc(
  supabase: TypedSupabaseClient,
  id: string,
): Promise<DeleteUnusedTemplateRpcResult | { result: "error"; message: string }> {
  // @ts-expect-error — RPC ajoutée par migration, pas encore dans les types générés.
  const { data, error } = await supabase.rpc("delete_unused_subscription_template", { p_template_id: id });
  if (error) {
    devWarn("deleteUnusedSubscriptionTemplateRpc", error);
    return { result: "error", message: error.message };
  }
  return data as DeleteUnusedTemplateRpcResult;
}

export async function getSubscriptionTemplateReferences(
  supabase: TypedSupabaseClient,
  template: SubscriptionTemplate,
): Promise<SubscriptionTemplateReferences> {
  const priceId = template.stripePriceId;
  const productId = template.stripeProductId;

  // head + count exact : on ne ramène jamais les lignes, seulement le compte.
  const byTemplate = await supabase
    .from("student_profiles")
    .select("student_id", { count: "exact", head: true })
    .eq("assigned_subscription_template_id", template.id);
  devWarn("references.studentsByTemplateId", byTemplate.error);

  const byPrice = priceId
    ? await supabase
        .from("student_profiles")
        .select("student_id", { count: "exact", head: true })
        .eq("assigned_stripe_price_id", priceId)
    : null;
  if (byPrice) devWarn("references.studentsByPriceId", byPrice.error);

  const subs = priceId
    ? await supabase.from("subscriptions").select("id", { count: "exact", head: true }).eq("stripe_price_id", priceId)
    : null;
  if (subs) devWarn("references.subscriptions", subs.error);

  // Paiements : aucun lien direct au modèle (stripe_payments n'a ni FK vers
  // subscriptions ni colonne prix/produit) — on passe donc par les
  // stripe_subscription_id des abonnements portant ce price_id.
  let payments = 0;
  if (priceId) {
    const subIdsResult = await supabase.from("subscriptions").select("stripe_subscription_id").eq("stripe_price_id", priceId);
    devWarn("references.payments (subscription ids)", subIdsResult.error);
    const subIds = (subIdsResult.data ?? [])
      .map((row) => row.stripe_subscription_id)
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (subIds.length > 0) {
      const paymentsResult = await supabase
        .from("stripe_payments")
        .select("id", { count: "exact", head: true })
        .in("stripe_subscription_id", subIds);
      devWarn("references.payments", paymentsResult.error);
      payments = paymentsResult.count ?? 0;
    }
  }

  const sharedProduct = productId
    ? await supabase
        .from("subscription_templates")
        .select("id", { count: "exact", head: true })
        .eq("stripe_product_id", productId)
        .neq("id", template.id)
    : null;
  if (sharedProduct) devWarn("references.otherTemplatesSharingProduct", sharedProduct.error);

  return {
    studentsByTemplateId: byTemplate.count ?? 0,
    studentsByPriceId: byPrice?.count ?? 0,
    subscriptions: subs?.count ?? 0,
    payments,
    otherTemplatesSharingProduct: sharedProduct?.count ?? 0,
  };
}

/**
 * Éligible à la suppression définitive uniquement si AUCUN élève (par
 * template_id OU par price_id), AUCUN abonnement local et AUCUN paiement
 * rattachable ne dépend du modèle. Le partage de Product n'est PAS bloquant
 * (il change seulement le sort du Product côté Stripe).
 * Ce contrôle applicatif sert l'UI et le pré-filtrage ; la garantie finale
 * (anti-course) est la RPC transactionnelle.
 */
export function isTemplateDeletable(references: SubscriptionTemplateReferences): boolean {
  return (
    references.studentsByTemplateId === 0 &&
    references.studentsByPriceId === 0 &&
    references.subscriptions === 0 &&
    references.payments === 0
  );
}
