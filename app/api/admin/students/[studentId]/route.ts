import { NextResponse } from "next/server";

import { getCurrentUser, getCurrentUserRole } from "@/lib/supabase/auth";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { deleteStudentCompletely } from "@/lib/supabase/delete-student";
import { parseParams } from "@/lib/api/validate";
import { studentIdParamSchema } from "@/lib/api/schemas/students";

/**
 * DELETE /api/admin/students/[studentId] — suppression définitive et
 * complète d'un élève (fiche, toutes les données liées, fichiers Storage
 * de progression, compte de connexion) — bouton "Supprimer définitivement"
 * sur /admin/eleves/[studentId]. Réservé admin/coach. Voir
 * lib/supabase/delete-student.ts pour le détail (cascade FK + Admin API +
 * nettoyage Storage best-effort).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const parsedParams = parseParams(await params, studentIdParamSchema);
  if (!parsedParams.success) return parsedParams.response;
  const { studentId } = parsedParams.data;

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

  // Client service role : suppression auth.users (Admin API) et cascade sur
  // des tables sans policy DELETE pour un rôle authentifié classique.
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const result = await deleteStudentCompletely(supabase, studentId);
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : 500;
    const error = result.error === "not_found" ? "Élève introuvable." : "Échec de la suppression.";
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json({ ok: true });
}
