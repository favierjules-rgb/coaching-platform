import { NextResponse } from "next/server";

import { coachIdParamSchema } from "@/lib/api/schemas/coaches";
import { parseParams } from "@/lib/api/validate";
import { deleteCoachAccount } from "@/lib/supabase/coach-account-provisioning";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/api/authz";

/**
 * DELETE /api/admin/coaches/[coachId] — suppression réelle et définitive
 * d'un compte collaborateur (fiche `coaches`, `profiles`, compte de
 * connexion `auth.users`) — bouton "Supprimer" sur /admin/parametres.
 * Réservé admin/coach, bloqué sur son propre compte (voir
 * lib/supabase/coach-account-provisioning.ts::deleteCoachAccount).
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ coachId: string }> }) {
  const parsedParams = parseParams(await params, coachIdParamSchema);
  if (!parsedParams.success) return parsedParams.response;
  const { coachId } = parsedParams.data;

  const sessionSupabase = await createSupabaseServerClient();
  if (!sessionSupabase) {
    return NextResponse.json({ error: "Supabase non configuré." }, { status: 503 });
  }

  // Action globale ou destructive : administrateur uniquement (H-3).
  const acces = await requireAdmin();
  if (!acces.ok) return acces.response;
  const user = acces.user;

  // Client service role : suppression auth.users (Admin API).
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ error: "Client Supabase service role indisponible." }, { status: 503 });
  }

  const result = await deleteCoachAccount(supabase, coachId, user.id);
  if (!result.ok) {
    const statusByError = { not_found: 404, cannot_delete_self: 403, delete_error: 500 } as const;
    const messageByError = {
      not_found: "Coach introuvable.",
      cannot_delete_self: "Impossible de supprimer ton propre compte.",
      delete_error: "Échec de la suppression.",
    } as const;
    return NextResponse.json({ error: messageByError[result.error] }, { status: statusByError[result.error] });
  }

  return NextResponse.json({ ok: true });
}
