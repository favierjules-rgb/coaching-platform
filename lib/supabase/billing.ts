import type { SupabaseClient } from "@supabase/supabase-js";

import { computeStudentAccess } from "@/lib/stripe/access-status";
import { toStudentBillingStatus } from "@/lib/stripe/status";
import { getStudents } from "@/lib/supabase/students";
import type { BillingAccessMode, BillingCustomer, StripePayment, StudentAccessStatus, Subscription, StudentBillingSummary } from "@/types";
import type { Database } from "@/types/supabase";

/**
 * Couche d'accès Supabase pour les paiements/abonnements Stripe (chantier
 * "supabase-stripe-payments-subscriptions"). Lecture : utilisable aussi bien
 * côté navigateur (élève, RLS `*_select_own_student`) que côté serveur.
 * Écriture (upsert / record) : réservée aux routes API `/api/stripe/`, avec
 * le client service role (contourne RLS, voir lib/supabase/admin.ts) — le
 * statut d'abonnement ne doit jamais être modifié autrement que par le
 * webhook Stripe.
 */

type TypedSupabaseClient = SupabaseClient<Database>;
type BillingCustomerRow = Database["public"]["Tables"]["billing_customers"]["Row"];
type SubscriptionRow = Database["public"]["Tables"]["subscriptions"]["Row"];
type StripePaymentRow = Database["public"]["Tables"]["stripe_payments"]["Row"];

function devWarn(context: string, error: { message: string; code?: string; details?: string; hint?: string } | null): void {
  if (error) {
    console.error(
      `[Supabase] ${context} : ${error.message}${error.code ? ` (code ${error.code})` : ""}${error.details ? ` — ${error.details}` : ""}${error.hint ? ` — ${error.hint}` : ""}`,
    );
  }
}

