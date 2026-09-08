import { NextResponse } from "next/server";

import { comparerEnTempsConstant } from "@/lib/nolio/crypto";
import { NolioErreur, echangerCode, lireIdentiteNolio, origineDuSite } from "@/lib/nolio/oauth";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { NOLIO_CALLBACK } from "@/lib/security/rules";
import { NolioConnexionErreur, enregistrerConnexion } from "@/lib/supabase/nolio";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { COOKIE_STATE } from "@/app/api/nolio/connect/route";

/**
 * C5.1 — LE RETOUR D'AUTORISATION NOLIO.
 *
 * ════════════════════════════════════════════════════════════════════════
 * L'ORDRE DES CONTRÔLES EST LA SÉCURITÉ ELLE-MÊME
 * ════════════════════════════════════════════════════════════════════════
 *   1. session          — sans elle, on ne sait pas À QUI attribuer la connexion
 *   2. quota            — avant tout appel sortant, qui coûte du quota Nolio
 *   3. state + cookie   — avant d'échanger le code, jamais après
 *   4. échange          — puis identité, puis écriture
 *
 * ⚠️ ÉCHANGER LE CODE AVANT DE VÉRIFIER LE `state` SERAIT LE DÉFAUT CLASSIQUE :
 * un attaquant ferait consommer à Sethcoaching un code qu'il contrôle, et le
 * refus arriverait trop tard — les jetons auraient déjà été émis pour SON
 * compte Nolio.
 *
 * ⚠️ AUCUN JETON NE TRANSITE PAR L'URL DE REDIRECTION. On ne renvoie qu'un
 * mot-clé de résultat, lisible et sans valeur pour qui l'intercepterait.
 */
export const dynamic = "force-dynamic";

/** Redirection vers le profil, cookie de `state` effacé dans tous les cas. */
function versProfil(resultat: string): NextResponse {
  const reponse = NextResponse.redirect(new URL(`/profil?nolio=${resultat}`, origineDuSite()), {
    status: 302,
  });
  // ⚠️ LE COOKIE EST EFFACÉ SUR CHAQUE SORTIE, succès comme échec. Un `state`
  // qui survit à son usage est un `state` rejouable.
  reponse.cookies.set({ name: COOKIE_STATE, value: "", path: "/api/nolio", maxAge: 0 });
  return reponse;
}

export async function GET(request: Request) {
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
  const studentId = (eleve as { id: string }).id;

  const quota = await consumeRateLimit(rateLimitKey([NOLIO_CALLBACK.name, user.id]), NOLIO_CALLBACK);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de tentatives. Réessaie dans une minute.");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code")?.trim() ?? "";
  const stateRecu = url.searchParams.get("state")?.trim() ?? "";

  // ⚠️ LE COOKIE EST LU SUR LA REQUÊTE, pas via `cookies()` : c'est la même
  // valeur, mais lire la requête rend le test possible sans simuler tout le
  // magasin de cookies de Next.
  const stateAttendu = lireCookie(request.headers.get("cookie"), COOKIE_STATE);

  if (!stateRecu || !stateAttendu) return versProfil("etat-invalide");
  if (!comparerEnTempsConstant(stateRecu, stateAttendu)) return versProfil("etat-invalide");
  if (!code) return versProfil("code-absent");

  try {
    const jetons = await echangerCode(code);
    // ⚠️ L'IDENTITÉ EST LUE AVANT D'ÉCRIRE. Une connexion sans `nolio_user_id`
    // serait inutilisable : c'est ce champ qui, plus tard, routera les
    // webhooks vers le bon élève.
    const nolioUserId = await lireIdentiteNolio(jetons.accessToken);
    await enregistrerConnexion(studentId, nolioUserId, jetons);
    return versProfil("connecte");
  } catch (erreur) {
    if (erreur instanceof NolioConnexionErreur && erreur.motif === "deja-liee-autre-eleve") {
      return versProfil("deja-liee");
    }
    if (erreur instanceof NolioErreur && erreur.motif === "code-invalide") {
      // ⚠️ C'EST AUSSI LE CAS DU DOUBLE CALLBACK. Un `authorization_code` est à
      // usage unique : le second appel reçoit un refus de Nolio, et la
      // connexion déjà écrite reste intacte — on n'écrit rien sur ce chemin.
      return versProfil("code-invalide");
    }
    // ⚠️ AUCUN DÉTAIL TECHNIQUE NE SORT. Ni statut HTTP amont, ni corps de
    // réponse : le mot-clé suffit à l'écran, et ne renseigne pas un attaquant.
    return versProfil("echec");
  }
}

/**
 * Lit un cookie dans l'en-tête brut.
 *
 * ⚠️ ON DÉCOUPE SUR `=` UNE SEULE FOIS. Une valeur base64url ne contient pas
 * de `=` non final, mais un `split("=")` naïf tronquerait n'importe quelle
 * valeur qui en porterait un — et le `state` deviendrait faux sans raison
 * visible.
 */
function lireCookie(entete: string | null, nom: string): string | null {
  if (!entete) return null;
  for (const morceau of entete.split(";")) {
    const brut = morceau.trim();
    const separateur = brut.indexOf("=");
    if (separateur <= 0) continue;
    if (brut.slice(0, separateur) !== nom) continue;
    const valeur = brut.slice(separateur + 1).trim();
    return valeur.length > 0 ? valeur : null;
  }
  return null;
}
