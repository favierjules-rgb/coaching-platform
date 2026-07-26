import { NextResponse } from "next/server";

import { parseJsonBody } from "@/lib/api/validate";
import { freeAssessmentSchema, looksAutomated } from "@/lib/free-assessment/schema";
import { sendFreeAssessmentEmail } from "@/lib/free-assessment/email";
import { checkRateLimit, getClientIp } from "@/lib/newsletter/rate-limit";

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

/** 3 demandes par IP et par heure. */
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Deux envois de la même IP à moins de 20 s d'intervalle : double-clic ou rejeu. */
const DOUBLE_SUBMIT_WINDOW_MS = 20 * 1000;

const SUCCESS_MESSAGE =
  "Ta demande a bien été envoyée. Je te recontacte personnellement pour échanger sur ton objectif.";
const ERROR_MESSAGE = "Une erreur est survenue pendant l'envoi. Réessaie dans quelques instants.";
const RATE_LIMITED_MESSAGE =
  "Tu as déjà envoyé plusieurs demandes récemment. Merci de patienter avant de réessayer.";

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
  const rateLimit = checkRateLimit(`free_assessment:${ip}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: RATE_LIMITED_MESSAGE },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) } },
    );
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
  const doubleSubmit = checkRateLimit(`free_assessment_burst:${ip}`, 1, DOUBLE_SUBMIT_WINDOW_MS);
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
