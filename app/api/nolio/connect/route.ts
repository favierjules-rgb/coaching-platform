import { NextResponse } from "next/server";

import { genererState } from "@/lib/nolio/crypto";
import { nolioEstConfigure, urlDAutorisation } from "@/lib/nolio/oauth";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { NOLIO_CONNECT } from "@/lib/security/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * C5.1 — DÉPART DU FLUX OAUTH NOLIO.
 *
 * ⚠️ SOUS `/api/`, ET CE N'EST PAS UN DÉTAIL DE RANGEMENT. `public/sw.js`
 * rend la main immédiatement sur `url.pathname.indexOf("/api/") === 0`, alors
 * qu'il INTERCEPTE toutes les autres navigations. Un callback ailleurs
 * dépendrait du fait que `navigation()` soit réseau-d'abord et ne mette pas en
 * cache une réponse redirigée — vrai aujourd'hui, mais c'est un détail
 * d'implémentation, pas une garantie.
 */
export const dynamic = "force-dynamic";

/** Le cookie de `state`. Étroit, éphémère, invisible au JavaScript. */
export const COOKIE_STATE = "nolio_oauth_state";

/**
 * Dix minutes : la durée de vie d'un `authorization_code` chez Nolio. Plus
 * long laisserait un `state` rejouable après l'expiration du code ; plus court
 * ferait échouer un élève qui lit l'écran de consentement.
 */
export const DUREE_COOKIE_STATE_S = 600;

export async function GET() {
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

  const quota = await consumeRateLimit(rateLimitKey([NOLIO_CONNECT.name, user.id]), NOLIO_CONNECT);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de tentatives de connexion. Réessaie dans une minute.");
  }

  // ⚠️ ON VÉRIFIE LA CONFIGURATION AVANT DE POSER LE COOKIE. Rediriger vers
  // une URL bâtie sur un `client_id` absent enverrait l'élève sur une page
  // d'erreur Nolio, en lui laissant croire que le problème vient de son compte.
  if (!nolioEstConfigure()) {
    return NextResponse.json({ error: "Connexion Nolio indisponible." }, { status: 503 });
  }

  const state = genererState();
  const reponse = NextResponse.redirect(urlDAutorisation(state), { status: 302 });

  // ⚠️ LE COOKIE NE PORTE QUE DE L'ALÉA. Pas de `student_id`, pas d'e-mail,
  // rien de déductible : le lien avec l'élève se refait côté callback par la
  // SESSION, qui est la seule source d'identité digne de confiance.
  reponse.cookies.set({
    name: COOKIE_STATE,
    value: state,
    httpOnly: true,
    // `Secure` sauf en développement local, où l'on sert en HTTP.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    // ⚠️ `Lax` ET NON `Strict`. Le retour de Nolio est une navigation
    // CROSS-SITE : en `Strict`, le navigateur n'enverrait pas le cookie, et le
    // callback rejetterait toutes les connexions légitimes.
    path: "/api/nolio",
    maxAge: DUREE_COOKIE_STATE_S,
  });
  return reponse;
}
