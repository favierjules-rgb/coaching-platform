import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

import {
  composePaymentFailedEmail,
  composePaymentSucceededEmail,
  composePublicProgramOrderConfirmationEmail,
  composeSubscriptionCancelledEmail,
} from "@/lib/email/templates";
import { sendTransactionalEmail } from "@/lib/email/send-transactional-email";
import { getStripeClient } from "@/lib/stripe/client";
import { getInvoiceCustomerId, getInvoicePaymentIntentId, getInvoiceSubscriptionId } from "@/lib/stripe/invoice-helpers";
import { getResolvedPlanByPriceId } from "@/lib/stripe/plans-server";
import { buildStudentActivityLink, logActivityEvent } from "@/lib/supabase/activity";
import {
  findStudentIdByStripeCustomerId,
  getPublicProgramPurchaseConfirmationEmailState,
  getSubscriptionForStudent,
  recordPublicProgramPurchaseConfirmationEmailResult,
  recordStripePayment,
  upsertBillingCustomer,
  upsertSubscription,
} from "@/lib/supabase/billing";
import { provisionPublicProgramAccess, RetryablePublicProgramProvisioningError } from "@/lib/supabase/public-program-provisioning";
import { getStudentById } from "@/lib/supabase/students";
import { getSubscriptionTemplateByPriceId } from "@/lib/supabase/subscription-templates";
import type { Database } from "@/types/supabase";

/**
 * Gestion des 6 évènements webhook Stripe demandés (chantier
 * "supabase-stripe-payments-subscriptions"). Chaque handler reçoit le
 * client Supabase service role (déjà résolu par la route, contourne RLS —
 * légitime ici, l'appelant est Stripe lui-même après vérification de
 * signature, pas un utilisateur du site) et n'écrit jamais le statut
 * autrement que ce que Stripe a réellement envoyé.
 */

type TypedSupabaseClient = SupabaseClient<Database>;

function toIso(unixSeconds: number | null | undefined): string | null {
  return typeof unixSeconds === "number" ? new Date(unixSeconds * 1000).toISOString() : null;
}

function extractId(value: string | { id: string } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === "string" ? value : value.id;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "";
}

/** Portail client Stripe pour le bouton "Mettre à jour mon moyen de paiement" de l'email d'échec de paiement — repli sur /profil (où l'élève peut relancer le portail lui-même) si la création échoue ou si Stripe n'est pas disponible. */
async function buildPortalUrlOrFallback(stripeCustomerId: string): Promise<string> {
  const profileUrl = `${appUrl()}/profil`;
  const stripe = getStripeClient();
  if (!stripe) return profileUrl;
  try {
    const session = await stripe.billingPortal.sessions.create({ customer: stripeCustomerId, return_url: profileUrl });
    return session.url;
  } catch (error) {
    console.error("[Stripe webhook] Échec de création du lien portail pour l'email d'échec de paiement", error);
    return profileUrl;
  }
}

/** Upsert la ligne `subscriptions` à partir d'un objet Stripe.Subscription — renvoie le student_id résolu, ou `null` si impossible à résoudre. */
async function upsertSubscriptionFromStripeObject(supabase: TypedSupabaseClient, subscription: Stripe.Subscription): Promise<string | null> {
  const stripeCustomerId = extractId(subscription.customer);
  if (!stripeCustomerId) return null;

  const studentId = subscription.metadata.student_id || (await findStudentIdByStripeCustomerId(supabase, stripeCustomerId));
  if (!studentId) {
    console.error(
      `[Stripe webhook] Impossible de résoudre student_id pour la subscription ${subscription.id} (customer ${stripeCustomerId}).`,
    );
    return null;
  }

  const item = subscription.items.data[0];
  const price = item?.price;
  const priceId = price?.id ?? null;
  const productId = extractId(price?.product as string | { id: string } | undefined) ?? null;
  // Nom de formule : `subscription_templates` (source prioritaire, chantier
  // "supabase-subscription-templates") d'abord, mapping .env
  // (lib/stripe/plans-server.ts) en repli tant qu'aucun modèle ne
  // correspond à ce price_id.
  const template = priceId ? await getSubscriptionTemplateByPriceId(supabase, priceId) : null;
  const plan = getResolvedPlanByPriceId(priceId);

  await upsertSubscription(supabase, {
    studentId,
    stripeCustomerId,
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    stripeProductId: productId,
    planName: template?.name ?? plan?.label ?? "",
    status: subscription.status,
    currentPeriodStart: toIso(item?.current_period_start),
    currentPeriodEnd: toIso(item?.current_period_end),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    cancelledAt: toIso(subscription.canceled_at),
    amountCents: price?.unit_amount ?? null,
    currency: price?.currency ?? "eur",
  });

  return studentId;
}

