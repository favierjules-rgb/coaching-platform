import { NextResponse } from "next/server";

import { idParamSchema } from "@/lib/api/schemas/common";
import { publicProgramAccessBodySchema } from "@/lib/api/schemas/stripe";
import { parseJsonBody, parseParams } from "@/lib/api/validate";
import { CGV_PROGRAMME_CONSENT_TEXT_VERSION } from "@/lib/legal-consents";
import {
  consumeRateLimit,
  getTrustedClientIp,
  refusDeLimite,
  rateLimitKey,
} from "@/lib/security/rate-limit";
import { CLAIM_PROGRAM_EMAIL, CLAIM_PROGRAM_IP, DOUBLE_SUBMIT } from "@/lib/security/rules";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { provisionPublicProgramAccess } from "@/lib/supabase/public-program-provisioning";

/**
 * POST /api/public/programs/[programId]/claim — réclamation d'un programme
 * public **gratuit** (chantier module Programmation, étape 6). Aucune
 * authentification, aucun Stripe : provisionne directement le compte élève
 * (ou assigne le programme à un compte existant si l'email correspond déjà
 * à une fiche élève), voir lib/supabase/public-program-provisioning.ts.
 *
 * Client service role obligatoire (jamais un client de session : aucun
 * utilisateur n'est connecté ici) — la vérification "programme public et
 * réellement gratuit" est donc entièrement portée par cette route, jamais
 * déléguée à une RLS.
 */
/** ~4 Ko : trois champs courts, rien de plus. */
const MAX_BODY_BYTES = 4 * 1024;

/** Message unique de refus : ne révèle jamais pourquoi la demande est bloquée. */
const TROP_DE_DEMANDES = "Trop de demandes. Réessaie plus tard.";

export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
  }

  // Quota par IP AVANT tout travail : cette route crée un compte Supabase Auth
  // et envoie un email à chaque appel réussi (audit H-2).
  const ip = getTrustedClientIp(request);
  const parIp = await consumeRateLimit(rateLimitKey([ip]), CLAIM_PROGRAM_IP);
  if (!parIp.allowed) {
    return refusDeLimite(parIp, TROP_DE_DEMANDES);
  }

  const routeParams = await params;
  const parsedParams = parseParams({ id: routeParams.programId }, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;

  const parsedBody = await parseJsonBody(request, publicProgramAccessBodySchema);
  if (!parsedBody.success) return parsedBody.response;

  // Honeypot : un robot remplit tous les champs, y compris celui que le
  // formulaire masque. Réponse de SUCCÈS neutre, sans rien provisionner —
  // même convention que /api/business-inquiry et /api/free-assessment.
  if (parsedBody.data.website && parsedBody.data.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  // Idempotence métier : le même couple (programme, email) n'a pas de raison
  // d'être réclamé en boucle. Bloque aussi le double-clic.
  const cleRessource = rateLimitKey([parsedParams.data.id, parsedBody.data.email]);
  const parEmail = await consumeRateLimit(cleRessource, CLAIM_PROGRAM_EMAIL);
  if (!parEmail.allowed) {
    // Succès neutre : la première réclamation est déjà partie, et on ne
    // confirme pas à un tiers qu'une adresse a réclamé ce programme.
    return NextResponse.json({ ok: true });
  }

  const antiRejeu = await consumeRateLimit(rateLimitKey([ip, cleRessource]), DOUBLE_SUBMIT);
  if (!antiRejeu.allowed) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, name, coach_id, status, is_public, public_subscription_template_id")
    .eq("id", parsedParams.data.id)
    .maybeSingle();
  if (programError) {
    console.error(`[public/programs/claim] lecture programme : ${programError.message}`);
  }

  // status !== "actif" couvre aussi bien un programme archivé après coup
  // qu'un lien direct vers un brouillon jamais publié.
  if (!program || !program.is_public || program.status !== "actif") {
    return NextResponse.json({ error: "Programme introuvable." }, { status: 404 });
  }
  if (program.public_subscription_template_id) {
    return NextResponse.json({ error: "Ce programme n'est pas gratuit — utilise le paiement." }, { status: 400 });
  }

  const result = await provisionPublicProgramAccess(supabase, {
    programId: program.id,
    programName: program.name,
    coachId: program.coach_id,
    firstName: parsedBody.data.firstName,
    lastName: parsedBody.data.lastName,
    email: parsedBody.data.email,
    cgvConsentTextVersion: CGV_PROGRAMME_CONSENT_TEXT_VERSION,
  });

  if (!result) {
    return NextResponse.json(
      { error: "Impossible de créer ton accès pour le moment. Réessaie plus tard ou contacte le coach." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
