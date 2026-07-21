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
  /** Chantier "supabase-subscription-templates" — source prioritaire sur `assignedStripePlan`. */
  assignedSubscriptionTemplateId: string | null;
  assignedTemplateName: string | null;
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
    { data: templateRows, error: templateError },
  ] = await Promise.all([
    getStudents(supabase),
    supabase.from("billing_customers").select("*"),
    supabase.from("subscriptions").select("*").order("updated_at", { ascending: false }),
    supabase.from("stripe_payments").select("*").order("created_at", { ascending: false }),
    supabase.from("student_profiles").select("student_id, billing_access_mode, assigned_stripe_plan, assigned_subscription_template_id"),
    supabase.from("subscription_templates").select("id, name"),
  ]);
  devWarn("getAdminBillingList (billing_customers)", customerError);
  devWarn("getAdminBillingList (subscriptions)", subscriptionError);
  devWarn("getAdminBillingList (stripe_payments)", paymentError);
  devWarn("getAdminBillingList (student_profiles)", profileError);
  devWarn("getAdminBillingList (subscription_templates)", templateError);

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
  const assignedTemplateIdByStudent = new Map<string, string | null>(
    (profileRows ?? []).map((row) => [row.student_id, row.assigned_subscription_template_id]),
  );
  const templateNameById = new Map<string, string>((templateRows ?? []).map((row) => [row.id, row.name]));

  return students.map((student) => {
    const subscription = subscriptionByStudent.get(student.id) ?? null;
    const accessMode = accessModeByStudent.get(student.id) ?? "subscription_required";
    const assignedSubscriptionTemplateId = assignedTemplateIdByStudent.get(student.id) ?? null;
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
      assignedSubscriptionTemplateId,
      assignedTemplateName: assignedSubscriptionTemplateId ? (templateNameById.get(assignedSubscriptionTemplateId) ?? null) : null,
    };
  });
}

/* ─── Écriture (routes API uniquement, client service role) ─── */

/**
 * Durée du bail d'un évènement resté à "processing" pour le verrou
 * GÉNÉRIQUE ci-dessous (Lot W1). Volontairement identique au lease du
 * verrou programme public (5 min) : un traitement d'abonnement ou de
 * facture se compte en secondes, 5 minutes sans conclusion signifie un
 * processus mort (crash, redéploiement) et non un traitement en cours.
 * Une valeur plus courte risquerait de faire reprendre un traitement
 * réellement vivant ; une valeur plus longue laisserait un évènement
 * bloqué trop longtemps hors de portée de tout rejeu.
 */
export const STRIPE_EVENT_LOCK_LEASE_MS = 5 * 60 * 1000;

export type StripeEventLockResult = "proceed" | "already_processed" | "already_processing" | "lock_error";