/**
 * checkout.session.completed : crée/relie le customer Stripe à l'élève
 * (l'abonnement lui-même arrive via customer.subscription.created juste
 * après). Branche séparée pour l'achat anonyme d'un programme public
 * (metadata.public_program_id, chantier module Programmation, étape 6) — ce
 * chemin ne concerne jamais un studentId déjà existant : le compte élève
 * est provisionné ici même, voir handlePublicProgramCheckoutCompleted.
 */
export async function handleCheckoutSessionCompleted(
  supabase: TypedSupabaseClient,
  session: Stripe.Checkout.Session,
  stripeEventId: string,
): Promise<void> {
  const publicProgramId = session.metadata?.public_program_id;
  if (publicProgramId) {
    await handlePublicProgramCheckoutCompleted(supabase, session, publicProgramId, stripeEventId);
    return;
  }

  const stripeCustomerId = extractId(session.customer as string | { id: string } | null);
  const studentId = session.client_reference_id || session.metadata?.student_id || null;
  if (!stripeCustomerId || !studentId) {
    console.error(`[Stripe webhook] checkout.session.completed sans customer/student_id exploitable (session ${session.id}).`);
    return;
  }
  await upsertBillingCustomer(supabase, {
    studentId,
    stripeCustomerId,
    email: session.customer_details?.email || session.customer_email || "",
  });
}

/**
 * Achat anonyme d'un programme public en paiement unique (chantier module
 * Programmation, étape 6) : provisionne le compte élève (nouveau ou
 * existant, voir lib/supabase/public-program-provisioning.ts), puis
 * journalise le paiement pour la visibilité admin (/admin/paiements).
 * Contrairement au mode "subscription", un Checkout "payment" ne déclenche
 * jamais invoice.payment_succeeded : ce paiement n'est donc jamais
 * enregistré ailleurs que dans cette branche.
 *
 * Ordre imposé (chantier conformité juridique/RGPD, Lot E-bis — juillet
 * 2026) : les preuves de consentement (CGV + accès immédiat/perte du droit
 * de rétractation) sont écrites, PUIS l'email de confirmation de commande
 * "sur support durable" est envoyé, et c'est SEULEMENT APRÈS que
 * setProgramAssignment active l'accès au programme — jamais l'inverse. Ce
 * séquençage est réalisé via le hook onConsentsRecorded transmis à
 * provisionPublicProgramAccess (voir public-program-provisioning.ts), qui
 * l'invoke à l'instant exact requis, avant d'activer l'accès. L'email de
 * bienvenue/"programme attribué" (compte utilisable) continue d'être envoyé
 * par provisionPublicProgramAccess juste après l'activation, comme avant.
 *
 * Fenêtre d'échec corrigée (suite audit) : chacune des 3 étapes
 * correctness-critical (consentement CGV, consentement accès immédiat/
 * rétractation, envoi de la confirmation) lève désormais
 * RetryablePublicProgramProvisioningError si elle échoue réellement, plutôt
 * que de continuer silencieusement — cette exception n'est PAS interceptée
 * ici : elle traverse cette fonction, handleCheckoutSessionCompleted, puis
 * remonte jusqu'à app/api/stripe/webhook/route.ts, qui répond 500 (Stripe
 * programme un nouvel essai) sans jamais marquer l'évènement "processed".
 * Chaque étape est elle-même idempotente (dédoublonnage par
 * checkout_session_id pour les consentements, clé d'idempotence Resend pour
 * l'email, lookup-avant-insert déjà existant pour l'activation) — un retry
 * ne duplique donc rien, il complète simplement ce qui n'a pas encore
 * réussi. Voir acquirePublicProgramPurchaseEventLock dans
 * lib/supabase/billing.ts pour le verrou d'évènement "reprenable" côté
 * route, propre à ce cas précis (les autres types d'évènements Stripe
 * gardent le mécanisme simple existant, inchangé).
 */
