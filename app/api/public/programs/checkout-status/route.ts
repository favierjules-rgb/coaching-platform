import { NextResponse } from "next/server";

import { checkoutStatusQuerySchema } from "@/lib/api/schemas/stripe";
import { parseParams } from "@/lib/api/validate";
import {
  consumeRateLimit,
  getTrustedClientIp,
  refusDeLimite,
  rateLimitKey,
} from "@/lib/security/rate-limit";
import { CHECKOUT_STATUS_IP } from "@/lib/security/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";

/**
 * GET /api/public/programs/checkout-status?session_id=cs_... — statut du
 * provisionnement après un achat de programme public. Interrogée en polling
 * par /programmes/merci au retour de Stripe Checkout.
 *
 * ---------------------------------------------------------------------
 * Correctif de sécurité H-1 (audit du 27/07/2026)
 * ---------------------------------------------------------------------
 * Cette route RENVOYAIT un magiclink Supabase (`action_link`) dès qu'un
 * `session_id` payé lui était présenté. Or ce `session_id` circule en clair
 * dans l'URL de retour Stripe (/programmes/merci?session_id=cs_...) : il se
 * retrouve dans l'historique du navigateur, les journaux d'accès de la
 * plateforme, une capture d'écran ou un lien partagé. Quiconque le
 * récupérait obtenait un lien de connexion valide — et, sur un compte
 * fraîchement créé, la redirection vers /reinitialiser-mot-de-passe lui
 * permettait de fixer lui-même le mot de passe. Aucune borne temporelle ne
 * s'y opposait : `sessions.retrieve` répond indéfiniment et un nouveau
 * magiclink était généré à CHAQUE appel.
 *
 * Règle désormais appliquée : **un session_id ne donne jamais accès à une
 * authentification.** Cette route ne renvoie plus qu'un statut booléen et
 * une destination interne non privilégiée. Aucun magiclink, aucun lien de
 * récupération, aucun access token, aucun refresh token, aucune URL
 * permettant de prendre le contrôle d'un compte ne transite plus par le
 * navigateur.
 *
 * Le lien de définition de mot de passe continue d'être émis, mais
 * uniquement côté serveur, par le webhook Stripe
 * (lib/supabase/public-program-provisioning.ts), envoyé par email à
 * l'adresse portée par la Checkout Session vérifiée, et de façon idempotente
 * (verrou d'évènement, cf. lib/supabase/billing.ts). Le canal email est le
 * seul à recevoir un lien : il prouve la possession de la boîte de
 * réception, ce qu'un session_id ne prouve pas.
 *
 * Autres mesures de la même correction :
 *   - `Cache-Control: no-store` sur TOUTES les réponses, y compris les
 *     erreurs — un intermédiaire ne doit jamais conserver un statut de
 *     paiement ;
 *   - le `session_id` n'est jamais journalisé en entier (voir `traceSession`) ;
 *   - l'adresse email n'est plus lue depuis `metadata` en premier : la
 *     source de vérité est `customer_details.email`, renseignée par Stripe
 *     lui-même. `metadata.email` provient d'un corps de requête soumis par
 *     le navigateur au moment du Checkout — donc d'une origine non fiable.
 */

/** En-têtes communs : un statut de paiement ne se met jamais en cache. */
const NO_STORE = { "Cache-Control": "no-store" } as const;

function reponse(corps: unknown, init?: { status?: number; headers?: Record<string, string> }) {
  return NextResponse.json(corps, {
    status: init?.status ?? 200,
    headers: { ...NO_STORE, ...(init?.headers ?? {}) },
  });
}

/**
 * Identifiant tronqué pour les journaux. Un `session_id` complet dans un log
 * reste un identifiant de commande exploitable ; les 8 premiers caractères
 * après le préfixe suffisent à retrouver la trace côté Stripe.
 */
function traceSession(sessionId: string): string {
  return `${sessionId.slice(0, 11)}…`;
}

