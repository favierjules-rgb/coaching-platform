import { NextResponse } from "next/server";

import { lireAbonnement } from "@/lib/push/abonnement";
import { enregistrerAbonnement } from "@/lib/push/depot-abonnements";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/push/subscribe — enregistre l'appareil courant.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'IDENTITÉ VIENT DE LA SESSION, PAS DU CORPS
 * ════════════════════════════════════════════════════════════════════════
 * Le corps ne transporte que l'abonnement rendu par le navigateur. Le
 * `user_id` est DÉRIVÉ de la session authentifiée — sans quoi n'importe qui
 * pourrait abonner l'appareil d'un autre, ou s'abonner à la place d'un
 * autre.
 *
 * ════════════════════════════════════════════════════════════════════════
 * UN ENDPOINT = UN APPAREIL = UN SEUL COMPTE À LA FOIS
 * ════════════════════════════════════════════════════════════════════════
 * `endpoint` est unique en base. Un téléphone partagé, ou un élève qui se
 * reconnecte sous un autre compte, produit le MÊME endpoint : on le
 * rattache alors au compte courant plutôt que d'échouer ou de créer un
 * doublon. Sans cela, l'ancien compte continuerait de recevoir des
 * notifications sur un appareil qui ne lui appartient plus.
 *
 * Le client admin est utilisé pour cette écriture parce que RLS interdit à
 * l'élève de LIRE la table (les clés de chiffrement n'ont rien à faire dans
 * un navigateur) — l'autorisation est donc revérifiée ici, à la main :
 * l'utilisateur doit être authentifié, et la ligne écrite porte SON id.
 */

/** Un abonnement fait quelques centaines d'octets ; 8 Ko est déjà très large. */
const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const taille = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(taille) && taille > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Corps de requête trop volumineux." }, { status: 413 });
  }

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

  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return NextResponse.json({ error: "Corps illisible." }, { status: 400 });
  }

  const abonnement = lireAbonnement((corps as { subscription?: unknown })?.subscription ?? corps);
  if (!abonnement) {
    return NextResponse.json({ error: "Abonnement invalide." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }

  const ok = await enregistrerAbonnement(
    admin,
    user.id,
    abonnement,
    request.headers.get("user-agent") ?? "",
  );
  if (!ok) {
    return NextResponse.json({ error: "Enregistrement impossible." }, { status: 500 });
  }
  // Rien de l'abonnement n'est renvoyé : le navigateur le connaît déjà, et
  // une réponse plus bavarde ne servirait qu'à fuiter.
  return NextResponse.json({ ok: true });
}