async function handlePublicProgramCheckoutCompleted(
  supabase: TypedSupabaseClient,
  session: Stripe.Checkout.Session,
  programId: string,
  stripeEventId: string,
): Promise<void> {
  const email = session.metadata?.email || session.customer_details?.email || session.customer_email || "";
  if (!email) {
    console.error(`[Stripe webhook] checkout.session.completed (programme public) sans email exploitable (session ${session.id}).`);
    return;
  }
  const firstName = session.metadata?.first_name || "";
  const lastName = session.metadata?.last_name || "";
  const programName = session.metadata?.program_name || "";
  // Preuve de consentement CGV et "accès immédiat + perte du droit de
  // rétractation" posées côté route de checkout (voir
  // app/api/public/programs/[programId]/checkout/route.ts) — reportées ici
  // dans legal_consents une fois le student_id connu.
  const cgvConsentTextVersion = session.metadata?.cgv_accepted === "true" ? session.metadata?.cgv_version : undefined;
  const immediateAccessAndWaiverConsentTextVersion =
    session.metadata?.immediate_access_and_waiver_accepted === "true"
      ? session.metadata?.immediate_access_and_waiver_version
      : undefined;

  const { data: programRow } = await supabase.from("programs").select("coach_id").eq("id", programId).maybeSingle();

  // Confirmation de commande "sur support durable" — construite ici pour
  // capturer email/firstName/programName/session par closure, mais envoyée
  // seulement au moment précis où provisionPublicProgramAccess invoque ce
  // hook (après consentements, avant activation).
  //
  // Fenêtre d'échec corrigée (suite audit, Lot E-bis) : le résultat de
  // sendTransactionalEmail est désormais vérifié explicitement. `"failed"`
  // lève RetryablePublicProgramProvisioningError, qui remonte jusqu'au
  // webhook Stripe (500, retry automatique, évènement jamais marqué
  // "processed" — voir app/api/stripe/webhook/route.ts). `"skipped"`
  // (EMAILS_ENABLED=false ou Resend non configuré — état délibéré) N'EST
  // PAS traité comme un échec, volontairement : voir le docblock
  // d'onConsentsRecorded dans public-program-provisioning.ts.
  //
  // Clé d'idempotence Resend STABLE (dérivée de session.id, qui ne change
  // jamais d'un retry à l'autre du même évènement webhook) : sans elle,
  // sendTransactionalEmail utilise par défaut un UUID frais à chaque appel
  // (voir lib/email/send-transactional-email.ts), donc un retry renverrait
  // réellement un second email identique côté Resend malgré l'apparence
  // d'idempotence. Avec cette clé, Resend lui-même refuse de renvoyer un
  // second email pour la même clé — protection indépendante et
  // complémentaire du dédoublonnage applicatif (email_logs). MAIS cette
  // protection Resend n'est garantie que 24h (fenêtre documentée par
  // Resend) : au-delà, un retry Stripe tardif renverrait réellement un
  // second email. Renforcement (suite audit) : l'état de CET envoi est
  // aussi persisté dans billing_events.payload (voir
  // getPublicProgramPurchaseConfirmationEmailState /
  // recordPublicProgramPurchaseConfirmationEmailResult dans
  // lib/supabase/billing.ts), sans limite de durée — si un essai précédent
  // a déjà réussi, Resend n'est jamais rappelé, quel que soit l'écart de
  // temps avec le retry.
  // LIMITE RÉSIDUELLE documentée (suite audit, point 8) : entre l'instant où
  // Resend accepte réellement l'email (sendTransactionalEmail obtient un
  // succès de l'API Resend) et l'instant où recordPublicProgramPurchaseConfirmationEmailResult
  // termine d'écrire "_seth_confirmation_email_status: sent" en base, un
  // crash du process (redéploiement, OOM, panne réseau vers Supabase...)
  // laisserait l'état local à "jamais tenté" alors que l'email a réellement
  // été envoyé. Un retry ultérieur renverrait alors un second email — la clé
  // d'idempotence Resend (stable, dérivée de session.id) empêcherait
  // normalement Resend de le renvoyer une seconde fois PENDANT sa fenêtre de
  // 24h documentée, mais au-delà de cette fenêtre, rien ne l'empêche plus.
  // Cette combinaison (clé Resend + statut local persisté) réduit fortement
  // le risque sans l'éliminer mathématiquement : un exactly-once strict
  // nécessiterait une transaction distribuée ou un outbox pattern avec
  // relecture garantie côté Resend, hors périmètre de ce correctif.
  const onConsentsRecorded = cgvConsentTextVersion
    ? async () => {
        const existingEmailState = await getPublicProgramPurchaseConfirmationEmailState(supabase, stripeEventId);
        if (existingEmailState?.status === "sent") {
          return;
        }

        const orderEmail = composePublicProgramOrderConfirmationEmail({
          firstName,
          programName,
          priceCents: session.amount_total,
          currency: session.currency ?? "eur",
          purchasedAtIso: new Date().toISOString(),
          cgvVersion: cgvConsentTextVersion,
          immediateAccessAndWaiverVersion: immediateAccessAndWaiverConsentTextVersion,
        });
        const result = await sendTransactionalEmail(supabase, {
          emailType: "order_confirmation",
          recipientEmail: email,
          subject: orderEmail.subject,
          html: orderEmail.html,
          text: orderEmail.text,
          relatedEntityType: "program",
          relatedEntityId: programId,
          metadata: { source: "public_program_purchase" },
          idempotencyKey: `program-purchase-confirmation/${session.id}`,
        });
        // Persisté IMMÉDIATEMENT, avant toute décision d'activation — un
        // crash juste après ne doit jamais perdre la trace d'un envoi qui a
        // réellement réussi (voir le docblock de la fonction ci-dessus).
        await recordPublicProgramPurchaseConfirmationEmailResult(supabase, stripeEventId, {
          status: result.status,
          emailId: result.logId,
        });
        if (result.status === "failed") {
          throw new RetryablePublicProgramProvisioningError(
            `Échec de l'envoi de la confirmation de commande (session ${session.id}) : ${result.error ?? "raison inconnue"}.`,
          );
        }
        // "skipped" (EMAILS_ENABLED=false ou Resend non configuré) : accepté
        // hors production (dev/test — état délibéré, pas une panne), mais
        // traité comme un échec retryable EN PRODUCTION (correctif suite
        // audit) — un client qui paie en production doit recevoir une vraie
        // confirmation, jamais un contournement silencieux.
        if (result.status === "skipped" && process.env.NODE_ENV === "production") {
          throw new RetryablePublicProgramProvisioningError(
            `Confirmation de commande "skipped" en production (session ${session.id}) — traité comme un échec retryable, le bypass n'est autorisé qu'en développement/test.`,
          );
        }
      }
    : undefined;

  const result = await provisionPublicProgramAccess(supabase, {
    programId,
    programName,
    coachId: programRow?.coach_id ?? null,
    firstName,
    lastName,
    email,
    cgvConsentTextVersion,
    immediateAccessAndWaiverConsentTextVersion,
    checkoutSessionId: session.id,
    onConsentsRecorded,
  });
  if (!result) {
    console.error(`[Stripe webhook] échec du provisionnement pour l'achat du programme public ${programId} (session ${session.id}).`);
    return;
  }

  const stripeCustomerId = extractId(session.customer as string | { id: string } | null);
  if (stripeCustomerId) {
    await upsertBillingCustomer(supabase, { studentId: result.studentId, stripeCustomerId, email });
  }
  await recordStripePayment(supabase, {
    studentId: result.studentId,
    stripeCustomerId,
    stripePaymentIntentId: extractId(session.payment_intent as string | { id: string } | null),
    stripeInvoiceId: null,
    stripeSubscriptionId: null,
    amountCents: session.amount_total,
    currency: session.currency ?? "eur",
    status: "succeeded",
    paidAt: new Date().toISOString(),
  });
  await logActivityEvent(supabase, {
    studentId: result.studentId,
    actorType: "system",
    eventType: "payment_succeeded",
    title: "Achat programme (accès unique)",
    description: `${((session.amount_total ?? 0) / 100).toFixed(2)} ${(session.currency ?? "eur").toUpperCase()} — ${programName}`,
    metadata: buildStudentActivityLink(result.studentId),
  });
}