/**
 * Verrou d'évènement GÉNÉRIQUE (Lot W1 — juillet 2026). Remplace
 * `recordBillingEventIfNew`, qui souffrait de deux défauts prouvés par
 * l'audit :
 *
 * 1. SELECT puis INSERT non atomiques : deux livraisons simultanées
 *    passaient toutes deux le SELECT, et la violation 23505 de la seconde
 *    était avalée (`error.code !== "23505"`) — la fonction renvoyait donc
 *    `false` (= "nouveau, traite-le") AUX DEUX APPELANTS, exécutant le
 *    handler deux fois.
 * 2. La ligne était insérée avant l'exécution du handler, et
 *    `processed_at` avait `default now()` : un handler en échec renvoyait
 *    500, Stripe réessayait, mais l'évènement existait déjà — la route
 *    répondait 200 "deduplicated" et le handler n'était PLUS JAMAIS
 *    rejoué. Perte définitive et silencieuse.
 *
 * Cette fonction applique la même stratégie d'acquisition atomique que
 * `acquirePublicProgramPurchaseEventLock` (validée au Lot E-bis), mais sur
 * les VRAIES colonnes créées par la migration
 * 20260721180920_billing_events_processing_status.sql au lieu des clés
 * `_seth_*` dans `payload` :
 *
 * 1. INSERT direct avec status="processing" — gagne si l'évènement est
 *    réellement nouveau, grâce à la contrainte `unique` sur
 *    `stripe_event_id`. Deux requêtes concurrentes : Postgres arbitre,
 *    une seule réussit, l'autre reçoit 23505. Jamais les deux.
 * 2. En cas de conflit, UPDATE CONDITIONNEL en UNE SEULE instruction
 *    (jamais un SELECT séparé suivi d'une décision côté JS) : la
 *    condition de reprise est dans le WHERE. Sous PostgreSQL, `UPDATE
 *    ... WHERE` verrouille la ligne ; si deux requêtes tentent le même
 *    UPDATE, la seconde attend le commit de la première puis réévalue son
 *    WHERE sur la ligne déjà modifiée — elle n'affecte alors aucune ligne.
 *    Reprise autorisée dans deux cas SEULEMENT :
 *      - status = "failed" (échec explicite, rejeu légitime) ;
 *      - status = "processing" ET processing_started_at antérieur au lease
 *        (traitement précédent probablement mort).
 *    "unknown_legacy" n'est PAS repris : ces lignes datent d'avant le Lot
 *    W1, leur réussite est inconnue, et les rejouer produirait des effets
 *    métier non désirés sur des évènements potentiellement déjà traités.
 * 3. Si ni l'insertion ni la reprise n'ont abouti, une unique lecture
 *    purement informative (la décision de concurrence a déjà été prise
 *    atomiquement en 2) distingue "already_processed" d'"already_processing".
 *
 * `attempts_count` est incrémenté à chaque acquisition réussie, et
 * l'erreur précédente est nettoyée lors d'une reprise.
 */
export async function acquireStripeEventLock(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<StripeEventLockResult> {
  const nowIso = new Date().toISOString();
  const leaseCutoffIso = new Date(Date.now() - STRIPE_EVENT_LOCK_LEASE_MS).toISOString();

  const { error: insertError } = await supabase.from("billing_events").insert({
    stripe_event_id: stripeEventId,
    event_type: eventType,
    payload,
    status: "processing",
    processing_started_at: nowIso,
    processed_at: null,
    failed_at: null,
    error_message: null,
    attempts_count: 1,
    last_attempt_at: nowIso,
  });

  if (!insertError) {
    return "proceed";
  }

  if (insertError.code !== "23505") {
    devWarn("acquireStripeEventLock (insert)", insertError);
    return "lock_error";
  }

  // Reprise conditionnelle atomique. `attempts_count` n'est pas incrémenté
  // ici (Supabase JS ne permet pas `col = col + 1` dans un update simple) :
  // il l'est par la lecture-écriture ciblée ci-dessous, uniquement après
  // que la course a déjà été tranchée par cet UPDATE.
  const { data: recovered, error: updateError } = await supabase
    .from("billing_events")
    .update({
      status: "processing",
      processing_started_at: nowIso,
      last_attempt_at: nowIso,
      processed_at: null,
      failed_at: null,
      error_message: null,
    })
    .eq("stripe_event_id", stripeEventId)
    .or(`status.eq.failed,and(status.eq.processing,processing_started_at.lt.${leaseCutoffIso})`)
    .select("id, attempts_count");

  if (updateError) {
    devWarn("acquireStripeEventLock (recovery update)", updateError);
    return "lock_error";
  }

  if (recovered && recovered.length > 0) {
    const previousAttempts = (recovered[0] as { attempts_count?: number | null }).attempts_count ?? 0;
    const { error: bumpError } = await supabase
      .from("billing_events")
      .update({ attempts_count: previousAttempts + 1 })
      .eq("stripe_event_id", stripeEventId);
    devWarn("acquireStripeEventLock (attempts bump)", bumpError);
    return "proceed";
  }

  const { data: existing, error: lookupError } = await supabase
    .from("billing_events")
    .select("status")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  devWarn("acquireStripeEventLock (status lookup)", lookupError);
  const status = (existing as { status?: string } | null)?.status;
  return status === "processed" || status === "unknown_legacy" ? "already_processed" : "already_processing";
}

/**
 * À appeler UNIQUEMENT après la réussite complète du handler (Lot W1).
 * C'est le seul endroit qui renseigne `processed_at` — la contrainte
 * `billing_events_processed_at_check` garantit en base que les deux
 * restent cohérents.
 */
export async function markStripeEventProcessed(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  extra?: { ignoredReason?: string },
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("billing_events")
    .update({
      status: "processed",
      processed_at: nowIso,
      failed_at: null,
      error_message: extra?.ignoredReason ?? null,
    })
    .eq("stripe_event_id", stripeEventId);
  devWarn("markStripeEventProcessed", error);
}

/**
 * Persiste un échec de handler (Lot W1). `processed_at` reste NULL et le
 * statut passe à "failed", ce qui autorise explicitement un rejeu par
 * `acquireStripeEventLock` lors du prochain essai de Stripe — c'est
 * exactement ce qui était impossible avant ce lot.
 */
export async function markStripeEventFailed(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  errorMessage: string,
): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("billing_events")
    .update({
      status: "failed",
      failed_at: nowIso,
      error_message: errorMessage.slice(0, 2000),
      processed_at: null,
    })
    .eq("stripe_event_id", stripeEventId);
  devWarn("markStripeEventFailed", error);
}

