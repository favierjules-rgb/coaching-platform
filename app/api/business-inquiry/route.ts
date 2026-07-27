import { NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/validate";
import { businessInquirySchema, looksAutomated } from "@/lib/business-inquiry/schema";
import { sendBusinessInquiryEmail } from "@/lib/business-inquiry/email";
import {
  consumeRateLimit,
  getTrustedClientIp,
  refusDeLimite,
  rateLimitKey,
} from "@/lib/security/rate-limit";
import { BUSINESS_INQUIRY_IP, DOUBLE_SUBMIT } from "@/lib/security/rules";

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

// Quotas et fenêtres : lib/security/rules.ts (BUSINESS_INQUIRY_IP /
// FREE_ASSESSMENT_IP et DOUBLE_SUBMIT), pour être relus d'un seul endroit.

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
  // getTrustedClientIp ignore `X-Forwarded-For` en production : cet en-tête
  // est fourni par le client et suffisait à ouvrir un compteur neuf à chaque
  // requête (correctif H-2, audit du 27/07/2026).
  const ip = getTrustedClientIp(request);

  // 1) Taille du corps — refusée avant toute lecture/parsing coûteux.
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: ERROR_MESSAGE }, { status: 413 });
  }

  // 2) Limite de fréquence par IP.
  const rateLimit = await consumeRateLimit(rateLimitKey(["business_inquiry", ip]), BUSINESS_INQUIRY_IP);
  if (!rateLimit.allowed) {
    // 429 si le quota est dépassé, 503 si le magasin partagé est
    // indisponible en production : dans ce second cas AUCUN email n'est
    // envoyé, et le message reste muet sur la cause (arbitrage H-2).
    return refusDeLimite(rateLimit, RATE_LIMITED_MESSAGE);
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
  const doubleSubmit = await consumeRateLimit(rateLimitKey(["business_inquiry_burst", ip]), DOUBLE_SUBMIT);
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