/** customer.subscription.created / customer.subscription.updated. */
export async function handleSubscriptionUpsert(supabase: TypedSupabaseClient, subscription: Stripe.Subscription): Promise<void> {
  await upsertSubscriptionFromStripeObject(supabase, subscription);
}

/** customer.subscription.deleted. */
export async function handleSubscriptionDeleted(supabase: TypedSupabaseClient, subscription: Stripe.Subscription): Promise<void> {
  const studentId = await upsertSubscriptionFromStripeObject(supabase, subscription);
  if (!studentId) return;
  await logActivityEvent(supabase, {
    studentId,
    actorType: "system",
    eventType: "subscription_cancelled",
    title: "Abonnement annulé",
    description: "L'abonnement Stripe de l'élève a été annulé.",
    metadata: buildStudentActivityLink(studentId),
  });

  const student = await getStudentById(supabase, studentId);
  if (student?.email) {
    const item = subscription.items.data[0];
    const email = composeSubscriptionCancelledEmail({
      firstName: student.firstName,
      accessEndDate: toIso(item?.current_period_end),
      profileUrl: `${appUrl()}/profil`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "subscription_cancelled",
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "subscription",
      relatedEntityId: studentId,
      metadata: { stripeSubscriptionId: subscription.id },
    });
  }
}