/**
 * Durée du "bail" (lease) d'un évènement resté à "processing" (chantier
 * conformité juridique/RGPD, Lot E-bis technique — correctif verrou
 * concurrent, suite audit). Un traitement normal (consentements + email +
 * activation) se compte en secondes ; 5 minutes à "processing" sans jamais
 * atteindre "processed" ni "failed" signifie presque certainement un
 * processus mort (crash serveur, redéploiement en plein traitement) plutôt
 * qu'un traitement réellement en cours — seul ce cas autorise une reprise
 * automatique, voir acquirePublicProgramPurchaseEventLock ci-dessous.
 */
const PUBLIC_PROGRAM_PURCHASE_LOCK_LEASE_MS = 5 * 60 * 1000;

export type PublicProgramPurchaseEventLockResult = "proceed" | "already_processed" | "already_processing" | "lock_error";

/**
 * Verrou d'évènement "reprenable" (chantier conformité juridique/RGPD, Lot
 * E-bis technique — juillet 2026 ; corrigé suite audit pour une acquisition
 * réellement atomique) — RÉSERVÉ à checkout.session.completed pour l'achat
 * d'un programme public payant (voir app/api/stripe/webhook/route.ts, qui
 * choisit cette fonction UNIQUEMENT pour ce cas précis ; tous les autres
 * types d'évènements — abonnements, factures, et même
 * checkout.session.completed pour un abonnement — passent depuis le Lot W1
 * par `acquireStripeEventLock` ci-dessus, qui remplace l'ancien
 * `recordBillingEventIfNew`, supprimé).
 *
 * Ce verrou-ci n'a PAS été réécrit par le Lot W1 : sa logique `_seth_*` et
 * ses valeurs de retour sont strictement inchangées (17 tests existants
 * toujours verts) ; seules des écritures miroir sur les nouvelles colonnes
 * réelles ont été ajoutées, pour ne pas laisser de lignes incohérentes.
 *
 * États stockés dans `_seth_status`, À L'INTÉRIEUR de la colonne `payload`
 * jsonb déjà existante (aucune migration SQL : `payload` est déjà une
 * colonne libre, `_seth_status`/`_seth_lease_started_at`/`_seth_error`/
 * `_seth_failed_at` sont des clés internes préfixées pour ne jamais entrer
 * en collision avec les clés réelles de l'évènement Stripe brut) :
 * - "processing" : traitement en cours (ou précédemment interrompu, voir
 *   _seth_lease_started_at) ;
 * - "processed"  : traitement terminé avec succès, plus jamais rejoué ;
 * - "failed"     : dernier essai en échec explicite, un nouvel essai est
 *   autorisé.
 *
 * ACQUISITION ATOMIQUE (correctif suite audit — un read-then-write simple
 * est explicitement interdit ici) :
 * 1. INSERT direct avec _seth_status="processing" — gagne si l'évènement
 *    est réellement nouveau, grâce à la contrainte `unique` déjà existante
 *    sur billing_events.stripe_event_id (schema.sql, aucune migration
 *    nécessaire). Deux requêtes concurrentes pour le même évènement : Postgres
 *    lui-même arbitre la course — une seule réussit, l'autre reçoit une
 *    violation d'unicité (23505), jamais les deux.
 * 2. En cas de conflit (la ligne existe déjà), tentative de récupération par
 *    UPDATE CONDITIONNEL — une seule instruction SQL, condition de reprise
 *    dans la clause WHERE elle-même (jamais un SELECT séparé suivi d'une
 *    décision côté JS). Sous PostgreSQL, un `UPDATE ... WHERE` verrouille la
 *    ligne ciblée : si deux requêtes tentent ce même UPDATE en même temps, la
 *    seconde attend que la première commit puis réévalue son WHERE sur la
 *    ligne déjà mise à jour — si la première a fait passer le statut à
 *    "processing", la seconde ne matche plus rien et affecte 0 ligne. C'est
 *    cette combinaison "comparaison + écriture" en une seule instruction qui
 *    rend la récupération atomique. Récupération autorisée dans deux cas
 *    seulement : _seth_status="failed", ou _seth_status="processing" ET
 *    _seth_lease_started_at antérieur au lease ci-dessus (traitement
 *    précédent probablement mort). Les timestamps ISO-8601 se comparent
 *    correctement de façon purement lexicale, aucun cast SQL nécessaire.
 * 3. Si ni l'insertion ni la récupération n'ont abouti, une unique lecture
 *    (purement informative — aucune décision de concurrence n'est prise ici,
 *    elle a déjà eu lieu atomiquement à l'étape 2) distingue "already_processed"
 *    de "already_processing" pour la valeur de retour.
 *
 * Retourne "proceed" si le handler doit (re)tourner ; "already_processed" ou
 * "already_processing" s'il ne doit surtout pas être rejoué (aucun effet
 * métier côté appelant dans les deux cas) ; "lock_error" si l'acquisition
 * elle-même a échoué pour une raison inattendue (panne DB) — l'appelant doit
 * alors répondre en erreur pour que Stripe réessaie, sans jamais supposer
 * l'évènement acquis.
 */
