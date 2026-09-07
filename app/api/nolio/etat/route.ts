import { NextResponse } from "next/server";

import { ETAT_NON_CONNECTE, etatConnexion } from "@/lib/supabase/nolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * C5.1 — L'ÉTAT DE CONNEXION, POUR L'INTERFACE.
 *
 * ⚠️ CETTE ROUTE EXISTE PARCE QUE `authenticated` N'A AUCUN PRIVILÈGE SUR
 * `nolio_connections`. L'élève ne peut donc pas interroger la table depuis le
 * navigateur, même avec la bonne RLS — c'est délibéré. Cette route est la
 * seule fenêtre, et elle ne montre que ce que `nolio_connexion_etat`
 * contient : ni `access_token`, ni `refresh_token`, jamais.
 *
 * ⚠️ AUCUN QUOTA ICI. C'est une lecture, appelée une fois à l'affichage du
 * profil, et qui ne déclenche aucun appel sortant vers Nolio. Y poser une
 * limite gênerait un élève qui recharge sa page sans rien protéger de réel.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json(ETAT_NON_CONNECTE, { status: 200 });

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
  if (!eleve) return NextResponse.json(ETAT_NON_CONNECTE, { status: 200 });

  return NextResponse.json(await etatConnexion((eleve as { id: string }).id), { status: 200 });
}
