import { NextResponse } from "next/server";

import { retirerAbonnement } from "@/lib/push/depot-abonnements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/unsubscribe — retire CET appareil, et lui seul.
 *
 * ════════════════════════════════════════════════════════════════════════
 * DEUX USAGES, UNE SEULE RÈGLE
 * ════════════════════════════════════════════════════════════════════════
 *   • l'élève désactive les notifications sur ce téléphone ;
 *   • l'élève se déconnecte de ce téléphone (voir `useDeconnexionOffline`).
 *
 * Dans les deux cas, on supprime la ligne de CET endpoint. Les autres
 * appareils du même compte ne bougent pas — se déconnecter de l'ordinateur
 * ne doit pas couper les notifications du téléphone.
 *
 * La suppression exige que l'endpoint appartienne à l'utilisateur
 * authentifié : sans ce filtre, connaître un endpoint suffirait à couper les
 * notifications de quelqu'un d'autre.
 */
export async function POST(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Authentification requise." }, { status: 401 });
  }

  let corps: { endpoint?: unknown };
  try {
    corps = (await request.json()) as { endpoint?: unknown };
  } catch {
    return NextResponse.json({ error: "Corps illisible." }, { status: 400 });
  }
  const endpoint = corps?.endpoint;
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > 2000) {
    return NextResponse.json({ error: "Endpoint invalide." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  // `retirerAbonnement` filtre sur user_id : la moitié qui compte.
  const ok = await retirerAbonnement(admin, user.id, endpoint);
  if (!ok) {
    return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