export async function acquirePublicProgramPurchaseEventLock(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  eventType: string,
  payload: Record<string, unknown>,
): Promise<PublicProgramPurchaseEventLockResult> {
  const nowIso = new Date().toISOString();
  const leaseCutoffIso = new Date(Date.now() - PUBLIC_PROGRAM_PURCHASE_LOCK_LEASE_MS).toISOString();

  // Lot W1 : les colonnes réelles (status/processing_started_at/…) sont
  // renseignées EN PLUS des clés `_seth_*`, qui restent la source de
  // vérité de CE verrou (aucun changement de logique ni de valeur de
  // retour — les 17 tests existants restent valides). Objectif : ne pas
  // laisser les lignes du chemin programme public à un statut de colonne
  // incohérent avec leur `_seth_status` réel, maintenant que les colonnes
  // existent et servent au balayage des évènements bloqués.
  const { error: insertError } = await supabase.from("billing_events").insert({
    stripe_event_id: stripeEventId,
    event_type: eventType,
    payload: { ...payload, _seth_status: "processing", _seth_lease_started_at: nowIso },
    status: "processing",
    processing_started_at: nowIso,
    processed_at: null,
    attempts_count: 1,
    last_attempt_at: nowIso,
  });

  if (!insertError) {
    return "proceed";
  }

  if (insertError.code !== "23505") {
    devWarn("acquirePublicProgramPurchaseEventLock (insert)", insertError);
    return "lock_error";
  }

  const { data: recovered, error: updateError } = await supabase
    .from("billing_events")
    .update({ payload: { ...payload, _seth_status: "processing", _seth_lease_started_at: nowIso } })
    .eq("stripe_event_id", stripeEventId)
    .or(`payload->>_seth_status.eq.failed,and(payload->>_seth_status.eq.processing,payload->>_seth_lease_started_at.lt.${leaseCutoffIso})`)
    .select("id");
  devWarn("acquirePublicProgramPurchaseEventLock (recovery update)", updateError);

  if (updateError) {
    return "lock_error";
  }
  if (recovered && recovered.length > 0) {
    return "proceed";
  }

  const { data: existing, error: lookupError } = await supabase
    .from("billing_events")
    .select("payload")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  devWarn("acquirePublicProgramPurchaseEventLock (status lookup)", lookupError);
  const status = (existing?.payload as Record<string, unknown> | null)?._seth_status;
  return status === "processed" ? "already_processed" : "already_processing";
}