function mapBillingCustomerRow(row: BillingCustomerRow): BillingCustomer {
  return {
    id: row.id,
    studentId: row.student_id,
    stripeCustomerId: row.stripe_customer_id,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSubscriptionRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    studentId: row.student_id,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    stripePriceId: row.stripe_price_id,
    stripeProductId: row.stripe_product_id,
    planName: row.plan_name,
    status: row.status,
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    cancelledAt: row.cancelled_at,
    amountCents: row.amount_cents,
    currency: row.currency,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStripePaymentRow(row: StripePaymentRow): StripePayment {
  return {
    id: row.id,
    studentId: row.student_id,
    stripeCustomerId: row.stripe_customer_id,
    stripePaymentIntentId: row.stripe_payment_intent_id,
    stripeInvoiceId: row.stripe_invoice_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    amountCents: row.amount_cents,
    currency: row.currency,
    status: row.status,
    paidAt: row.paid_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ─── Lecture ─── */

export async function getBillingCustomerForStudent(supabase: TypedSupabaseClient, studentId: string): Promise<BillingCustomer | null> {
  const { data, error } = await supabase.from("billing_customers").select("*").eq("student_id", studentId).maybeSingle();
  devWarn("getBillingCustomerForStudent", error);
  return data ? mapBillingCustomerRow(data) : null;
}

/** Le plus récent abonnement Stripe de l'élève (normalement un seul actif à la fois, défensif si plusieurs lignes historiques). */
export async function getSubscriptionForStudent(supabase: TypedSupabaseClient, studentId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("student_id", studentId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  devWarn("getSubscriptionForStudent", error);
  return data ? mapSubscriptionRow(data) : null;
}

export async function getLastPaymentForStudent(supabase: TypedSupabaseClient, studentId: string): Promise<StripePayment | null> {
  const { data, error } = await supabase
    .from("stripe_payments")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  devWarn("getLastPaymentForStudent", error);
  return data ? mapStripePaymentRow(data) : null;
}

export async function getStudentBillingSummary(supabase: TypedSupabaseClient, studentId: string): Promise<StudentBillingSummary> {
  const [customer, subscription, lastPayment] = await Promise.all([
    getBillingCustomerForStudent(supabase, studentId),
    getSubscriptionForStudent(supabase, studentId),
    getLastPaymentForStudent(supabase, studentId),
  ]);
  return {
    studentId,
    customer,
    subscription,
    lastPayment,
    status: subscription ? toStudentBillingStatus(subscription.status) : "sans_abonnement",
  };
}

export interface AdminBillingListItem extends StudentBillingSummary {
  studentFirstName: string;
  studentLastName: string;
  studentEmail: string;
  /** Accès conditionnel au site (chantier "supabase-stripe-access-control"), calculé à partir de billing_access_mode + du statut Stripe. */
  access: StudentAccessStatus;
  assignedStripePlan: string | null;
}

/**
 * Vue admin complète (`/admin/paiements`) : un élève par ligne, avec son
 * résumé billing + son accès conditionnel. Composé côté application (4
 * lectures + jointure en mémoire) plutôt qu'une vue SQL — volume attendu
 * faible (une agence de coaching, pas des milliers d'élèves), cohérent
 * avec le reste du repo.
 */
export async function getAdminBillingList(supabase: TypedSupabaseClient): Promise<AdminBillingListItem[]> {
  const [
    students,
    { data: customerRows, error: customerError },
    { data: subscriptionRows, error: subscriptionError },
    { data: paymentRows, error: paymentError },
    { data: profileRows, error: profileError },
  ] = await Promise.all([
    getStudents(supabase),
    supabase.from("billing_customers").select("*"),
    supabase.from("subscriptions").select("*").order("updated_at", { ascending: false }),
    supabase.from("stripe_payments").select("*").order("created_at", { ascending: false }),
    supabase.from("student_profiles").select("student_id, billing_access_mode, assigned_stripe_plan"),
  ]);
  devWarn("getAdminBillingList (billing_customers)", customerError);
  devWarn("getAdminBillingList (subscriptions)", subscriptionError);
  devWarn("getAdminBillingList (stripe_payments)", paymentError);
  devWarn("getAdminBillingList (student_profiles)", profileError);

  const customersByStudent = new Map((customerRows ?? []).map((row) => [row.student_id, mapBillingCustomerRow(row)]));
  const subscriptionByStudent = new Map<string, Subscription>();
  for (const row of subscriptionRows ?? []) {
    if (!subscriptionByStudent.has(row.student_id)) {
      subscriptionByStudent.set(row.student_id, mapSubscriptionRow(row));
    }
  }
  const lastPaymentByStudent = new Map<string, StripePayment>();
  for (const row of paymentRows ?? []) {
    if (!lastPaymentByStudent.has(row.student_id)) {
      lastPaymentByStudent.set(row.student_id, mapStripePaymentRow(row));
    }
  }
  const accessModeByStudent = new Map<string, BillingAccessMode>(
    (profileRows ?? []).map((row) => [row.student_id, row.billing_access_mode as BillingAccessMode]),
  );
  const assignedPlanByStudent = new Map<string, string | null>((profileRows ?? []).map((row) => [row.student_id, row.assigned_stripe_plan]));

  return students.map((student) => {
    const subscription = subscriptionByStudent.get(student.id) ?? null;
    const accessMode = accessModeByStudent.get(student.id) ?? "subscription_required";
    return {
      studentId: student.id,
      studentFirstName: student.firstName,
      studentLastName: student.lastName,
      studentEmail: student.email,
      customer: customersByStudent.get(student.id) ?? null,
      subscription,
      lastPayment: lastPaymentByStudent.get(student.id) ?? null,
      status: subscription ? toStudentBillingStatus(subscription.status) : "sans_abonnement",
      access: computeStudentAccess(accessMode, subscription?.status ?? null),
      assignedStripePlan: assignedPlanByStudent.get(student.id) ?? null,
    };
  });
}

/* ─── Écriture (routes API uniquement, client service role) ─── */

/** `true` si déjà traité (idempotence webhook) ; insère la trace sinon. Une violation d'unicité pendant l'insertion (double traitement concurrent) est traitée comme "déjà traité", jamais comme une erreur. */
export async function recordBillingEventIfNew(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const { data: existing } = await supabase.from("billing_events").select("id").eq("stripe_event_id", stripeEventId).maybeSingle();
  if (existing) {
    return true;
  }
  const { error } = await supabase.from("billing_events").insert({ stripe_event_id: stripeEventId, event_type: eventType, payload });
  if (error && error.code !== "23505") {
    devWarn("recordBillingEventIfNew", error);
  }
  return false;
}

export interface UpsertBillingCustomerInput {
  studentId: string;
  stripeCustomerId: string;
  email: string;
}

export async function upsertBillingCustomer(
  supabase: TypedSupabaseClient,
  input: UpsertBillingCustomerInput,
): Promise<BillingCustomer | null> {
  const { data, error } = await supabase
    .from("billing_customers")
    .upsert(
      { student_id: input.studentId, stripe_customer_id: input.stripeCustomerId, email: input.email },
      { onConflict: "student_id" },
    )
    .select("*")
    .single();
  devWarn("upsertBillingCustomer", error);
  return data ? mapBillingCustomerRow(data) : null;
}

export async function findStudentIdByStripeCustomerId(supabase: TypedSupabaseClient, stripeCustomerId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("billing_customers")
    .select("student_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();
  devWarn("findStudentIdByStripeCustomerId", error);
  return data?.student_id ?? null;
}

export interface UpsertSubscriptionInput {
  studentId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  stripeProductId: string | null;
  planName: string;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  amountCents: number | null;
  currency: string;
}

export async function upsertSubscription(supabase: TypedSupabaseClient, input: UpsertSubscriptionInput): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("subscriptions")
    .upsert(
      {
        student_id: input.studentId,
        stripe_customer_id: input.stripeCustomerId,
        stripe_subscription_id: input.stripeSubscriptionId,
        stripe_price_id: input.stripePriceId,
        stripe_product_id: input.stripeProductId,
        plan_name: input.planName,
        status: input.status,
        current_period_start: input.currentPeriodStart,
        current_period_end: input.currentPeriodEnd,
        cancel_at_period_end: input.cancelAtPeriodEnd,
        cancelled_at: input.cancelledAt,
        amount_cents: input.amountCents,
        currency: input.currency,
      },
      { onConflict: "stripe_subscription_id" },
    )
    .select("*")
    .single();
  devWarn("upsertSubscription", error);
  return data ? mapSubscriptionRow(data) : null;
}

export interface RecordStripePaymentInput {
  studentId: string;
  stripeCustomerId: string | null;
  stripePaymentIntentId: string | null;
  stripeInvoiceId: string | null;
  stripeSubscriptionId: string | null;
  amountCents: number | null;
  currency: string;
  status: string;
  paidAt: string | null;
}

/** Idempotent sur `stripeInvoiceId` quand présent (une facture peut redéclencher webhook plusieurs fois) : met à jour la ligne existante plutôt que d'en créer une seconde. */
export async function recordStripePayment(supabase: TypedSupabaseClient, input: RecordStripePaymentInput): Promise<StripePayment | null> {
  const payload = {
    student_id: input.studentId,
    stripe_customer_id: input.stripeCustomerId,
    stripe_payment_intent_id: input.stripePaymentIntentId,
    stripe_invoice_id: input.stripeInvoiceId,
    stripe_subscription_id: input.stripeSubscriptionId,
    amount_cents: input.amountCents,
    currency: input.currency,
    status: input.status,
    paid_at: input.paidAt,
  };

  if (input.stripeInvoiceId) {
    const { data: existing } = await supabase
      .from("stripe_payments")
      .select("id")
      .eq("stripe_invoice_id", input.stripeInvoiceId)
      .maybeSingle();
    if (existing) {
      const { data, error } = await supabase.from("stripe_payments").update(payload).eq("id", existing.id).select("*").single();
      devWarn("recordStripePayment (update)", error);
      return data ? mapStripePaymentRow(data) : null;
    }
  }

  const { data, error } = await supabase.from("stripe_payments").insert(payload).select("*").single();
  devWarn("recordStripePayment (insert)", error);
  return data ? mapStripePaymentRow(data) : null;
}
