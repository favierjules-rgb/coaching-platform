import { NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/validate";
import { freeAssessmentSchema, looksAutomated } from "@/lib/free-assessment/schema";
import { sendFreeAssessmentEmail } from "@/lib/free-assessment/email";
import {
  consumeRateLimit,
  getTrustedClientIp,
  refusDeLimite,
  rateLimitKey,
} from "@/lib/security/rate-limit";
import { DOUBLE_SUBMIT, FREE_ASSESSMENT_IP } from "@/lib/security/rules";

export const runtime = "nodejs";

/**
 * Demande de « Mon bilan offert » (section de la page d'accueil).
 *
 * L'envoi est EXCLUSIVEMENT serveur : la clé Resend et l'adresse de
 * destination (`FREE_ASSESSMENT_RECIPIENT_EMAIL`) ne quittent jamais le
 * serveur. Rien n'est écrit en base ; les réponses du questionnaire ne sont
 * jamais journalisées. Aucun email automatique n'est envoyé au prospect —
 * c'est le coach qui le recontacte.
 *
 * Protections (mêmes que /api/business-inquiry, validées en juillet 2026) :
 *  - honeypot `website` : rempli ⇒ réponse de SUCCÈS neutre, aucun envoi.
 *    Un robot n'apprend donc pas qu'il a été détecté ;
 *  - limite de fréquence par IP (`lib/newsletter/rate-limit`, dont la table
 *    en mémoire est bornée : un attaquant ne peut pas la faire grossir
 *    indéfiniment) ;
 *  - garde anti double-soumission : une même IP ne peut pas envoyer deux
 *    demandes en quelques secondes (complète la désactivation du bouton
 *    côté client, qui ne protège pas d'un rejeu réseau) ;
 *  - taille du corps bornée avant lecture, puis validation Zod `.strict()`
 *    avec longueurs maximales sur tous les champs.
 */

/** ~8 Ko : très au-dessus d'une demande légitime (1 500 caractères max), très en dessous d'un abus. */
const MAX_BODY_BYTES = 8 * 1024;

// Quotas et fenêtres : lib/security/rules.ts (BUSINESS_INQUIRY_IP /
// FREE_ASSESSMENT_IP et DOUBLE_SUBMIT), pour être relus d'un seul endroit.

const SUCCESS_MESSAGE =
  "Ta demande a bien été envoyée. Je te recontacte personnellement pour échanger sur ton objectif.";
const ERROR_MESSAGE = "Une erreur est survenue pendant l'envoi. Réessaie dans quelques instants.";
const RATE_LIMITED_MESSAGE =
  "Tu as déjà envoyé plusieurs demandes récemment. Merci de patienter avant de réessayer.";

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
  const rateLimit = await consumeRateLimit(rateLimitKey(["free_assessment", ip]), FREE_ASSESSMENT_IP);
  if (!rateLimit.allowed) {
    // 429 si le quota est dépassé, 503 si le magasin partagé est
    // indisponible en production : dans ce second cas AUCUN email n'est
    // envoyé, et le message reste muet sur la cause (arbitrage H-2).
    return refusDeLimite(rateLimit, RATE_LIMITED_MESSAGE);
  }

  // 3) Validation stricte (mêmes règles que le formulaire client).
  const parsed = await parseJsonBody(request, freeAssessmentSchema);
  if (!parsed.success) return parsed.response;
  const assessment = parsed.data;

  // 4) Honeypot : réponse de succès NEUTRE, sans aucun envoi.
  if (looksAutomated(assessment)) {
    return successResponse();
  }

  // 5) Double soumission : la même IP vient déjà d'envoyer une demande.
  const doubleSubmit = await consumeRateLimit(rateLimitKey(["free_assessment_burst", ip]), DOUBLE_SUBMIT);
  if (!doubleSubmit.allowed) {
    // Succès neutre : la première demande est bien partie, inutile
    // d'inquiéter quelqu'un qui a double-cliqué.
    return successResponse();
  }

  const result = await sendFreeAssessmentEmail(assessment);

  if (result.status === "failed") {
    // Le détail technique reste côté serveur (déjà journalisé par le
    // transport) — le prospect ne voit qu'un message générique.
    return NextResponse.json({ error: ERROR_MESSAGE }, { status: 502 });
  }

  if (result.status === "skipped") {
    // Emails désactivés ou destinataire non configuré : la demande n'a pas
    // pu être transmise, on le dit sans exposer la raison technique.
    console.error(`[FreeAssessment] Envoi ignoré (${result.error ?? "raison inconnue"}).`);
    return NextResponse.json({ error: ERROR_MESSAGE }, { status: 503 });
  }

  return successResponse();
}
