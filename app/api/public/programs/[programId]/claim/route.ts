import { NextResponse } from "next/server";

import { idParamSchema } from "@/lib/api/schemas/common";
import { publicProgramAccessBodySchema } from "@/lib/api/schemas/stripe";
import { parseJsonBody, parseParams } from "@/lib/api/validate";
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
export async function POST(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const routeParams = await params;
  const parsedParams = parseParams({ id: routeParams.programId }, idParamSchema);
  if (!parsedParams.success) return parsedParams.response;

  const parsedBody = await parseJsonBody(request, publicProgramAccessBodySchema);
  if (!parsedBody.success) return parsedBody.response;

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const { data: program, error: programError } = await supabase
    .from("programs")
    .select("id, name, coach_id, is_public, public_subscription_template_id")
    .eq("id", parsedParams.data.id)
    .maybeSingle();
  if (programError) {
    console.error(`[public/programs/claim] lecture programme : ${programError.message}`);
  }

  if (!program || !program.is_public) {
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
  });

  if (!result) {
    return NextResponse.json(
      { error: "Impossible de créer ton accès pour le moment. Réessaie plus tard ou contacte le coach." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
