import { NextResponse } from "next/server";

import { magasinsParVilleBodySchema } from "@/lib/api/schemas/magasins";
import { parseJsonBody } from "@/lib/api/validate";
import { PAYS_CODE, villeValide } from "@/lib/nutrition/magasin-proche";
import { estOffNonConfigure } from "@/lib/open-food-facts/client";
import { chercherMagasinsParVille } from "@/lib/open-prices/locations";
import { consumeRateLimit, rateLimitKey, refusDeLimite } from "@/lib/security/rate-limit";
import { STORES_SEARCH } from "@/lib/security/rules";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * COURSES C4.3b — POST /api/student/stores/search
 *
 * Les magasins alimentaires d'une VILLE — le chemin de repli de l'élève qui a
 * refusé la géolocalisation, dont l'appareil ne sait pas le situer, ou qui
 * préfère simplement taper le nom de sa ville.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * AUCUNE GÉOLOCALISATION N'EST REQUISE ICI
 * ────────────────────────────────────────────────────────────────────────────
 * Pas de latitude, pas de longitude, pas de rayon. C'est tout l'intérêt : un
 * refus de permission ne doit pas fermer la fonctionnalité.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CHERCHER N'EST PAS CHOISIR — LA MÊME RÈGLE QU'EN C4.3a
 * ────────────────────────────────────────────────────────────────────────────
 * Aucun insert, aucun upsert, aucun client de service. Le magasin choisi passe
 * par POST /api/student/stores/select, déjà écrite, déjà éprouvée, et qui relit
 * la fiche canonique chez la source. C4.3b n'ouvre AUCUN second chemin
 * d'écriture.
 *
 * ET PAS DE CODE POSTAL. LocationFilter n'en expose aucun — vérifié le
 * 18/08/2026. Cette route n'accepte donc pas de champ postal, plutôt que d'en
 * simuler un en parcourant tout le référentiel.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ET PAS DE PAYS NON PLUS : C4.3b EST UNE RECHERCHE MANUELLE **FRANCE**
 * ────────────────────────────────────────────────────────────────────────────
 * Le corps ne porte QUE `ville`. Le pays est une constante serveur, envoyée à
 * l'amont sous forme de nom (`osm_address_country__like=France`) pour borner
 * le domaine AVANT pagination, puis reconfirmée au retour sur le code ISO.
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
  const { data: eleve } = await supabase
    .from("students")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!eleve) {
    return NextResponse.json({ error: "Aucun profil élève." }, { status: 403 });
  }

  const quota = await consumeRateLimit(rateLimitKey([STORES_SEARCH.name, user.id]), STORES_SEARCH);
  if (!quota.allowed) {
    return refusDeLimite(quota, "Trop de recherches à la suite. Réessaie dans une minute.");
  }

  const parsed = await parseJsonBody(request, magasinsParVilleBodySchema);
  if (!parsed.success) return parsed.response;

  // Seconde barrière, volontairement redondante — même doctrine que le rayon en
  // C4.3a. Le schéma connaît les bornes ; ce sont ces fonctions qui portent la
  // RÈGLE, et c'est la règle qui doit gagner si les deux venaient à diverger.
  const ville = parsed.data.ville.trim();
  if (!villeValide(ville)) {
    return NextResponse.json({ error: "Nom de ville invalide." }, { status: 400 });
  }

  // ⚠️ LE PAYS N'EST PAS LU DANS LA REQUÊTE — IL N'Y EST PAS. C'est une
  // constante serveur, et le corps `.strict()` refuse tout champ `pays`. Le
  // navigateur ne choisit donc pas le pays de recherche d'un lot qui n'en
  // connaît qu'un.
  try {
    const resultat = await chercherMagasinsParVille({ ville });

    // « Aucun magasin dans cette ville » et « je n'ai pas pu chercher » sont
    // deux réponses différentes, et l'écran ne les dit pas pareil.
    if (!resultat.ok) {
      return NextResponse.json(
        { error: "La recherche de magasins a échoué.", code: "OPEN_PRICES_INDISPONIBLE" },
        { status: 503 },
      );
    }

    return NextResponse.json({
      magasins: resultat.magasins,
      tronque: resultat.tronque,
      ville,
      // Renvoyé pour que l'écran puisse le dire, jamais reçu : c'est le serveur
      // qui l'énonce.
      pays: PAYS_CODE,
    });
  } catch (erreur) {
    if (estOffNonConfigure(erreur)) {
      console.error(`[Magasins] ${erreur.message}`);
      return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
    }
    console.error("[Magasins] échec inattendu de la recherche par ville");
    return NextResponse.json({ error: "Service indisponible." }, { status: 503 });
  }
}
