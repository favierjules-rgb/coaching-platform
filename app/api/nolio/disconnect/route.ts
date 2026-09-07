import { NextResponse } from "next/server";

import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { NOLIO_DISCONNECT } from "@/lib/security/rules";
import { supprimerConnexion } from "@/lib/supabase/nolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * C5.1 — DÉCONNEXION NOLIO.
 *
 * ⚠️ POST, PAS DELETE, ET C'EST LA CONVENTION MAISON. `DELETE` n'est employé
 * dans ce dépôt que sur les routes admin adressant une ressource par son
 * identifiant (`/api/admin/…/[id]`). Une action d'un élève sur SA propre
 * ressource passe en POST — voir `push/unsubscribe` et
 * `newsletter/unsubscribe`, qui font exactement cela.
 *
 * ⚠️ IDEMPOTENTE. Un second clic, un rechargement, une déconnexion déjà faite
 * ailleurs : tous rendent 200. Renvoyer 404 sur « déjà déconnecté »
 * afficherait une erreur à un élève qui a obtenu ce qu'il voulait.
 *
 * ⚠️ LA RÉPONSE NE PORTE AUCUN JETON, et pas davantage l'identifiant Nolio :
 * il n'a rien à faire dans une confirmation de déconnexion.
 */
export const dynamic = "force-dynamic";

export async function POST() {
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

  const { data: eleve } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!eleve) {
    return NextResponse.json({ error: "Aucun profil élève." }, { status: 403 });
  }

  const quota = await consumeRateLimit(
    rateLimitKey([NOLIO_DISCONNECT.name, user.id]),
    NOLIO_DISCONNECT,
  );
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de tentatives. Réessaie dans une minute.");
  }

  try {
    const existait = await supprimerConnexion((eleve as { id: string }).id);
    return NextResponse.json({ deconnecte: true, existait }, { status: 200 });
  } catch {
    // ⚠️ AUCUN DÉTAIL. `NolioConnexionErreur` porte un motif technique utile
    // au serveur, sans intérêt pour l'élève et sans valeur à exposer.
    return NextResponse.json({ error: "La déconnexion a échoué." }, { status: 503 });
  }
}
