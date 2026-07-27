import { NextResponse } from "next/server";

import { createCoachBodySchema } from "@/lib/api/schemas/coaches";
import { parseJsonBody } from "@/lib/api/validate";
import { createCoachAccount } from "@/lib/supabase/coach-account-provisioning";
import { getProfileByUserId } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/api/authz";

/**
 * POST /api/admin/coaches — création réelle d'un collaborateur admin/coach
 * depuis CoachModal (/admin/parametres). Réservé admin/coach. Remplace
 * l'ancien flux 100% mock (localStorage, useAdminData::createCoach) : crée
 * un vrai compte Supabase (auth invite + profiles + coaches) et envoie un
 * email d'invitation avec un lien de définition de mot de passe. Voir
 * lib/supabase/coach-account-provisioning.ts pour le détail.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createCoachBodySchema);
  if (!parsed.success) return parsed.response;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  // Action globale ou destructive : administrateur uniquement (H-3).
  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;
  const user = acces.user;

  const requestingProfile = await getProfileByUserId(user.id);
  const requestingUserName =
    [requestingProfile?.firstName, requestingProfile?.lastName].filter(Boolean).join(" ").trim() || user.email || "L'équipe";

  // Client service role : création d'un compte auth.users (invite) et
  // écriture de email_logs, toutes deux hors de portée d'un client de
  // session classique (voir lib/supabase/admin.ts).
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const result = await createCoachAccount(supabase, { ...parsed.data, requestingUserName });

  if (!result.ok) {
    const messages: Record<typeof result.error, string> = {
      email_already_used: "Un compte existe déjà avec cet email.",
      auth_error: "Impossible de créer le compte (un compte existe peut-être déjà).",
      insert_error: "Échec de la création de la fiche coach.",
    };
    const status = result.error === "email_already_used" ? 409 : 500;
    return NextResponse.json({ error: messages[result.error] }, { status });
  }

  return NextResponse.json({ coachId: result.coachId });
}
