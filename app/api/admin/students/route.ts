import { NextResponse } from "next/server";

import { createCoachingStudent } from "@/lib/supabase/coach-student-provisioning";
import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { parseJsonBody } from "@/lib/api/validate";
import { createStudentBodySchema } from "@/lib/api/schemas/students";

/**
 * POST /api/admin/students — création réelle d'un élève depuis
 * CreateStudentModal (/admin/eleves). Réservé admin/coach. Remplace
 * l'ancien flux 100% mock (localStorage, useAdminData::createStudent) :
 * crée un vrai compte Supabase (auth invite + profiles + students +
 * student_profiles pré-remplie) et envoie l'email d'invitation "Ton espace
 * est prêt" avec un lien de définition de mot de passe. Voir
 * lib/supabase/coach-student-provisioning.ts pour le détail du
 * provisionnement.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createStudentBodySchema);
  if (!parsed.success) return parsed.response;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }
  const role = await getCurrentUserRole();
  if (role !== "admin" && role !== "coach") {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  // Client service role : création d'un compte auth.users (invite) et
  // écriture de email_logs, toutes deux hors de portée d'un client de
  // session classique (voir lib/supabase/admin.ts).
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const result = await createCoachingStudent(supabase, { ...parsed.data, requestingUserId: user.id });

  if (!result.ok) {
    const messages: Record<typeof result.error, string> = {
      email_already_used: "Un élève existe déjà avec cet email.",
      auth_error: "Impossible de créer le compte (un compte existe peut-être déjà sans fiche élève).",
      insert_error: "Échec de la création de la fiche élève.",
    };
    const status = result.error === "email_already_used" ? 409 : 500;
    return NextResponse.json({ error: messages[result.error] }, { status });
  }

  return NextResponse.json({ studentId: result.studentId });
}