export async function GET(request: Request) {
  // Quota large : la page /programmes/merci interroge cette route en boucle
  // courte. Il borne malgré tout les appels à Stripe.
  const ip = getTrustedClientIp(request);
  const parIp = await consumeRateLimit(rateLimitKey([ip]), CHECKOUT_STATUS_IP);
  if (!parIp.allowed) {
    // Cette route ne produit aucun effet externe : elle n'est pas
    // `failClosed`. Le helper commun distingue tout de même 429 (quota) et
    // 503 (magasin indisponible), et `no-store` est ajouté par-dessus.
    const refus = refusDeLimite(parIp, "Trop de requêtes. Réessaie dans un instant.");
    refus.headers.set("Cache-Control", "no-store");
    return refus;
  }

  const { searchParams } = new URL(request.url);
  const parsedParams = parseParams(Object.fromEntries(searchParams), checkoutStatusQuerySchema);
  if (!parsedParams.success) {
    return reponse({ error: "Paramètres invalides." }, { status: 400 });
  }
  const { session_id: sessionId } = parsedParams.data;

  const stripe = getStripeClient();
  if (!stripe) {
    return reponse({ error: "Stripe non configuré." }, { status: 503 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return reponse({ error: "Supabase non configuré." }, { status: 503 });
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (error) {
    console.error(`[public/programs/checkout-status] session Stripe introuvable (${traceSession(sessionId)})`, error);
    return reponse({ error: "Session de paiement introuvable." }, { status: 404 });
  }

  // Cette route ne sert que le parcours "programme public" (metadata posée
  // par /api/public/programs/[programId]/checkout) — jamais les sessions
  // d'abonnement élève classiques.
  if (!session.metadata?.public_program_id) {
    return reponse({ error: "Session hors périmètre." }, { status: 400 });
  }

  if (session.payment_status !== "paid") {
    return reponse({ paid: false, ready: false });
  }

  // Adresse issue de la Checkout Session VÉRIFIÉE. `customer_details.email`
  // est renseignée par Stripe à partir du formulaire de paiement ;
  // `customer_email` est celle transmise à la création de la session. Le
  // repli sur `metadata.email` reste possible pour les sessions antérieures
  // au correctif, mais n'est jamais prioritaire : il vient d'un corps de
  // requête soumis par le navigateur.
  const email = (session.customer_details?.email || session.customer_email || session.metadata?.email || "")
    .trim()
    .toLowerCase();
  if (!email) {
    return reponse({ paid: true, ready: false });
  }

  const { data: student, error: studentError } = await supabase
    .from("students")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (studentError) {
    console.error(`[public/programs/checkout-status] lecture élève (${traceSession(sessionId)}) : ${studentError.message}`);
  }
  if (!student) {
    // Webhook pas encore passé — la page continue de poller.
    return reponse({ paid: true, ready: false });
  }

  // Un email déjà connu (achat d'un programme supplémentaire) a déjà un
  // compte de longue date : le trouver ici ne prouve pas que LE WEBHOOK DE
  // CET ACHAT a fini. Seule l'assignation de ce programme précis en est la
  // preuve.
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id")
    .eq("student_id", student.id)
    .eq("content_type", "programme")
    .eq("content_id", session.metadata.public_program_id)
    .maybeSingle();
  if (assignmentError) {
    console.error(`[public/programs/checkout-status] lecture assignation (${traceSession(sessionId)}) : ${assignmentError.message}`);
  }
  if (!assignment) {
    return reponse({ paid: true, ready: false });
  }

  // Provisionnement terminé. La seule chose renvoyée au navigateur est une
  // destination INTERNE et NON PRIVILÉGIÉE : /connexion n'accorde aucun
  // droit par elle-même, elle demande des identifiants. Le lien de
  // définition de mot de passe, lui, est déjà parti par email.
  return reponse({ paid: true, ready: true, redirectTo: "/connexion" });
}