/** À appeler UNIQUEMENT après la réussite complète de toutes les étapes (consentements + email + activation) — voir acquirePublicProgramPurchaseEventLock ci-dessus. */
export async function markPublicProgramPurchaseEventProcessed(supabase: TypedSupabaseClient, stripeEventId: string): Promise<void> {
  const { data: existing, error: lookupError } = await supabase
    .from("billing_events")
    .select("payload")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  devWarn("markPublicProgramPurchaseEventProcessed (lookup)", lookupError);
  const currentPayload = (existing?.payload as Record<string, unknown> | null) ?? {};
  const { error } = await supabase
    .from("billing_events")
    .update({
      payload: { ...currentPayload, _seth_status: "processed", _seth_error: null },
      // Lot W1 : miroir sur les colonnes réelles (voir commentaire dans
      // acquirePublicProgramPurchaseEventLock).
      status: "processed",
      processed_at: new Date().toISOString(),
      failed_at: null,
      error_message: null,
    })
    .eq("stripe_event_id", stripeEventId);
  devWarn("markPublicProgramPurchaseEventProcessed (update)", error);
}

/** Journalise un échec (n'importe quelle étape) — laisse `_seth_status` à "failed" pour qu'un prochain retry Stripe soit autorisé par acquirePublicProgramPurchaseEventLock. Purement informatif, jamais bloquant. */
export async function markPublicProgramPurchaseEventFailed(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  errorMessage: string,
): Promise<void> {
  const { data: existing, error: lookupError } = await supabase
    .from("billing_events")
    .select("payload")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  devWarn("markPublicProgramPurchaseEventFailed (lookup)", lookupError);
  const currentPayload = (existing?.payload as Record<string, unknown> | null) ?? {};
  const { error } = await supabase
    .from("billing_events")
    .update({
      payload: { ...currentPayload, _seth_status: "failed", _seth_error: errorMessage, _seth_failed_at: new Date().toISOString() },
      // Lot W1 : miroir sur les colonnes réelles.
      status: "failed",
      failed_at: new Date().toISOString(),
      error_message: errorMessage.slice(0, 2000),
      processed_at: null,
    })
    .eq("stripe_event_id", stripeEventId);
  devWarn("markPublicProgramPurchaseEventFailed (update)", error);
}

export interface PublicProgramPurchaseConfirmationEmailState {
  status: "sent" | "failed" | "skipped";
  emailId: string | null;
  sentAt: string | null;
}

/**
 * État persisté de l'email de confirmation de commande pour CET évènement
 * Stripe précis (chantier conformité juridique/RGPD, Lot E-bis technique —
 * renforcement demandé pour couvrir un retry au-delà des 24h pendant
 * lesquelles Resend garantit lui-même l'idempotence de sa clé). Stocké dans
 * `billing_events.payload`, mêmes clés préfixées `_seth_` que le verrou
 * ci-dessus :
 * - `_seth_confirmation_email_status`  : "sent" | "failed" | "skipped" ;
 * - `_seth_confirmation_email_id`      : id de la ligne `email_logs`
 *   correspondante (le `logId` renvoyé par sendTransactionalEmail — pas l'id
 *   Resend brut, déjà consultable via `email_logs.resend_email_id` si besoin,
 *   pour éviter une seconde extension du contrat public de
 *   sendTransactionalEmail) ;
 * - `_seth_confirmation_email_sent_at` : horodatage de CET enregistrement
 *   (pas forcément l'horodatage Resend réel, purement notre propre trace).
 *
 * `null` si aucune tentative d'envoi n'a encore été journalisée pour cet
 * évènement (jamais tenté).
 */
export async function getPublicProgramPurchaseConfirmationEmailState(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
): Promise<PublicProgramPurchaseConfirmationEmailState | null> {
  const { data, error } = await supabase.from("billing_events").select("payload").eq("stripe_event_id", stripeEventId).maybeSingle();
  devWarn("getPublicProgramPurchaseConfirmationEmailState", error);
  const payload = data?.payload as Record<string, unknown> | null;
  const status = payload?._seth_confirmation_email_status;
  if (status !== "sent" && status !== "failed" && status !== "skipped") {
    return null;
  }
  return {
    status,
    emailId: (payload?._seth_confirmation_email_id as string | null | undefined) ?? null,
    sentAt: (payload?._seth_confirmation_email_sent_at as string | null | undefined) ?? null,
  };
}

