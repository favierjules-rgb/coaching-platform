import { NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/validate";
import { businessInquirySchema, looksAutomated } from "@/lib/business-inquiry/schema";
import { sendBusinessInquiryEmail } from "@/lib/business-inquiry/email";
import { checkRateLimit, getClientIp } from "@/lib/newsletter/rate-limit";

export const runtime = "nodejs";

/**
 * Demande de contact « Services aux entreprises » (page /services-entreprises).
 *
 * L'envoi est EXCLUSIVEMENT serveur : la clé Resend et l'adresse de
 * destination (`B2B_CONTACT_RECIPIENT_EMAIL`) ne quittent jamais le serveur.
 * Rien n'est écrit en base ; les réponses du questionnaire ne sont jamais
 * journalisées.
 *
 * Protections (§9 du chantier) :
 *  - honeypot `website` : rempli ⇒ réponse de SUCCÈS neutre, aucun envoi.
 *    Un robot n'apprend donc pas qu'il a été détecté ;
 *  - limite de fréquence par IP (réutilise `lib/newsletter/rate-limit`) ;
 *  - garde anti double-soumission : une même IP ne peut pas envoyer deux
 *    demandes en quelques secondes (complète la désactivation du bouton
 *    côté client, qui ne protège pas d'un rejeu réseau) ;
 *  - taille du corps bornée avant lecture, puis validation Zod `.strict()`
 *    avec longueurs maximales sur tous les champs.
 */

/** ~16 Ko : très au-dessus d'une demande légitime (2 000 caractères de détails max), très en dessous d'un abus. */
const MAX_BODY_BYTES = 16 * 1024;

/** 3 demandes par IP et par heure. */
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Deux envois de la même IP à moins de 20 s d'intervalle : double-clic ou rejeu. */
const DOUBLE_SUBMIT_WINDOW_MS = 20 * 1000;

const SUCCESS_MESSAGE =
  "Votre demande a bien été envoyée. Je vous recontacte rapidement pour échanger sur votre projet.";
const ERROR_MESSAGE =
  "Une erreur est survenue pendant l'envoi. Merci de réessayer ou de me contacter directement.";
const RATE_LIMITED_MESSAGE =
  "Vous avez déjà envoyé plusieurs demandes récemment. Merci de patienter avant de réessayer.";

function successResponse() {
  return NextResponse.json({ message: SUCCESS_MESSAGE }, { status: 200 });
}

export async function POST(request: Request) {
  const ip = getClientIp(request);

  // 1) Taille du corps — refusée avant toute lecture/parsing coûteux.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: ERROR_MESSAGE }, { status: 413 });
  }

  // 2) Limite de fréquence par IP.
  const rateLimit = checkRateLimit(`business_inquiry:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } },
    );
  }

  // 3) Validation stricte (mêmes règles que le formulaire client).
  const parsed = await parseJsonBody(request, businessInquirySchema);
  if (!parsed.success) return parsed.response;
  const inquiry = parsed.data;

  // 4) Honeypot : réponse de succès NEUTRE, sans aucun envoi.
  if (looksAutomated(inquiry)) {
    return successResponse();
  }

  // 5) Double soumission : la même IP vient déjà d'envoyer une demande.
  const doubleSubmit = checkRateLimit(`business_inquiry_burst:${ip}`, 1, DOUBLE_SUBMIT_WINDOW_MS);
  if (!doubleSubmit.allowed) {
    // Succès neutre : la première demande est bien partie, inutile
    // d'inquiéter un prospect qui a double-cliqué.
    return successResponse();
  }

  const result = await sendBusinessInquiryEmail(inquiry);

  if (result.status === "failed") {
    // Le détail technique reste côté serveur (déjà journalisé par le
    // transport) — le prospect ne voit qu'un message générique.
    return NextResponse.json({ error: ERROR_MESSAGE }, { status: 502 });
  }

  if (result.status === "skipped") {
    // Emails désactivés ou destinataire non configuré : la demande n'a pas
    // pu être transmise, on le dit sans exposer la raison technique.
    console.error(`[BusinessInquiry] Envoi ignoré (${result.error ?? "raison inconnue"}).`);
    return NextResponse.json({ error: ERROR_MESSAGE }, { status: 503 });
  }

  return successResponse();
}