/** invoice.payment_succeeded. */
export async function handleInvoicePaymentSucceeded(supabase: TypedSupabaseClient, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = getInvoiceCustomerId(invoice);
  if (!stripeCustomerId) return;
  const studentId = await findStudentIdByStripeCustomerId(supabase, stripeCustomerId);
  if (!studentId) {
    console.error(`[Stripe webhook] invoice.payment_succeeded sans élève résolu (customer ${stripeCustomerId}).`);
    return;
  }
  await recordStripePayment(supabase, {
    studentId,
    stripeCustomerId,
    stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
    stripeInvoiceId: invoice.id ?? null,
    stripeSubscriptionId: getInvoiceSubscriptionId(invoice),
    amountCents: invoice.amount_paid,
    currency: invoice.currency,
    status: "succeeded",
    paidAt: toIso(invoice.status_transitions?.paid_at) ?? new Date().toISOString(),
  });
  await logActivityEvent(supabase, {
    studentId,
    actorType: "system",
    eventType: "payment_succeeded",
    title: "Paiement reçu",
    description: `${(invoice.amount_paid / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`,
    metadata: buildStudentActivityLink(studentId),
  });

  // Seule source de l'email "paiement réussi" : invoice.payment_succeeded,
  // jamais checkout.session.completed (qui ne fait que relier le customer,
  // voir handleCheckoutSessionCompleted) — évite tout doublon entre les
  // deux évènements, conformément à la consigne du chantier.
  const student = await getStudentById(supabase, studentId);
  if (student?.email) {
    const subscription = await getSubscriptionForStudent(supabase, studentId);
    const email = composePaymentSucceededEmail({
      firstName: student.firstName,
      planName: subscription?.planName ?? "",
      amountCents: invoice.amount_paid,
      currency: invoice.currency,
      dashboardUrl: `${appUrl()}/dashboard`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "payment_succeeded",
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "stripe_invoice",
      relatedEntityId: studentId,
      metadata: { stripeInvoiceId: invoice.id, amountCents: invoice.amount_paid },
    });
  }
}

/** invoice.payment_failed. */
export async function handleInvoicePaymentFailed(supabase: TypedSupabaseClient, invoice: Stripe.Invoice): Promise<void> {
  const stripeCustomerId = getInvoiceCustomerId(invoice);
  if (!stripeCustomerId) return;
  const studentId = await findStudentIdByStripeCustomerId(supabase, stripeCustomerId);
  if (!studentId) {
    console.error(`[Stripe webhook] invoice.payment_failed sans élève résolu (customer ${stripeCustomerId}).`);
    return;
  }
  await recordStripePayment(supabase, {
    studentId,
    stripeCustomerId,
    stripePaymentIntentId: getInvoicePaymentIntentId(invoice),
    stripeInvoiceId: invoice.id ?? null,
    stripeSubscriptionId: getInvoiceSubscriptionId(invoice),
    amountCents: invoice.amount_due,
    currency: invoice.currency,
    status: "failed",
    paidAt: null,
  });
  await logActivityEvent(supabase, {
    studentId,
    actorType: "system",
    eventType: "payment_failed",
    title: "Échec de paiement",
    description: `${(invoice.amount_due / 100).toFixed(2)} ${invoice.currency.toUpperCase()}`,
    metadata: buildStudentActivityLink(studentId),
  });

  const student = await getStudentById(supabase, studentId);
  if (student?.email) {
    const portalUrl = await buildPortalUrlOrFallback(stripeCustomerId);
    const email = composePaymentFailedEmail({
      firstName: student.firstName,
      portalUrl,
      profileUrl: `${appUrl()}/profil`,
    });
    await sendTransactionalEmail(supabase, {
      emailType: "payment_failed",
      recipientEmail: student.email,
      recipientUserId: student.userId,
      subject: email.subject,
      html: email.html,
      text: email.text,
      relatedEntityType: "stripe_invoice",
      relatedEntityId: studentId,
      metadata: { stripeInvoiceId: invoice.id, amountCents: invoice.amount_due },
    });
  }
}