/**
 * Persiste IMMÉDIATEMENT le résultat d'une tentative d'envoi, avant toute
 * décision d'activation du programme — pour qu'un crash juste après ne
 * perde jamais la trace d'un envoi qui a réellement réussi (voir l'appelant
 * dans lib/stripe/webhook-handlers.ts).
 *
 * Lecture-modification-écriture simple ici, PAS l'update conditionnel de
 * acquirePublicProgramPurchaseEventLock ci-dessus : sans danger de
 * concurrence, puisque seul le détenteur du verrou d'évènement (garanti
 * unique par acquirePublicProgramPurchaseEventLock) exécute jamais ce code
 * pour un `stripeEventId` donné — la mutuelle exclusion a déjà eu lieu en
 * amont, elle n'a pas besoin d'être répétée ici.
 */
export async function recordPublicProgramPurchaseConfirmationEmailResult(
  supabase: TypedSupabaseClient,
  stripeEventId: string,
  result: { status: "sent" | "failed" | "skipped"; emailId: string | null },
): Promise<void> {
  const { data: existing, error: lookupError } = await supabase
    .from("billing_events")
    .select("payload")
    .eq("stripe_event_id", stripeEventId)
    .maybeSingle();
  devWarn("recordPublicProgramPurchaseConfirmationEmailResult (lookup)", lookupError);
  const currentPayload = (existing?.payload as Record<string, unknown> | null) ?? {};
  const { error } = await supabase
    .from("billing_events")
    .update({
      payload: {
        ...currentPayload,
        _seth_confirmation_email_status: result.status,
        _seth_confirmation_email_id: result.emailId,
        _seth_confirmation_email_sent_at: new Date().toISOString(),
      },
    })
    .eq("stripe_event_id", stripeEventId);
  devWarn("recordPublicProgramPurchaseConfirmationEmailResult (update)", error);
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

/* ─── Suppression (routes API admin uniquement, nettoyage de données de test/historique) ─── */

/**
 * Historique complet des paiements Stripe d'un élève (contrairement à
 * `getLastPaymentForStudent`, qui ne renvoie que le plus récent) — utilisé
 * par l'admin pour lister et supprimer d'anciens paiements de test.
 */
export async function getPaymentsForStudent(supabase: TypedSupabaseClient, studentId: string): Promise<StripePayment[]> {
  const { data, error } = await supabase
    .from("stripe_payments")
    .select("*")
    .eq("student_id", studentId)
    .order("created_at", { ascending: false });
  devWarn("getPaymentsForStudent", error);
  return (data ?? []).map(mapStripePaymentRow);
}

/** Supprime définitivement une ligne `stripe_payments` (nettoyage de test/erreur — n'annule rien côté Stripe). */
export async function deleteStripePayment(supabase: TypedSupabaseClient, paymentId: string): Promise<boolean> {
  const { error } = await supabase.from("stripe_payments").delete().eq("id", paymentId);
  devWarn("deleteStripePayment", error);
  return !error;
}

/** Supprime définitivement une ligne `subscriptions` (nettoyage de test/erreur — n'annule rien côté Stripe, voir aussi le Customer Portal pour une vraie annulation). */
export async function deleteSubscriptionRecord(supabase: TypedSupabaseClient, subscriptionId: string): Promise<boolean> {
  const { error } = await supabase.from("subscriptions").delete().eq("id", subscriptionId);
  devWarn("deleteSubscriptionRecord", error);
  return !error;
}

/** Supprime définitivement une ligne `billing_customers` (nettoyage de test — ne supprime pas le Customer côté Stripe). */
export async function deleteBillingCustomer(supabase: TypedSupabaseClient, billingCustomerId: string): Promise<boolean> {
  const { error } = await supabase.from("billing_customers").delete().eq("id", billingCustomerId);
  devWarn("deleteBillingCustomer", error);
  return !error;
}
